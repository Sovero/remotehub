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
