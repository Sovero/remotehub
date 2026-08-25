/**
 * E2E smoke: real RDP host through IronRDP/WASM.
 *
 * Required environment:
 *   RH_RDP_HOST=server.example.com
 *   RH_RDP_USERNAME=user
 *   RH_RDP_PASSWORD=secret
 *
 * Optional:
 *   RH_RDP_PORT=3389
 *   RH_RDP_DOMAIN=DOMAIN
 *   RH_RDP_NAME=Iron smoke host
 *   RH_RDP_TIMEOUT_MS=90000
 *
 * The password is never printed. The app receives a temporary userData path,
 * seeds an encrypted credential in the main process, and exits with the smoke
 * result after checking the real canvas pixels.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const required = ['RH_RDP_HOST', 'RH_RDP_USERNAME', 'RH_RDP_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[smoke:rdp:iron] Missing environment variables: ${missing.join(', ')}`);
  process.exit(2);
}

const userData = mkdtempSync(join(tmpdir(), 'remotehub-rdp-iron-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    RH_USER_DATA: userData,
    RH_SMOKE: '1',
    RH_SMOKE_RDP_IRON: '1',
    RH_EXPECT_HOSTS: '1'
  }
});

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    // The child may still hold a file briefly on Windows; the smoke result is
    // already determined and cleanup must not hide it.
  }
};

child.on('error', (err) => {
  console.error(`[smoke:rdp:iron] Failed to start electron-vite: ${err.message}`);
  cleanup();
  process.exit(1);
});

child.on('exit', (code, signal) => {
  cleanup();
  if (signal) {
    console.error(`[smoke:rdp:iron] Dev process terminated by ${signal}`);
    process.exit(1);
    return;
  }
  process.exit(code ?? 1);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});
