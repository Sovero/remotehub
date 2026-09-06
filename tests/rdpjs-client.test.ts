import { describe, expect, it } from 'vitest';
import { buildRdpjsConfig, normalizeRdpjsBitmapEvent } from '../src/main/rdp/rdpjs-client';

describe('buildRdpjsConfig', () => {
  it('включает распаковку RLE и глушит INFO-спам библиотеки', () => {
    const cfg = buildRdpjsConfig({ host: '10.0.0.5', username: 'u', password: 'p' });
    expect(cfg.decompress).toBe(true);
    expect(cfg.logLevel).toBe('ERROR');
  });

  it('передаёт размер экрана и креденшелы', () => {
    const cfg = buildRdpjsConfig({
      host: '10.0.0.5',
      port: 3390,
      username: 'admin',
      password: 'secret',
      domain: 'CORP',
      width: 1920,
      height: 1080
    });
    expect(cfg.screen).toEqual({ width: 1920, height: 1080 });
    expect(cfg.userName).toBe('admin');
    expect(cfg.password).toBe('secret');
    expect(cfg.domain).toBe('CORP');
    expect(cfg.autoLogin).toBe(true);
    expect(cfg.enablePerf).toBe(true);
  });

  it('подставляет дефолтный размер 1366x768', () => {
    const cfg = buildRdpjsConfig({ host: 'h', username: 'u', password: 'p' });
    expect(cfg.screen).toEqual({ width: 1366, height: 768 });
  });
});

describe('normalizeRdpjsBitmapEvent', () => {
  it('принимает плоское событие bitmap (формат node-rdpjs-2) и заполняет поля', () => {
    const data = new Uint8Array(16);
    const bitmap = normalizeRdpjsBitmapEvent({
      destTop: 10,
      destLeft: 20,
      destBottom: 18,
      destRight: 36,
      width: 4,
      height: 4,
      bitsPerPixel: 32,
      isCompress: false,
      data
    });
    expect(bitmap).not.toBeNull();
    expect(bitmap?.destLeft).toBe(20);
    expect(bitmap?.destTop).toBe(10);
    expect(bitmap?.width).toBe(4);
    expect(bitmap?.height).toBe(4);
    expect(bitmap?.bitsPerPixel).toBe(32);
    expect(bitmap?.isCompress).toBe(false);
    expect(bitmap?.data).toBe(data);
  });

  it('отбрасывает мусорные кадры вместо падения обработчика', () => {
    expect(normalizeRdpjsBitmapEvent(null)).toBeNull();
    expect(normalizeRdpjsBitmapEvent('bitmap')).toBeNull();
    expect(normalizeRdpjsBitmapEvent({ width: 0, height: 10, data: new Uint8Array(8) })).toBeNull();
    expect(normalizeRdpjsBitmapEvent({ width: 10, height: 0, data: new Uint8Array(8) })).toBeNull();
    expect(normalizeRdpjsBitmapEvent({ width: 4, height: 4, data: new Uint8Array(0) })).toBeNull();
    expect(normalizeRdpjsBitmapEvent({ width: 4, height: 4, data: 'not-a-buffer' })).toBeNull();
  });

  it('не падает на вложенном формате старого (неверного) ожидания', () => {
    // Старый код ждал { obj: { width: { value } } } — такой объект не должен
    // ронять нормализатор, а просто отбрасываться как мусор.
    const legacyShape = { obj: { width: { value: 4 }, height: { value: 4 } } };
    expect(normalizeRdpjsBitmapEvent(legacyShape)).toBeNull();
  });

  it('подставляет безопасные дефолты для некритичных полей', () => {
    const bitmap = normalizeRdpjsBitmapEvent({
      width: 2,
      height: 2,
      data: new Uint8Array(16)
    });
    expect(bitmap).not.toBeNull();
    expect(bitmap?.destLeft).toBe(0);
    expect(bitmap?.destTop).toBe(0);
    expect(bitmap?.bitsPerPixel).toBe(32);
    expect(bitmap?.isCompress).toBe(false);
  });
});
