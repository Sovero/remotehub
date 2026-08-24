import { execFile, type ChildProcess } from 'child_process';
import { rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type KoffiDefault from 'koffi';
import { EventEmitter } from 'events';
import { buildRdpFile, type RdpFileOptions } from './generator';

// Ленивая загрузка koffi — только на Windows и только при первом вызове.
let koffiModule: typeof KoffiDefault | null = null;
function getKoffi(): typeof KoffiDefault | null {
  if (process.platform !== 'win32') return null;
  if (!koffiModule) {
    try {
      koffiModule = require('koffi') as typeof KoffiDefault;
    } catch {
      return null;
    }
  }
  return koffiModule;
}

/**
 * Запущенный экземпляр mstsc + очистка временного .rdp и записи cmdkey.
 * cleanup() идемпотентна и безопасна к повторным вызовам.
 */
export interface RdpSpawn {
  ok: boolean;
  child?: ChildProcess;
  error?: string;
  cleanup: () => void;
}

interface PreparedRdp {
  ok: boolean;
  error?: string;
  filePath: string | null;
  cleanup: () => void;
  /** Разрешается после инъекции пароля через cmdkey (если пароль передан). */
  injected: Promise<void>;
}

/**
 * Общая подготовка: embedded-safe .rdp-файл во временной папке + cmdkey для
 * пароля. Жизненным циклом mstsc управляет только RdpManager.
 */
function prepareRdp(opts: RdpFileOptions, password: string | null): PreparedRdp {
  let filePath: string | null = null;
  try {
    filePath = join(tmpdir(), `remotehub-${nanoid(8)}.rdp`);
    writeFileSync(filePath, buildRdpFile(opts), 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `Не удалось создать .rdp-файл: ${(err as Error).message}`,
      filePath: null,
      cleanup: () => undefined,
      injected: Promise.resolve()
    };
  }

  const cmdkeyTarget = `TERMSRV/${opts.host}`;
  let passwordInjected = false;

  const cleanup = (): void => {
    if (filePath) {
      try {
        rmSync(filePath, { force: true });
      } catch {
        // временный файл уже удалён
      }
    }
    if (passwordInjected) {
      execFile('cmdkey', [`/delete:${cmdkeyTarget}`], { windowsHide: true }, () => undefined);
    }
  };

  const injected = (() => {
    if (!password) return Promise.resolve();
    const user = opts.domain ? `${opts.domain}\\${opts.username}` : opts.username;
    return new Promise<void>((resolve) => {
      execFile('cmdkey', [`/generic:${cmdkeyTarget}`, `/user:${user}`, `/pass:${password}`], { windowsHide: true }, (err) => {
        if (!err) passwordInjected = true;
        resolve(); // ошибка инъекции не фатальна — mstsc сам запросит пароль
      });
    });
  })();

  return { ok: true, filePath, cleanup, injected };
}

/**
 * Запускает mstsc.exe через CreateProcessW с SW_HIDE — окно НИКОГДА не
 * видно снаружи приложения. Возвращает ChildProcess-совместимый объект
 * для отслеживания жизненного цикла (pid, on('exit'), kill()).
 *
 * koffi-решение надёжнее вариантов через PowerShell или флаги Node.js —
 * только CreateProcessW даёт полный контроль над wShowWindow.
 */
function spawnHiddenMstsc(cmdLine: string): ChildProcess {
  const koffi = getKoffi();
  if (!koffi) {
    // Не-Windows или koffi не загружен — падаем в execFile
    return execFile('mstsc.exe', [cmdLine], { windowsHide: true });
  }

  const kernel32 = koffi.load('kernel32.dll');
  const advapi32 = koffi.load('advapi32.dll');

  // Сначала получаем полный путь к mstsc.exe через %SystemRoot%.
  const sysRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const mstscExe = `${sysRoot}\\System32\\mstsc.exe`;

  // Структуры для CreateProcessW.
  const STARTUPINFOW = koffi.struct('STARTUPINFOW', {
    cb: 'uint32_t',
    lpReserved: 'char16_t*',
    lpDesktop: 'char16_t*',
    lpTitle: 'char16_t*',
    dwX: 'uint32_t',
    dwY: 'uint32_t',
    dwXSize: 'uint32_t',
    dwYSize: 'uint32_t',
    dwXCountChars: 'uint32_t',
    dwYCountChars: 'uint32_t',
    dwFillAttribute: 'uint32_t',
    dwFlags: 'uint32_t',
    wShowWindow: 'uint16_t',
    cbReserved2: 'uint16_t',
    lpReserved2: 'uint8_t*',
    hStdInput: 'void*',
    hStdOutput: 'void*',
    hStdError: 'void*'
  });

  const PROCESS_INFORMATION = koffi.struct('PROCESS_INFORMATION', {
    hProcess: 'void*',
    hThread: 'void*',
    dwProcessId: 'uint32_t',
    dwThreadId: 'uint32_t'
  });

  const CreateProcessW = kernel32.func(
    'BOOL __stdcall CreateProcessW(' +
      'char16_t* lpApplicationName,' +
      'char16_t* lpCommandLine,' +
      'void* lpProcessAttributes,' +
      'void* lpThreadAttributes,' +
      'BOOL bInheritHandles,' +
      'uint32_t dwCreationFlags,' +
      'void* lpEnvironment,' +
      'char16_t* lpCurrentDirectory,' +
      'STARTUPINFOW* lpStartupInfo,' +
      'PROCESS_INFORMATION* lpProcessInformation)'
  );

  const GetExitCodeProcess = kernel32.func('BOOL __stdcall GetExitCodeProcess(void* hProcess, _Out_ uint32_t* lpExitCode)');
  const CloseHandle = kernel32.func('BOOL __stdcall CloseHandle(void* hObject)');
  const TerminateProcess = kernel32.func('BOOL __stdcall TerminateProcess(void* hProcess, uint32_t uExitCode)');

  const CREATE_NO_WINDOW = 0x08000000;
  const SW_HIDE = 0;
  const STARTF_USESHOWWINDOW = 0x00000001;
  const STILL_ACTIVE = 259;

  const si: Record<string, unknown> = {};
  si.cb = koffi.sizeof(STARTUPINFOW);
  si.wShowWindow = SW_HIDE;
  si.dwFlags = STARTF_USESHOWWINDOW;

  const pi: Record<string, unknown> = {};
  pi.hProcess = null;
  pi.hThread = null;
  pi.dwProcessId = 0;

  // Командная строка: mstsc.exe "<path>"
  const cmd = `"${mstscExe}" "${cmdLine}"`;
  const cmdBuf = [...(cmd + '\0')].map(c => c.charCodeAt(0));

  const ok = CreateProcessW(
    null,
    cmdBuf,
    null, null, 0,
    CREATE_NO_WINDOW,
    null, null,
    si, pi
  );

  if (!ok) {
    // CreateProcessW не сработал — фолбэк на execFile.
    return execFile(mstscExe, [cmdLine], { windowsHide: true });
  }

  const pid = pi.dwProcessId as number;
  const hProcess = pi.hProcess;
  const hThread = pi.hThread;

  // Закрываем хендл потока — он не нужен.
  if (hThread) CloseHandle(hThread);

  // Оборачиваем в ChildProcess-совместимый EventEmitter.
  const emitter = new EventEmitter() as ChildProcess;

  // @ts-expect-error минимальный набор полей, нужных менеджеру
  emitter.pid = pid;

  let killed = false;
  let pollTimer: NodeJS.Timeout | null = null;

  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (emitter as any).kill = (): boolean => {
    if (killed) return true;
    killed = true;
    stopPolling();
    if (hProcess) {
      TerminateProcess(hProcess, 1);
      CloseHandle(hProcess);
    }
    return true;
  };

  // Поллим процесс каждые 500 мс на завершение.
  pollTimer = setInterval(() => {
    if (killed || !hProcess) {
      stopPolling();
      return;
    }
    const exitCode: (number | null)[] = [null];
    GetExitCodeProcess(hProcess, exitCode);
    const code = exitCode[0];
    if (code !== null && code !== STILL_ACTIVE) {
      stopPolling();
      CloseHandle(hProcess);
      emitter.emit('exit', code);
    }
  }, 500);
  pollTimer.unref?.();

  return emitter;
}

/**
 * Запускает mstsc. RdpManager использует возвращённый процесс только для
 * поиска HWND, SetParent в окно Electron, показа/скрытия и закрытия вкладки.
 *
 * mstsc запускается через CreateProcessW с SW_HIDE — окно никогда не
 * появляется снаружи приложения. При падении на execFile (не-Windows /
 * koffi не загрузился) используется `windowsHide: true`.
 */
export async function spawnRdp(opts: RdpFileOptions, password: string | null): Promise<RdpSpawn> {
  const p = prepareRdp(opts, password);
  if (!p.ok || !p.filePath) return { ok: false, error: p.error, cleanup: p.cleanup };
  await p.injected;
  const child = spawnHiddenMstsc(p.filePath);
  return { ok: true, child, cleanup: p.cleanup };
}