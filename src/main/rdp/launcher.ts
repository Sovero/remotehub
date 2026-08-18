import { execFile } from 'child_process';
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
 * Запускает mstsc.exe с .rdp-файлом. Если передан пароль — подставляет его
 * через cmdkey (Windows Credential Manager) и удаляет запись после выхода.
 * Все исходы (включая ошибки запуска) приходят через onExit.
 */
export function launchRdp(
  opts: RdpFileOptions,
  password: string | null,
  onExit: (outcome: RdpOutcome) => void
): RdpLaunchResult {
  let filePath: string | null = null;
  try {
    filePath = join(tmpdir(), `remotehub-${nanoid(8)}.rdp`);
    writeFileSync(filePath, buildRdpFile(opts), 'utf8');
  } catch (err) {
    return { ok: false, error: `Не удалось создать .rdp-файл: ${(err as Error).message}` };
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

  const injectPassword = (): Promise<void> => {
    if (!password) return Promise.resolve();
    const user = opts.domain ? `${opts.domain}\\${opts.username}` : opts.username;
    return new Promise((resolve) => {
      execFile('cmdkey', [`/generic:${cmdkeyTarget}`, `/user:${user}`, `/pass:${password}`], (err) => {
        if (!err) passwordInjected = true;
        resolve(); // ошибка инъекции не фатальна — mstsc сам запросит пароль
      });
    });
  };

  void injectPassword().then(() => {
    if (!filePath) return;
    const child = execFile('mstsc.exe', [filePath]);
    child.on('error', (err) => {
      cleanup();
      onExit({ code: null, error: `Не удалось запустить mstsc: ${err.message}` });
    });
    child.on('exit', (code) => {
      cleanup();
      onExit({ code });
    });
  });

  return { ok: true };
}
