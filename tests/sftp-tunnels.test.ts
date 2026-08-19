import { generateKeyPairSync } from 'crypto';
import { once } from 'events';
import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  read as fsRead,
  write as fsWrite
} from 'fs';
import { connect, createServer, type Server as NetServer, type Socket } from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import { Server, type SFTPWrapper } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialSet, Host } from '../src/shared/types';
import { SftpManager, type TransferProgress } from '../src/main/sftp/manager';
import { TunnelManager } from '../src/main/tunnels/manager';
import type { Sealer } from '../src/main/store/crypto-format';

const fakeSealer: Sealer = {
  available: () => false,
  seal: () => {
    throw new Error('unexpected seal');
  },
  unseal: () => {
    throw new Error('unexpected unseal');
  }
};

function makeHostKey(): string {
  return generateKeyPairSync('rsa', { modulusLength: 1024 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
}

function makeHost(port: number): Host {
  return {
    id: 'h1',
    kind: 'host',
    name: 'test',
    protocol: 'ssh',
    host: '127.0.0.1',
    port,
    username: 'user',
    credentialId: 'c1',
    tags: [],
    notes: '',
    ssh: { keepalive: 0, agent: false, timeout: 5 },
    rdp: { domain: '', screenMode: 'window', width: 1280, height: 800, multiMonitor: false, promptForCreds: false },
    vnc: { scale: 'scale', quality: 0 },
    lastConnectedAt: null
  };
}

function makeCredential(password: string): CredentialSet {
  return {
    id: 'c1',
    name: 'creds',
    username: 'user',
    passwordMode: 'stored',
    passwordCipher: 'plain:' + Buffer.from(password, 'utf8').toString('base64'),
    keyFile: null,
    keyPassphraseCipher: null,
    useAgent: false
  };
}

function waitFor(pred: () => boolean, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      if (pred()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id);
        reject(new Error('timeout waiting for condition'));
      }
    }, 25);
  });
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const STATUS = { OK: 0, EOF: 1, NO_SUCH: 2, FAILURE: 4 };

function statToAttrs(st: ReturnType<typeof statSync>): Record<string, unknown> {
  return {
    mode: st.mode,
    uid: 0,
    gid: 0,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
    owner: '',
    group: ''
  };
}

/**
 * Минимальный SFTP-сервер на реальной ФС: ssh2 в server-режиме отдаёт
 * только сырые события, так что обработчики пишем здесь.
 */
