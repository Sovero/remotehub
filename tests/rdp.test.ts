import { describe, expect, it } from 'vitest';
import { buildRdpFile, rdpOptionsFromHost } from '../src/main/rdp/generator';
import { createHost, type Host } from '../src/shared/types';

function host(over: Partial<Host> = {}): Host {
  return createHost({ id: 'h1', name: 'Win', protocol: 'rdp', host: '192.168.1.10', ...over });
}

describe('rdpOptionsFromHost', () => {
  it('берёт настройки из профиля', () => {
    const opts = rdpOptionsFromHost(
      host({
        port: 3390,
        username: 'admin',
        rdp: { domain: 'CORP', screenMode: 'window', width: 1600, height: 900, multiMonitor: false, promptForCreds: false }
      })
    );
    expect(opts).toMatchObject({
      host: '192.168.1.10',
      port: 3390,
      username: 'admin',
      domain: 'CORP',
      screenMode: 'window',
      width: 1600,
      height: 900
    });
  });

  it('multiMonitor принудительно включает полный экран', () => {
    const opts = rdpOptionsFromHost(host({ rdp: { domain: '', screenMode: 'window', width: 1280, height: 800, multiMonitor: true, promptForCreds: false } }));
    expect(opts.screenMode).toBe('fullscreen');
    expect(opts.multiMonitor).toBe(true);
  });
});

describe('buildRdpFile', () => {
  it('оконный режим: адрес, порт, пользователь, разрешение', () => {
    const rdp = buildRdpFile({
      host: '192.168.1.10',
      port: 3389,
      username: 'admin',
      domain: '',
      screenMode: 'window',
      width: 1280,
      height: 800,
      multiMonitor: false,
      promptForCreds: false
    });
    expect(rdp).toContain('screen mode id:i:2');
    expect(rdp).toContain('use multimon:i:0');
    expect(rdp).toContain('desktopwidth:i:1280');
    expect(rdp).toContain('desktopheight:i:800');
    expect(rdp).toContain('full address:s:192.168.1.10');
    expect(rdp).toContain('server port:i:3389');
    expect(rdp).toContain('username:s:admin');
    expect(rdp).toContain('prompt for credentials on client:i:0');
    expect(rdp).toContain('\r\n');
  });

  it('полный экран без разрешения, с доменом и мультимонитором', () => {
    const rdp = buildRdpFile({
      host: 'win.corp.local',
      port: 3389,
      username: 'admin',
      domain: 'CORP',
      screenMode: 'fullscreen',
      width: 1280,
      height: 800,
      multiMonitor: true,
      promptForCreds: false
    });
    expect(rdp).toContain('screen mode id:i:1');
    expect(rdp).toContain('use multimon:i:1');
    expect(rdp).not.toContain('desktopwidth');
    expect(rdp).toContain('domain:s:CORP');
    expect(rdp).toContain('full address:s:win.corp.local');
  });

  it('promptForCreds включает запрос учётных данных', () => {
    const rdp = buildRdpFile({
      host: 'h',
      port: 3389,
      username: 'u',
      domain: '',
      screenMode: 'window',
      width: 1280,
      height: 800,
      multiMonitor: false,
      promptForCreds: true
    });
    expect(rdp).toContain('prompt for credentials on client:i:1');
  });

  it('не пишет пустого пользователя', () => {
    const rdp = buildRdpFile({
      host: 'h',
      port: 3389,
      username: '',
      domain: '',
      screenMode: 'window',
      width: 1280,
      height: 800,
      multiMonitor: false,
      promptForCreds: false
    });
    expect(rdp).not.toContain('username:s:');
  });

  it('полный результат — известный эталон', () => {
    const rdp = buildRdpFile({
      host: '10.0.0.5',
      port: 3389,
      username: 'user',
      domain: '',
      screenMode: 'window',
      width: 1024,
      height: 768,
      multiMonitor: false,
      promptForCreds: false
    });
    expect(rdp).toBe(
      'screen mode id:i:2\r\n' +
        'use multimon:i:0\r\n' +
        'desktopwidth:i:1024\r\n' +
        'desktopheight:i:768\r\n' +
        'session bpp:i:32\r\n' +
        'winposstr:s:0,1,0,0,800,600\r\n' +
        'full address:s:10.0.0.5\r\n' +
        'server port:i:3389\r\n' +
        'username:s:user\r\n' +
        'authentication level:i:0\r\n' +
        'prompt for credentials on client:i:0\r\n' +
        'redirectclipboard:i:1\r\n' +
        'redirect printers:i:0\r\n' +
        'redirectcomports:i:0\r\n' +
        'alternate shell:s:\r\n' +
        'shell working directory:s:\r\n' +
        'disable fullscreen winpos:i:1\r\n'
    );
  });
});
