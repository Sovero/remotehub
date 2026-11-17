import { describe, expect, it } from 'vitest';
import { parseOsc52 } from '../src/shared/osc52';

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

  it('без selection считает буфер системным — так шлёт tmux', () => {
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
