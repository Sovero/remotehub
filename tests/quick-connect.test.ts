import { describe, expect, it } from 'vitest';
import { parseQuickConnect } from '../src/shared/quick-connect';

describe('parseQuickConnect', () => {
  it('разбирает user@host', () => {
    const r = parseQuickConnect('root@example.com');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.host.username).toBe('root');
      expect(r.host.host).toBe('example.com');
      expect(r.host.port).toBe(22);
      expect(r.host.protocol).toBe('ssh');
    }
  });

  it('разбирает user@host:port', () => {
    const r = parseQuickConnect('deploy@10.0.0.7:2222');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.host.port).toBe(2222);
  });

  it('разбирает голый адрес и адрес с портом', () => {
    const bare = parseQuickConnect('server.local');
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.host.username).toBe('');
      expect(bare.host.port).toBe(22);
    }
    const ported = parseQuickConnect('server.local:2200');
    expect(ported.ok).toBe(true);
    if (ported.ok) expect(ported.host.port).toBe(2200);
  });

  it('разбирает IPv6 в скобках', () => {
    const r = parseQuickConnect('user@[::1]:2200');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.host.host).toBe('::1');
      expect(r.host.port).toBe(2200);
    }
  });

  it('отвергает мусор', () => {
    expect(parseQuickConnect('').ok).toBe(false);
    expect(parseQuickConnect('   ').ok).toBe(false);
    expect(parseQuickConnect('@host').ok).toBe(false);
    expect(parseQuickConnect('user@').ok).toBe(false);
    expect(parseQuickConnect('host:99999').ok).toBe(false);
    expect(parseQuickConnect('host:abc').ok).toBe(false);
    expect(parseQuickConnect('[::1').ok).toBe(false);
  });
});
