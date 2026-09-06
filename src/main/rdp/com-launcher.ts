import { spawn, execFile, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import type { RdpFileOptions } from './generator';

/**
 * Путь к скомпилированному C++ COM-хосту.
 * В dev-режиме — из src/native, в packaged — из ресурсов приложения.
 */
function getComHostPath(): string {
  // В packaged-сборке exe лежит рядом с app.asar
  const packaged = join(process.resourcesPath ?? '', 'rdp-com-host.exe');
  if (existsSync(packaged)) return packaged;
  // Dev-режим: ищем относительно исходников
  const devPaths = [
    join(__dirname, 'rdp-com-host.exe'), // out/main/rdp-com-host.exe
    join(__dirname, '..', 'rdp-com-host.exe'), // out/rdp-com-host.exe
    join(__dirname, '..', '..', 'src', 'native', 'rdp-com-host.exe'),
    join(process.cwd(), 'src', 'native', 'rdp-com-host.exe')
  ];
  for (const p of devPaths) {
    if (existsSync(p)) return p;
  }
  return devPaths[devPaths.length - 1];
}

export interface RdpComSpawn {
  ok: boolean;
  child?: ChildProcess;
  /** HWND, прочитанный из stdout COM-хоста (hex-строка → bigint). */
  hwnd?: bigint;
  error?: string;
  cleanup: () => void;
}

/** Лог-функция для отладки. */
function log(msg: string): void {
  console.log(`[rdp-com-launcher] ${msg}`);
}

/**
 * Целевой ключ cmdkey для пары host/учётка: TERMSRV/<host>.
 * Единственное место, где собирается этот формат (используется и для /generic,
 * и для гарантированного /delete при аварийной уборке).
 */
export function cmdkeyTargetFor(host: string): string {
  return `TERMSRV/${host}`;
}

/**
 * Гарантированная уборка пароля из Credential Manager (cmdkey /delete).
 * Вызывается штатно из cleanup() сессии, а также по closeAll/before-quit —
 * крах или kill COM-хоста не должен оставлять пароль ОС в хранилище (R2).
 * Ошибки игнорируются: записи может уже не быть — это не сбой уборки.
 */
export function purgeCmdkeyCredential(host: string): void {
  const target = cmdkeyTargetFor(host);
  execFile('cmdkey', [`/delete:${target}`], { windowsHide: true }, () => undefined);
  log(`cmdkey purge issued: ${target}`);
}

/**
 * Запускает rdp-com-host.exe с аргументами подключения.
 * Читает строку "HWND:1A2B3C4D" из stdout и возвращает HWND.
 *
 * Ноль mstsc.exe в процессах — COM-хост загружает MsTscAx
 * in-process как ActiveX control в скрытом окне. Тот же mstscax.dll,
 * что использует сам mstsc.exe — TLS/CredSSP идёт через SChannel,
 * а не через rustls, поэтому легаси-сертификаты (RSA key exchange без
 * digitalSignature) не блокируют подключение так, как это происходит
 * у IronRDP (см. src/main/rdp/iron-gateway.ts).
 *
 * Пароль: ClearTextPassword через IDispatch возвращает E_ACCESSDENIED.
 * Обход: cmdkey инъекция перед запуском — COM-контроль сам возьмёт
 * credentials из Credential Manager при CredSSP-рукопожатии.
 */
export async function spawnComRdp(opts: RdpFileOptions, password: string | null): Promise<RdpComSpawn> {
  const exePath = getComHostPath();
  if (!existsSync(exePath)) {
    return {
      ok: false,
      error: `rdp-com-host.exe не найден: ${exePath}`,
      cleanup: () => undefined
    };
  }

  // cmdkey: инъекция пароля в Credential Manager.
  // COM-контроль MsTscAx при CredSSP сам найдёт эти credentials.
  const cmdkeyTarget = cmdkeyTargetFor(opts.host);
  let passwordInjected = false;
  const user = opts.domain ? `${opts.domain}\\${opts.username}` : opts.username;
  if (password) {
    await new Promise<void>((resolve) => {
      execFile(
        'cmdkey',
        [`/generic:${cmdkeyTarget}`, `/user:${user}`, `/pass:${password}`],
        { windowsHide: true },
        (err) => {
          if (!err) passwordInjected = true;
          resolve();
        }
      );
    });
    log(`cmdkey injected: ${passwordInjected ? 'ok' : 'failed'}`);
  }

  // Пароль НЕ входит в args: argv процесса виден любому другому процессу на
  // машине (Win32_Process.CommandLine, диспетчер задач, Process Explorer) —
  // без повышенных прав и пока процесс жив, то есть весь RDP-сеанс. Вместо
  // этого он пишется первой строкой в stdin сразу после спавна (см. шапку
  // rdp-com-host.cs) — так его видит только сам дочерний процесс.
  const args: string[] = [
    opts.host,
    String(opts.port ?? 3389),
    opts.domain ? `${opts.domain}\\${opts.username}` : opts.username,
    opts.domain ?? '',
    String(opts.width ?? 1024),
    String(opts.height ?? 768)
  ];

  log(`spawn ${exePath} ${args.join(' ')}`);

  const child = spawn(exePath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  try {
    child.stdin?.write(`${password ?? ''}\n`);
  } catch {
    // stdin недоступен — процесс уже завершился/не запустился, обработается ниже по коду выхода
  }

  let stderrBuf = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  // Ждём "HWND:HEXVALUE" из stdout (с таймаутом 15 сек).
  const hwnd = await new Promise<bigint | null>((resolve) => {
    const timer = setTimeout(() => {
      log('timeout waiting for HWND');
      resolve(null);
    }, 15000);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      log(`stdout: ${text}`);
      const match = text.match(/HWND:([0-9a-fA-F]+)/i);
      if (match) {
        clearTimeout(timer);
        const hwndVal = BigInt('0x' + match[1]);
        log(`parsed HWND: 0x${hwndVal.toString(16)}`);
        resolve(hwndVal);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      log(`spawn error: ${err.message}`);
      resolve(null);
    });

    // 'close', не 'exit': 'exit' может сработать до того как stdio-пайпы
    // дочитаны до конца (задокументированная гонка Node.js child_process) —
    // с 'exit' часть stderrBuf терялась молча.
    child.on('close', (code) => {
      clearTimeout(timer);
      log(`process exited: code=${code}, stderr=${stderrBuf}`);
      resolve(null);
    });
  });

  if (hwnd === null) {
    child.kill();
    return {
      ok: false,
      error: stderrBuf.trim() || 'rdp-com-host не вернул HWND',
      cleanup: () => undefined
    };
  }

  return {
    ok: true,
    child,
    hwnd,
    cleanup: () => {
      try {
        child.stdin?.write('quit\n');
      } catch {
        /* */
      }
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* */
        }
      }, 2000);
      // Удаляем cmdkey-запись
      if (passwordInjected) purgeCmdkeyCredential(opts.host);
    }
  };
}
