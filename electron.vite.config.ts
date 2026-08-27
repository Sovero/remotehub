import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = resolve(__dirname, 'src/shared');

// Пакеты из dependencies, которые нужно bundle'ить (не externalize),
// потому что electron-builder не копирует node_modules в app.asar.
const BUNDLED_DEPS = [
  'electron-updater',
  'ssh2',
  'ws',
  'node-rdpjs',
  'telnet-client',
  'nanoid',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_DEPS })],
    build: {
      rollupOptions: {
        // ws тянет bufferutil/utf-8-validate, а ssh2 — cpu-features как
        // опциональные нативные модули. Не бандлим их: Rollup, встречая
        // require() нативного .node-файла внутри забандленного ssh2,
        // копирует бинарник в отдельный чанк и переписывает require на
        // прямой путь до него — ВНЕ исходного try/catch, которым ssh2
        // оборачивает этот require у себя в коде. Из-за этого в сборку
        // попадает бинарник, собранный под Node.js сборочной машины (не
        // под Electron), и загрузка падает необработанным исключением
        // ещё до того, как отработает наш process.on('uncaughtException').
        // Externalize оставляет require('cpu-features') как обычный
        // рантайм-require пакета — тогда родной try/catch внутри ssh2
        // снова работает, а @electron/rebuild успевает пересобрать
        // сам пакет в node_modules под ABI Electron.
        external: ['bufferutil', 'utf-8-validate', 'cpu-features'],
      },
    },
    resolve: {
      alias: { '@shared': shared },
    },
  },
  preload: {
    resolve: {
      alias: { '@shared': shared },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared,
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});
