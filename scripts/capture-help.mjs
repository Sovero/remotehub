/**
 * Генерирует реальные скриншоты разделов приложения для встроенной справки.
 *
 * Запуск: npm run help:shots
 *
 * Приложение стартует в smoke-режиме (RH_CAPTURE_HELP=1), по очереди открывает
 * каждый раздел интерфейса и сохраняет PNG в src/renderer/src/assets/help/.
 * Требуется хотя бы один профиль в дереве (например, «Рабочий ПК»).
 */
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    RH_SMOKE: '1',
    RH_CAPTURE_HELP: '1'
  }
});

child.on('error', (err) => {
  console.error('[help:shots] не удалось запустить electron-vite:', err.message);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
