/**
 * Ограничитель потока console.* рендерера (src/main/renderer-log-throttle.ts).
 *
 * Проверяем три свойства, из-за которых он появился:
 *  - ошибки/предупреждения не теряются никогда;
 *  - подряд идущие дубликаты info не плодят записи (каждая запись = IPC во все окна);
 *  - сверх лимита info схлопывается в одну строку-сводку, а не выбрасывается молча.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRendererLogThrottle, type RendererLogSink } from '../src/main/renderer-log-throttle';
import type { LogLevel, LogSource } from '../src/main/log';

interface Call {
  level: LogLevel;
  source: LogSource;
  message: string;
}

function makeSink(): { calls: Call[]; sink: RendererLogSink } {
  const calls: Call[] = [];
  return {
    calls,
    sink: (level, source, message) => calls.push({ level, source, message })
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('renderer-log-throttle', () => {
  it('ошибки и предупреждения проходят всегда, независимо от лимита', () => {
    const { calls, sink } = makeSink();
    const t = createRendererLogThrottle(sink, { maxPerWindow: 2, windowMs: 1000 });
    for (let i = 0; i < 10; i++) t.offer('error', `ошибка ${i}`);
    for (let i = 0; i < 10; i++) t.offer('warn', `варн ${i}`);
    expect(calls).toHaveLength(20);
    expect(calls.every((c) => c.level !== 'info')).toBe(true);
  });

  it('подряд идущие дубликаты info подавляются, сводка приходит через окно', () => {
    const { calls, sink } = makeSink();
    const t = createRendererLogThrottle(sink);
    for (let i = 0; i < 5; i++) t.offer('info', 'одно и то же');
    expect(calls).toHaveLength(1);
    expect(calls[0].message).toBe('одно и то же');

    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(2);
    expect(calls[1].message).toContain('подавлено 4');
    expect(calls[1].source).toBe('app');
  });

  it('разные сообщения внутри лимита проходят по одному', () => {
    const { calls, sink } = makeSink();
    const t = createRendererLogThrottle(sink, { maxPerWindow: 20, windowMs: 1000 });
    for (let i = 0; i < 20; i++) t.offer('info', `сообщение ${i}`);
    expect(calls).toHaveLength(20);
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(20); // подавленного не было — сводки нет
  });

  it('сверх лимита за окно info схлопывается в одну сводку, ничего не теряется молча', () => {
    const { calls, sink } = makeSink();
    const t = createRendererLogThrottle(sink, { maxPerWindow: 20, windowMs: 1000 });
    for (let i = 0; i < 25; i++) t.offer('info', `сообщение ${i}`);
    expect(calls).toHaveLength(20);

    vi.advanceTimersByTime(1000);
    const summary = calls[calls.length - 1];
    expect(summary.message).toContain('подавлено 5');
    expect(summary.level).toBe('info');
  });

  it('после окна лимит сбрасывается — новые сообщения снова проходят', () => {
    const { calls, sink } = makeSink();
    const t = createRendererLogThrottle(sink, { maxPerWindow: 1, windowMs: 1000 });
    t.offer('info', 'первое');
    t.offer('info', 'второе'); // лимит окна
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(calls.at(-1)?.message).toContain('подавлено 1');
    t.offer('info', 'третье');
    expect(calls.at(-1)?.message).toBe('третье');
  });

  it('reset() очищает накопленное без сводки', () => {
    const { calls, sink } = makeSink();
    const t = createRendererLogThrottle(sink);
    t.offer('info', 'спам');
    t.offer('info', 'спам');
    t.reset();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
  });
});
