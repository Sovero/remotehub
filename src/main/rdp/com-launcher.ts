import { spawn, type ChildProcess } from 'child_process';
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
    join(__dirname, 'rdp-com-host.exe'),           // out/main/rdp-com-host.exe
    join(__dirname, '..', 'rdp-com-host.exe'),     // out/rdp-com-host.exe
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
 * Запускает rdp-com-host.exe с аргументами подключения.
 * Читает строку "HWND:1A2B3C4D" из stdout и возвращает HWND.
 *
 * Ноль mstsc.exe в процессах — COM-хост загружает MsRdpClient9
 * in-process как ActiveX control в скрытом окне.
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

  const args: string[] = [
    opts.host,
    String(opts.port ?? 3389),
    opts.domain ? `${opts.domain}\\${opts.username}` : opts.username,
    password ?? '',
    '',                          // domain (пустой — уже в username)
    String(opts.width ?? 1024),
    String(opts.height ?? 768)
  ];

  log(`spawn ${exePath} ${args.map((a, i) => i === 3 ? '***' : a).join(' ')}`);

  const child = spawn(exePath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

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

    child.on('exit', (code) => {
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
      try { child.stdin?.write('quit\n'); } catch { /* */ }
      setTimeout(() => { try { child.kill(); } catch { /* */ } }, 2000);
    }
  };
}
