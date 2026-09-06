import { app, type BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Скриншот окна для smoke-сценариев: userData/smoke/<name>.
 * Отдельный хелпер, чтобы не дублировать capturePage/запись в каждом сценарии.
 */
export async function captureAndSave(win: BrowserWindow, name: string): Promise<string> {
  const dir = join(app.getPath('userData'), 'smoke');
  const outPath = join(dir, name);
  const image = await win.webContents.capturePage();
  mkdirSync(dir, { recursive: true });
  writeFileSync(outPath, image.toPNG());
  console.log(`[smoke] screenshot saved: ${outPath} (${image.getSize().width}x${image.getSize().height})`);
  return outPath;
}