function installSftpHandlers(sftp: SFTPWrapper): void {
  // Заметка: типы ssh2 не покрывают server-режим — события обрабатываются как any.
  const s = sftp as unknown as {
    on(ev: string, cb: (...args: unknown[]) => void): void;
    status(reqId: number, code: number): void;
    handle(reqId: number, handle: Buffer): void;
    data(reqId: number, data: Buffer): void;
    name(reqId: number, names: { filename: string; longname: string; attrs: unknown }[]): void;
    attrs(reqId: number, attrs: unknown): void;
  };
  const dirs = new Map<number, { path: string; list: import('fs').Dirent[] }>();
  const files = new Map<number, { fd: number; path: string }>();
  let nextHandle = 1;

  s.on('REALPATH', (reqId, path) => {
    const resolved = path === '.' || path === '' ? path : String(path);
    try {
      s.name(reqId, [{ filename: resolved, longname: '', attrs: statToAttrs(statSync(resolved)) }]);
    } catch {
      s.status(reqId, STATUS.NO_SUCH);
    }
  });

  s.on('STAT', (reqId, path) => {
    try {
      s.attrs(reqId, statToAttrs(statSync(String(path))));
    } catch {
      s.status(reqId, STATUS.NO_SUCH);
    }
  });
  s.on('LSTAT', (reqId, path) => {
    try {
      s.attrs(reqId, statToAttrs(statSync(String(path))));
    } catch {
      s.status(reqId, STATUS.NO_SUCH);
    }
  });

  s.on('OPENDIR', (reqId, path) => {
    try {
      const handle = nextHandle++;
      dirs.set(handle, { path: String(path), list: readdirSync(String(path), { withFileTypes: true }) });
      s.handle(reqId, Buffer.from(String(handle)));
    } catch {
      s.status(reqId, STATUS.NO_SUCH);
    }
  });

  s.on('READDIR', (reqId, handle) => {
    const h = dirs.get(Number(handle.toString()));
    if (!h) {
      s.status(reqId, STATUS.FAILURE);
      return;
    }
    const entry = h.list.shift();
    if (!entry) {
      dirs.delete(Number(handle.toString()));
      s.status(reqId, STATUS.EOF);
      return;
    }
    let attrs = {};
    try {
      attrs = statToAttrs(statSync(join(h.path, entry.name)));
    } catch {
      // файл мог исчезнуть — отдаём без атрибутов
    }
    s.name(reqId, [{ filename: entry.name, longname: '', attrs }]);
  });

  s.on('MKDIR', (reqId, path) => {
    try {
      mkdirSync(String(path));
      s.status(reqId, STATUS.OK);
    } catch {
      s.status(reqId, STATUS.FAILURE);
    }
  });

  s.on('RENAME', (reqId, from, to) => {
    try {
      renameSync(String(from), String(to));
      s.status(reqId, STATUS.OK);
    } catch {
      s.status(reqId, STATUS.FAILURE);
    }
  });

  s.on('REMOVE', (reqId, path) => {
    try {
      unlinkSync(String(path));
      s.status(reqId, STATUS.OK);
    } catch {
      s.status(reqId, STATUS.FAILURE);
    }
  });

  s.on('RMDIR', (reqId, path) => {
    try {
      rmdirSync(String(path));
      s.status(reqId, STATUS.OK);
    } catch {
      s.status(reqId, STATUS.FAILURE);
    }
  });

  s.on('OPEN', (reqId, filename, pflags) => {
    const flagsNum = Number(pflags);
    const write = flagsNum & 2;
    const trunc = flagsNum & 16;
    const flags = write ? (trunc ? 'w' : 'r+') : 'r';
    try {
      const fd = openSync(String(filename), flags);
      const handle = nextHandle++;
      files.set(handle, { fd, path: String(filename) });
      s.handle(reqId, Buffer.from(String(handle)));
    } catch {
      s.status(reqId, STATUS.FAILURE);
    }
  });

  s.on('READ', (reqId, handle, offset, len) => {
    const h = files.get(Number(handle.toString()));
    if (!h) {
      s.status(reqId, STATUS.FAILURE);
      return;
    }
    const buf = Buffer.alloc(Number(len));
    fsRead(h.fd, buf, 0, buf.length, Number(offset), (err, bytes) => {
      if (err) {
        s.status(reqId, STATUS.FAILURE);
        return;
      }
      if (bytes === 0) {
        s.status(reqId, STATUS.EOF);
        return;
      }
      s.data(reqId, buf.subarray(0, bytes));
    });
  });

  s.on('WRITE', (reqId, handle, offset, data) => {
    const h = files.get(Number(handle.toString()));
    if (!h) {
      s.status(reqId, STATUS.FAILURE);
      return;
    }
    fsWrite(h.fd, data as Buffer, 0, (data as Buffer).length, Number(offset), (err) => {
      if (err) s.status(reqId, STATUS.FAILURE);
      else s.status(reqId, STATUS.OK);
    });
  });

  s.on('FSTAT', (reqId, handle) => {
    const h = files.get(Number(handle.toString()));
    if (!h) {
      s.status(reqId, STATUS.FAILURE);
      return;
    }
    try {
      s.attrs(reqId, statToAttrs(fstatSync(h.fd)));
    } catch {
      s.status(reqId, STATUS.FAILURE);
    }
  });

  s.on('CLOSE', (reqId, handle) => {
    const h = files.get(Number(handle.toString()));
    if (h) {
      try {
        closeSync(h.fd);
      } catch {
        // уже закрыт
      }
      files.delete(Number(handle.toString()));
    }
    s.status(reqId, STATUS.OK);
  });
}

