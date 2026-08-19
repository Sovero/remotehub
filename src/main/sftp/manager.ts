import { createReadStream, createWriteStream, readdirSync, statSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { Client, type SFTPWrapper } from 'ssh2';
import type { SftpEntry, LocalEntry, TransferProgress } from '../../shared/ipc-contract';
import type { CredentialSet, Host } from '../../shared/types';
import type { Sealer } from '../store/crypto-format';
import { buildSshConfig, resolveAuth } from '../sessions/config';

export type { SftpEntry, LocalEntry, TransferProgress };

function mapEntry(entry: { filename: string; longname: string; attrs: { mode: number; size: number; mtime: number } }): SftpEntry {
  const mode = entry.attrs.mode ?? 0;
  return {
    name: entry.filename,
    isDirectory: (mode & 0o170000) === 0o040000,
    size: entry.attrs.size ?? 0,
    mtime: (entry.attrs.mtime ?? 0) * 1000
  };
}

export class SftpManager {
  private readonly sessions = new Map<string, { client: Client; sftp: SFTPWrapper }>();

  constructor(private readonly sealer: Sealer) {}

  async open(host: Host, credential: CredentialSet | null, sessionId: string): Promise<{ ok: boolean; error?: string }> {
    const client = new Client();
    const config = buildSshConfig(host, resolveAuth(credential, undefined, this.sealer, (p) => readFileSync(p, 'utf8')));
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('ready', () => resolve());
        client.once('error', (err) => reject(err));
        client.connect(config);
      });
      const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
      });
      this.sessions.set(sessionId, { client, sftp });
      return { ok: true };
    } catch (err) {
      try {
        client.end();
      } catch {
        // уже закрыт
      }
      return { ok: false, error: (err as Error).message };
    }
  }

  private get(sessionId: string): { client: Client; sftp: SFTPWrapper } | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(sessionId: string, path: string): Promise<SftpEntry[]> {
    const s = this.get(sessionId);
    if (!s) return Promise.reject(new Error('Сессия SFTP не найдена'));
    return new Promise((resolve, reject) => {
      s.sftp.readdir(path, (err, entries) => {
        if (err) {
          reject(new Error(err.message));
          return;
        }
        const mapped = entries
          .filter((e) => e.filename !== '.' && e.filename !== '..')
          .map(mapEntry)
          .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
        resolve(mapped);
      });
    });
  }

  localList(path: string): LocalEntry[] {
    const entries = readdirSync(path, { withFileTypes: true });
    return entries
      .map((e) => {
        const full = join(path, e.name);
        let size = 0;
        let mtime = 0;
        try {
          const st = statSync(full);
          size = st.size;
          mtime = st.mtimeMs;
        } catch {
          // недоступный файл — пропускаем метаданные
        }
        return { name: e.name, isDirectory: e.isDirectory(), size, mtime };
      })
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
  }

  mkdir(sessionId: string, path: string): Promise<void> {
    const s = this.get(sessionId);
    if (!s) return Promise.reject(new Error('Сессия SFTP не найдена'));
    return new Promise((resolve, reject) => s.sftp.mkdir(path, (err) => (err ? reject(new Error(err.message)) : resolve())));
  }

  rename(sessionId: string, from: string, to: string): Promise<void> {
    const s = this.get(sessionId);
    if (!s) return Promise.reject(new Error('Сессия SFTP не найдена'));
    return new Promise((resolve, reject) =>
      s.sftp.rename(from, to, (err) => (err ? reject(new Error(err.message)) : resolve()))
    );
  }

  remove(sessionId: string, path: string, isDir: boolean): Promise<void> {
    const s = this.get(sessionId);
    if (!s) return Promise.reject(new Error('Сессия SFTP не найдена'));
    return new Promise((resolve, reject) => {
      const cb = (err: Error | undefined | null): void => (err ? reject(new Error(err.message)) : resolve());
      if (isDir) s.sftp.rmdir(path, cb);
      else s.sftp.unlink(path, cb);
    });
  }

  download(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onProgress: (p: TransferProgress) => void,
    opId: string
  ): Promise<void> {
    const s = this.get(sessionId);
    if (!s) return Promise.reject(new Error('Сессия SFTP не найдена'));
    const name = basename(remotePath);
    return new Promise((resolve, reject) => {
      s.sftp.stat(remotePath, (err, stat) => {
        if (err) {
          reject(new Error(err.message));
          return;
        }
        const total = stat.size;
        let transferred = 0;
        const rs = s.sftp.createReadStream(remotePath);
        const ws = createWriteStream(localPath);
        rs.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          onProgress({ sessionId, opId, direction: 'download', name, transferred, total, done: false });
        });
        ws.on('error', (e: Error) => {
          onProgress({
            sessionId,
            opId,
            direction: 'download',
            name,
            transferred,
            total,
            done: true,
            error: e.message
          });
          reject(e);
        });
        rs.on('error', (e: Error) => {
          onProgress({
            sessionId,
            opId,
            direction: 'download',
            name,
            transferred,
            total,
            done: true,
            error: e.message
          });
          reject(e);
        });
        ws.on('finish', () => {
          onProgress({ sessionId, opId, direction: 'download', name, transferred, total, done: true });
          resolve();
        });
        rs.pipe(ws);
      });
    });
  }

  upload(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onProgress: (p: TransferProgress) => void,
    opId: string
  ): Promise<void> {
    const s = this.get(sessionId);
    if (!s) return Promise.reject(new Error('Сессия SFTP не найдена'));
    const name = basename(localPath);
    return new Promise((resolve, reject) => {
      const total = statSync(localPath).size;
      let transferred = 0;
      const rs = createReadStream(localPath);
      const ws = s.sftp.createWriteStream(remotePath);
      ws.on('error', (e: Error) => {
        onProgress({ sessionId, opId, direction: 'upload', name, transferred, total, done: true, error: e.message });
        reject(e);
      });
      rs.on('error', (e: Error) => {
        onProgress({ sessionId, opId, direction: 'upload', name, transferred, total, done: true, error: e.message });
        reject(e);
      });
      ws.on('close', () => {
        onProgress({ sessionId, opId, direction: 'upload', name, transferred, total, done: true });
        resolve();
      });
      rs.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        onProgress({ sessionId, opId, direction: 'upload', name, transferred, total, done: false });
      });
      rs.pipe(ws);
    });
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      try {
        s.client.end();
      } catch {
        // уже закрыт
      }
      this.sessions.delete(sessionId);
    }
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
