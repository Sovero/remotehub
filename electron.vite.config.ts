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
  'node-rdpjs-2',
  'telnet-client',
  'nanoid',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: BUNDLED_DEPS })],
    build: {
      rollupOptions: {
        // ws (bufferutil/utf-8-validate) и ssh2 (cpu-features, и его
        // собственный ./crypto/build/Release/sshcrypto.node) держат
        // опциональные нативные .node-модули за try/catch у себя в коде.
        // Rollup, встречая require() такого файла внутри забандленного
        // ssh2/ws, резолвит его в реальный бинарник, копирует в отдельный
        // чанк и переписывает require на прямой путь до него — ВНЕ
        // исходного try/catch. В сборку попадает бинарник, собранный под
        // Node.js сборочной машины (не под Electron), и загрузка падает
        // необработанным исключением ещё до того, как отработает наш
        // process.on('uncaughtException') (обнаружено на живых v0.1.15/16
        // сначала на bufferutil/utf-8-validate, затем на cpu-features —
        // отдельные точечные фиксы каждый раз ловили только одно из
        // нескольких мест). Правило ниже — общее: любой require любого
        // .node-файла остаётся внешним, независимо от того, из какого
        // бандлящегося пакета он вызван — тогда родной try/catch всегда
        // сохраняется, а @electron/rebuild видит обычные пакеты в
        // node_modules и пересобирает их под ABI Electron.
        external: (id) =>
          id.endsWith('.node') || ['bufferutil', 'utf-8-validate', 'cpu-features'].includes(id),
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
