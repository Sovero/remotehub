import { execFile, type ChildProcess } from 'child_process';
import { rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { buildRdpFile, type RdpFileOptions } from './generator';

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
 * Запускает mstsc. RdpManager использует возвращённый процесс только для
 * поиска HWND, SetParent в окно Electron, показа/скрытия и закрытия вкладки.
 */
export async function spawnRdp(opts: RdpFileOptions, password: string | null): Promise<RdpSpawn> {
  const p = prepareRdp(opts, password);
  if (!p.ok || !p.filePath) return { ok: false, error: p.error, cleanup: p.cleanup };
  await p.injected;
  const child = execFile('mstsc.exe', [p.filePath], { windowsHide: true });
  return { ok: true, child, cleanup: p.cleanup };
}