interface MockServer {
  port: number;
  close: () => Promise<void>;
}

async function startServer(opts: { password: string; workDir: string; echoPort: number }): Promise<MockServer> {
  const clients = new Set<import('ssh2').Connection>();
  const server = new Server({ hostKeys: [makeHostKey()] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.password === opts.password) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (sftpAccept) => {
          installSftpHandlers(sftpAccept() as SFTPWrapper);
        });
      });
      client.on('tcpip', (accept) => {
        const stream = accept();
        const sock = connect(opts.echoPort, '127.0.0.1');
        sock.on('connect', () => {
          stream.pipe(sock);
          sock.pipe(stream);
        });
        sock.on('error', () => stream.destroy());
        stream.on('error', () => sock.destroy());
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: async () => {
      for (const c of clients) c.end();
      server.close();
      await once(server, 'close').catch(() => undefined);
    }
  };
}

function createConnectionTo(port: number): Socket {
  return connect(port, '127.0.0.1');
}

describe('SftpManager (real server)', () => {
  let server: MockServer | null = null;
  let workDir: string;
  let workDirPosix: string;
  const sftp = new SftpManager(fakeSealer);
  const progress: TransferProgress[] = [];
  const progressRef = progress;

  afterEach(async () => {
    sftp.closeAll();
    await server?.close();
    server = null;
  });

  it(
    'листинг, mkdir, rename, upload, download с прогрессом, delete',
    async () => {
      workDir = mkdtempSync(join(tmpdir(), 'rh-sftp-'));
      workDirPosix = workDir.replace(/\\/g, '/');
      writeFileSync(join(workDir, 'seed.txt'), 'seed content');
      server = await startServer({ password: 'secret', workDir, echoPort: 0 });

      const host = makeHost(server.port);
      const cred = makeCredential('secret');
      const opened = await sftp.open(host, cred, 's1');
      expect(opened.ok).toBe(true);

      // Листинг корня.
      const entries = await sftp.list('s1', workDirPosix);
      expect(entries.some((e) => e.name === 'seed.txt' && !e.isDirectory)).toBe(true);

      // mkdir + rename
      await sftp.mkdir('s1', join(workDirPosix, 'sub'));
      await sftp.rename('s1', join(workDirPosix, 'sub'), join(workDirPosix, 'sub2'));
      const afterRename = await sftp.list('s1', workDirPosix);
      expect(afterRename.some((e) => e.name === 'sub2' && e.isDirectory)).toBe(true);

      // upload с прогрессом
      writeFileSync(join(workDir, 'local-up.txt'), 'hello from local side');
      await sftp.upload(
        's1',
        join(workDir, 'local-up.txt'),
        join(workDirPosix, 'remote-up.txt'),
        (p) => progressRef.push(p),
        'op-up'
      );
      expect(readFileSync(join(workDir, 'remote-up.txt'), 'utf8')).toBe('hello from local side');
      expect(progressRef.some((p) => p.opId === 'op-up' && p.direction === 'upload' && p.done)).toBe(true);

      // download с прогрессом
      writeFileSync(join(workDir, 'for-dl.txt'), 'download payload');
      await sftp.download(
        's1',
        join(workDirPosix, 'for-dl.txt'),
        join(workDir, 'dl-result.txt'),
        (p) => progressRef.push(p),
        'op-dl'
      );
      expect(readFileSync(join(workDir, 'dl-result.txt'), 'utf8')).toBe('download payload');
      expect(progressRef.some((p) => p.opId === 'op-dl' && p.direction === 'download' && p.done)).toBe(true);

      // delete файла и папки
      await sftp.remove('s1', join(workDirPosix, 'remote-up.txt'), false);
      await sftp.remove('s1', join(workDirPosix, 'sub2'), true);
      const final = await sftp.list('s1', workDirPosix);
      expect(final.some((e) => e.name === 'remote-up.txt')).toBe(false);
      expect(final.some((e) => e.name === 'sub2')).toBe(false);
    },
    20000
  );

  it('отдаёт ошибку для неизвестной сессии', async () => {
    await expect(sftp.list('ghost', '.')).rejects.toThrow('не найдена');
    await expect(sftp.mkdir('ghost', '.')).rejects.toThrow('не найдена');
  });
});

