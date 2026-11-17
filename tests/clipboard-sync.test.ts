import { describe, expect, it, vi } from 'vitest';
import { createClipboardSync } from '../src/renderer/src/lib/clipboard';

/** Сессия-заглушка: «локальный буфер» вместо буфера Windows, push вместо протокола. */
function session(local = '') {
  let buffer = local;
  const push = vi.fn((_text: string) => {});
  const sync = createClipboardSync({ push, read: async () => buffer });
  return {
    sync,
    push,
    setLocal: (text: string) => {
      buffer = text;
    }
  };
}

describe('createClipboardSync: локальный буфер → сессия', () => {
  it('отправляет изменившееся локальное содержимое один раз', async () => {
    const s = session('hello');

    await s.sync.pushCurrent();
    await s.sync.pushCurrent();

    expect(s.push).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledWith('hello');
  });

  it('не отправляет пустой буфер', async () => {
    const s = session('');

    await s.sync.pushCurrent();

    expect(s.push).not.toHaveBeenCalled();
  });

  it('force отправляет текст повторно: сервер просит именно текущий буфер', async () => {
    const s = session('hello');

    s.sync.pushLocal('hello');
    s.sync.pushLocal('hello', true);

    expect(s.push).toHaveBeenCalledTimes(2);
  });

  it('ничего не отправляет, пока сессия не готова', async () => {
    const push = vi.fn((_text: string) => {});
    const sync = createClipboardSync({ push, isReady: () => false, read: async () => 'hello' });

    await sync.pushCurrent();

    expect(push).not.toHaveBeenCalled();
  });
});

describe('createClipboardSync: текст не гуляет по кругу', () => {
  it('не возвращает серверу неизменившийся локальный буфер после удалённого события', async () => {
    // Регресс живой VNC-проверки: при ask/deny отказ оставлял локальный буфер
    // прежним, опрос считал его новым и отправлял назад — сервер отвечал эхом,
    // и подтверждение подменялось нашим же текстом.
    const s = session('local-text');

    await s.sync.pushCurrent();
    expect(s.push).toHaveBeenCalledTimes(1);

    s.sync.markRemote('remote-text');
    await s.sync.pushCurrent();
    await s.sync.pushCurrent();

    expect(s.push).toHaveBeenCalledTimes(1);
  });

  it('не отправляет назад текст, который приняли с сервера', async () => {
    const s = session('local-text');

    s.sync.markRemote('remote-text');
    s.setLocal('remote-text');
    await s.sync.pushCurrent();

    expect(s.push).not.toHaveBeenCalled();
  });

  it('после удалённого события всё равно отправляет новое локальное копирование', async () => {
    const s = session('local-text');

    s.sync.markRemote('remote-text');
    s.setLocal('copied-by-user');
    await s.sync.pushCurrent();

    expect(s.push).toHaveBeenCalledTimes(1);
    expect(s.push).toHaveBeenCalledWith('copied-by-user');
  });
});
