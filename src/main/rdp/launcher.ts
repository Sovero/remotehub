import { execFile, type ChildProcess } from 'child_process';
import { rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { buildRdpFile, type RdpFileOptions } from './generator';

export interface RdpLaunchResult {
  ok: boolean;
  error?: string;
}

export interface RdpOutcome {
  code: number | null;
  error?: string;
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
 * Общая подготовка: .rdp-файл во временной папке + cmdkey для пароля.
 * Владелец процесса (launchRdp или spawnRdp) отвечает за жизненный цикл mstsc.
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
      execFile('cmdkey', [`/delete:${cmdkeyTarget}`], () => undefined);
    }
  };

  const injected = (() => {
    if (!password) return Promise.resolve();
    const user = opts.domain ? `${opts.domain}\\${opts.username}` : opts.username;
    return new Promise<void>((resolve) => {
      execFile('cmdkey', [`/generic:${cmdkeyTarget}`, `/user:${user}`, `/pass:${password}`], (err) => {
        if (!err) passwordInjected = true;
        resolve(); // ошибка инъекции не фатальна — mstsc сам запросит пароль
      });
    });
  })();

  return { ok: true, filePath, cleanup, injected };
}

/** Запускает mstsc и отдаёт процесс — для встраивания, где менеджер рулит жизненным циклом. */
export async function spawnRdp(opts: RdpFileOptions, password: string | null): Promise<RdpSpawn> {
  const p = prepareRdp(opts, password);
  if (!p.ok || !p.filePath) return { ok: false, error: p.error, cleanup: p.cleanup };
  await p.injected;
  const child = execFile('mstsc.exe', [p.filePath]);
  return { ok: true, child, cleanup: p.cleanup };
}

/**
 * Классический запуск: mstsc в отдельном окне (фолбэк для fullscreen/multiMonitor).
 * Все исходы (включая ошибки запуска) приходят через onExit.
 */
export function launchRdp(
  opts: RdpFileOptions,
  password: string | null,
  onExit: (outcome: RdpOutcome) => void
): RdpLaunchResult {
  const p = prepareRdp(opts, password);
  if (!p.ok || !p.filePath) {
    return { ok: false, error: p.error ?? 'Не удалось создать .rdp-файл' };
  }
  void p.injected.then(() => {
    if (!p.filePath) return;
    const child = execFile('mstsc.exe', [p.filePath]);
    child.on('error', (err) => {
      p.cleanup();
      onExit({ code: null, error: `Не удалось запустить mstsc: ${err.message}` });
    });
    child.on('exit', (code) => {
      p.cleanup();
      onExit({ code });
    });
  });
  return { ok: true };
}