describe('TunnelManager (real server)', () => {
  let server: MockServer | null = null;
  let echo: NetServer | null = null;
  let echoPort = 0;
  const tunnels = new TunnelManager(fakeSealer);

  afterEach(async () => {
    tunnels.closeAll();
    await server?.close();
    server = null;
    if (echo) {
      echo.close();
      await once(echo, 'close').catch(() => undefined);
      echo = null;
    }
  });

  it(
    'пробрасывает локальный порт до цели, останавливается и закрывается с сеансом',
    async () => {
      // Эхо-сервер — цель туннеля.
      echo = createServer((sock) => sock.pipe(sock));
      echo.listen(0, '127.0.0.1');
      await once(echo, 'listening');
      echoPort = (echo.address() as { port: number }).port;

      server = await startServer({ password: 'secret', workDir: tmpdir(), echoPort });
      const host = makeHost(server.port);
      const cred = makeCredential('secret');
      const localPort = await freePort();

      const added = await tunnels.add('t1', host, cred, localPort, '127.0.0.1', echoPort);
      expect(added.ok).toBe(true);
      expect(added.tunnel?.active).toBe(true);
      expect(tunnels.list('t1')).toHaveLength(1);

      // Круг через туннель: пишем → получаем эхо. Туннель держит соединение
      // открытым (эхо-сервер не шлёт FIN), поэтому ждём не 'end', а полный payload.
      const payload = 'ping-through-tunnel';
      const reply = await new Promise<string>((resolve, reject) => {
        const sock = createConnectionTo(localPort);
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => reject(new Error('no echo')), 8000);
        sock.on('connect', () => sock.write(payload));
        sock.on('data', (d) => {
          chunks.push(d as Buffer);
          const got = Buffer.concat(chunks).toString();
          if (got.length >= payload.length) {
            clearTimeout(timer);
            sock.destroy();
            resolve(got.slice(0, payload.length));
          }
        });
        sock.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      expect(reply).toBe(payload);

      // Остановка туннеля → порт больше не слушается.
      tunnels.stop('t1', added.tunnel!.id);
      expect(tunnels.list('t1')).toHaveLength(0);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const refused = await new Promise<boolean>((resolve) => {
        const sock = createConnectionTo(localPort);
        sock.once('error', () => resolve(true));
        sock.once('connect', () => resolve(false));
        sock.once('timeout', () => resolve(false));
      });
      expect(refused).toBe(true);

      // stopAll закрывает и SSH-соединение сеанса.
      const again = await tunnels.add('t1', host, cred, localPort, '127.0.0.1', echoPort);
      expect(again.ok).toBe(true);
      tunnels.stopAll('t1');
      expect(tunnels.list('t1')).toHaveLength(0);
    },
    20000
  );

  it('сообщает об ошибке, если SSH недоступен', async () => {
    const deadPort = await freePort();
    const res = await tunnels.add('t2', makeHost(deadPort), makeCredential('x'), 45678, '127.0.0.1', 22);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('отклоняет некорректные порты', async () => {
    const res = await tunnels.add('t3', makeHost(22), makeCredential('x'), 0, '127.0.0.1', 22);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('локальный порт');
  });
});
