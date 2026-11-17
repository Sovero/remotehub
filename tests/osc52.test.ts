import { describe, expect, it } from 'vitest';
import { formatBytes, osc52Action, parseOsc52, utf8Length } from '../src/shared/osc52';

/** OSC 52 с системным буфером и текстом в base64. */
function osc(text: string): string {
  return `c;${Buffer.from(text, 'utf8').toString('base64')}`;
}

describe('parseOsc52', () => {
  it('декодирует текст системного буфера', () => {
    expect(parseOsc52(osc('hello'))).toBe('hello');
  });

  it('понимает многобайтовый UTF-8', () => {
    expect(parseOsc52(osc('привет'))).toBe('привет');
  });

  it('без selection считает буфер системным', () => {
    const b64 = Buffer.from('x', 'utf8').toString('base64');
    expect(parseOsc52(`;${b64}`)).toBe('x');
  });

  it('игнорирует запрос содержимого буфера', () => {
    expect(parseOsc52('c;?')).toBeNull();
  });

  it('игнорирует чужие selection и битый base64', () => {
    expect(parseOsc52(`p;${Buffer.from('x').toString('base64')}`)).toBeNull();
    expect(parseOsc52('c;@@@')).toBeNull();
    expect(parseOsc52('без разделителя')).toBeNull();
  });
});

describe('osc52Action', () => {
  it('запрет блокирует запись при любом размере', () => {
    expect(osc52Action('deny', 1000, 'x')).toBe('ignore');
  });

  it('разрешение копирует сразу', () => {
    expect(osc52Action('allow', 1000, 'x')).toBe('copy');
  });

  it('режим «спрашивать» отдаёт решение пользователю', () => {
    expect(osc52Action('ask', 1000, 'x')).toBe('ask');
  });

  it('превышение предела блокирует запись даже в режиме «спрашивать»', () => {
    expect(osc52Action('ask', 3, 'abcd')).toBe('too-large');
    expect(osc52Action('allow', 3, 'abcd')).toBe('too-large');
  });

  it('текст ровно по пределу проходит', () => {
    expect(osc52Action('allow', 4, 'abcd')).toBe('copy');
  });

  it('считает предел в байтах UTF-8, а не в символах', () => {
    expect(utf8Length('привет')).toBe(12);
    expect(osc52Action('allow', 11, 'привет')).toBe('too-large');
    expect(osc52Action('allow', 12, 'привет')).toBe('copy');
  });

  it('ноль отключает ограничение', () => {
    expect(osc52Action('allow', 0, 'любой текст')).toBe('copy');
  });

  it('пустой текст ничего не делает', () => {
    expect(osc52Action('allow', 1000, '')).toBe('ignore');
  });
});

describe('formatBytes', () => {
  it('подписывает байты, килобайты и мегабайты', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1536)).toBe('1.5 КБ');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 МБ');
  });
});
