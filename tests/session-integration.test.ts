import { generateKeyPairSync } from 'crypto';
import { once } from 'events';
import { Server } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionState } from '../src/shared/ipc-contract';
import { SshSession } from '../src/main/sessions/ssh-session';

function makeHostKey(): string {
  return generateKeyPairSync('rsa', { modulusLength: 1024 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
}

interface MockServer {
  port: number;
  received: string[];
  close: () => Promise<void>;
}

/** Поднимает настоящий ssh2-сервер на случайном порту. */
async function startServer(opts: { password: string }): Promise<MockServer> {
  const received: string[] = [];
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
        session.on('pty', (ptyAccept) => ptyAccept());
        session.on('shell', (shellAccept) => {
          const stream = shellAccept();
          stream.write('welcome-to-mock\r\n');
          stream.on('data', (d: Buffer) => {
            received.push(d.toString());
            if (d.toString().trim() === 'exit') stream.end();
          });
          stream.on('close', () => client.end());
        });
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  return {
    port,
    received,
    close: async () => {
      for (const c of clients) c.end();
      server.close();
      await once(server, 'close').catch(() => undefined);
    }
  };
}

function makeHarness(config: { port: number; password?: string }) {
  const states: SessionState[] = [];
  const data: string[] = [];
  let authRequired = false;
  const session = new SshSession(
    {
      host: '127.0.0.1',
      port: config.port,
      username: 'user',
      password: config.password,
      readyTimeout: 5000
    },
    {
      onData: (d) => data.push(d.toString()),
      onState: (s) => states.push(s)
    },
    () => {
      authRequired = true;
    }
  );
  return { session, states, data, isAuthRequired: () => authRequired };
}

function waitFor(pred: () => boolean, timeoutMs = 8000): Promise<void> {
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

describe('SshSession transport (real server)', () => {
  let server: MockServer | null = null;
  let harness: ReturnType<typeof makeHarness> | null = null;

  afterEach(async () => {
    harness?.session.dispose();
    harness = null;
    await server?.close();
    server = null;
  });

  it(
    'подключается, принимает данные и передаёт ввод',
    async () => {
      server = await startServer({ password: 'secret' });
      harness = makeHarness({ port: server.port, password: 'secret' });
      harness.session.open(80, 24);

      await waitFor(() => harness!.states.some((s) => s.phase === 'connected'));
      expect(harness!.data.join('')).toContain('welcome-to-mock');

      harness!.session.write(Buffer.from('ls -la\r\n'));
      await waitFor(() => server!.received.length > 0);
      expect(server!.received.join('')).toContain('ls -la');

      harness!.session.close();
    },
    15000
  );

  it(
    'при неверном пароле сообщает об ошибке аутентификации',
    async () => {
      server = await startServer({ password: 'secret' });
      harness = makeHarness({ port: server.port });
      harness.session.open(80, 24);

      await waitFor(() => harness!.isAuthRequired());
      expect(harness!.isAuthRequired()).toBe(true);
      harness!.session.close();
    },
    15000
  );
});
