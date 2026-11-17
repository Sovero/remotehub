import { describe, expect, it, vi } from 'vitest';
import {
  clipboardDecision,
  clipboardPreview,
  formatBytes,
  utf8Length,
  dispatchRemoteCopy
} from '../src/shared/clipboard-policy';

/** Шпионы вместо буфера обмена, диалога подтверждения и тоста. */
function effects() {
  return { copy: vi.fn(), ask: vi.fn(), tooLarge: vi.fn() };
}

describe('clipboardDecision', () => {
  it('запрет блокирует запись при любом размере', () => {
    expect(clipboardDecision('deny', 1000, 'x')).toBe('ignore');
  });

  it('разрешение копирует сразу, режим «спрашивать» отдаёт решение пользователю', () => {
    expect(clipboardDecision('allow', 1000, 'x')).toBe('copy');
    expect(clipboardDecision('ask', 1000, 'x')).toBe('ask');
  });

  it('превышение предела блокирует запись даже в режиме «спрашивать»', () => {
    expect(clipboardDecision('ask', 3, 'abcd')).toBe('too-large');
    expect(clipboardDecision('allow', 3, 'abcd')).toBe('too-large');
    expect(clipboardDecision('allow', 4, 'abcd')).toBe('copy');
  });

  it('считает предел в байтах UTF-8, а не в символах', () => {
    expect(utf8Length('привет')).toBe(12);
    expect(clipboardDecision('allow', 11, 'привет')).toBe('too-large');
    expect(clipboardDecision('allow', 12, 'привет')).toBe('copy');
  });

  it('ноль отключает ограничение, пустой текст ничего не делает', () => {
    expect(clipboardDecision('allow', 0, 'любой текст')).toBe('copy');
    expect(clipboardDecision('allow', 1000, '')).toBe('ignore');
  });
});

describe('clipboardPreview', () => {
  it('оставляет короткий текст как есть', () => {
    expect(clipboardPreview('hello')).toBe('hello');
  });

  it('режет длинную строку и лишние строки', () => {
    const text = ['A'.repeat(300), 'b', 'c', 'd', 'e'].join('\n');
    expect(clipboardPreview(text)).toBe(`${'A'.repeat(120)}…\nb\nc\nd\n…`);
  });
});

describe('dispatchRemoteCopy: политика «спрашивать»', () => {
  it('ask показывает подтверждение и не пишет в буфер', () => {
    const e = effects();
    const text = 'mv ~/report.txt /backup/';

    expect(dispatchRemoteCopy('ask', 100000, text, 'SSH · web-01', e)).toBe('ask');
    expect(e.copy).not.toHaveBeenCalled();
    expect(e.tooLarge).not.toHaveBeenCalled();
    expect(e.ask).toHaveBeenCalledTimes(1);
    expect(e.ask).toHaveBeenCalledWith({
      text,
      bytes: utf8Length(text),
      preview: text,
      source: 'SSH · web-01'
    });
  });

  it('ask отдаёт диалогу размер в байтах, предпросмотр и источник', () => {
    const e = effects();
    const text = ['A'.repeat(300), 'b', 'c', 'd', 'e'].join('\n');

    dispatchRemoteCopy('ask', 100000, text, 'RDP · 10.0.0.5', e);

    expect(e.copy).not.toHaveBeenCalled();
    expect(e.ask).toHaveBeenCalledWith({
      text,
      bytes: 308,
      preview: `${'A'.repeat(120)}…\nb\nc\nd\n…`,
      source: 'RDP · 10.0.0.5'
    });
  });

  it('ask не доходит до диалога, если текст больше предела', () => {
    const e = effects();

    expect(dispatchRemoteCopy('ask', 10, 'x'.repeat(11), 'VNC · сервер', e)).toBe('too-large');
    expect(e.ask).not.toHaveBeenCalled();
    expect(e.copy).not.toHaveBeenCalled();
    expect(e.tooLarge).toHaveBeenCalledWith(10);
  });
});

describe('dispatchRemoteCopy: остальные политики', () => {
  it('allow пишет в буфер без подтверждения', () => {
    const e = effects();

    expect(dispatchRemoteCopy('allow', 100000, 'hello', 'VNC · сервер', e)).toBe('copy');
    expect(e.copy).toHaveBeenCalledWith('hello');
    expect(e.ask).not.toHaveBeenCalled();
  });

  it('deny и пустой текст не делают ничего', () => {
    const e = effects();

    expect(dispatchRemoteCopy('deny', 100000, 'hello', 'SSH · web-01', e)).toBe('ignore');
    expect(dispatchRemoteCopy('allow', 100000, '', 'SSH · web-01', e)).toBe('ignore');
    expect(e.copy).not.toHaveBeenCalled();
    expect(e.ask).not.toHaveBeenCalled();
    expect(e.tooLarge).not.toHaveBeenCalled();
  });
});

describe('formatBytes', () => {
  it('подписывает байты, килобайты и мегабайты', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1536)).toBe('1.5 КБ');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 МБ');
  });
});
