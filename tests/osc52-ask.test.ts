import { describe, expect, it, vi } from 'vitest';
import { dispatchOsc52, osc52Action, utf8Length } from '../src/shared/osc52';

/** Шпионы вместо буфера обмена, модалки подтверждения и тоста. */
function effects() {
  return { copy: vi.fn(), ask: vi.fn(), tooLarge: vi.fn() };
}

describe('dispatchOsc52: политика «спрашивать»', () => {
  it('ask показывает подтверждение и не пишет в буфер', () => {
    const e = effects();
    const text = 'mv ~/report.txt /backup/';

    expect(dispatchOsc52('ask', 100000, text, e)).toBe('ask');
    expect(e.copy).not.toHaveBeenCalled();
    expect(e.tooLarge).not.toHaveBeenCalled();
    expect(e.ask).toHaveBeenCalledTimes(1);
    expect(e.ask).toHaveBeenCalledWith({ text, bytes: utf8Length(text), preview: text });
  });

  it('ask отдаёт модалке размер в байтах и обрезанный предпросмотр', () => {
    const e = effects();
    const text = ['A'.repeat(300), 'b', 'c', 'd', 'e'].join('\n');

    dispatchOsc52('ask', 100000, text, e);

    expect(e.copy).not.toHaveBeenCalled();
    // Полный текст остаётся для записи, а в модалку идут размер и обрезка:
    // 4 строки по 120 символов плюс пометка об обрыве.
    expect(e.ask).toHaveBeenCalledWith({
      text,
      bytes: 308,
      preview: `${'A'.repeat(120)}…\nb\nc\nd\n…`
    });
  });

  it('ask считает размер кириллицы в байтах UTF-8', () => {
    const e = effects();

    dispatchOsc52('ask', 100000, 'привет', e);

    expect(e.ask).toHaveBeenCalledWith({ text: 'привет', bytes: 12, preview: 'привет' });
  });

  it('ask не доходит до модалки, если текст больше предела', () => {
    const e = effects();

    expect(dispatchOsc52('ask', 10, 'x'.repeat(11), e)).toBe('too-large');
    expect(osc52Action('ask', 10, 'x'.repeat(11))).toBe('too-large');
    expect(e.ask).not.toHaveBeenCalled();
    expect(e.copy).not.toHaveBeenCalled();
    expect(e.tooLarge).toHaveBeenCalledWith(10);
  });
});

describe('dispatchOsc52: остальные политики', () => {
  it('allow пишет в буфер без подтверждения', () => {
    const e = effects();

    expect(dispatchOsc52('allow', 100000, 'hello', e)).toBe('copy');
    expect(e.copy).toHaveBeenCalledWith('hello');
    expect(e.ask).not.toHaveBeenCalled();
  });

  it('deny и пустой текст не делают ничего', () => {
    const e = effects();

    expect(dispatchOsc52('deny', 100000, 'hello', e)).toBe('ignore');
    expect(dispatchOsc52('allow', 100000, '', e)).toBe('ignore');
    expect(e.copy).not.toHaveBeenCalled();
    expect(e.ask).not.toHaveBeenCalled();
    expect(e.tooLarge).not.toHaveBeenCalled();
  });
});
