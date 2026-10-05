/**
 * R02: политика автоперехода на системный RDP при ошибке IronRDP.
 * Чистая функция — UI и store только вызывают её, решение живёт здесь.
 */
import { describe, expect, it } from 'vitest';
import { shouldAutoFallbackToLegacy } from '../src/shared/rdp-engine';

/** База: RDP-вкладка на IronRDP, ошибка подключения, галочка включена. */
const base = { kind: 'rdp', engine: 'iron' as const, phase: 'error', enabled: true };

describe('shouldAutoFallbackToLegacy — политика автоперехода (R02)', () => {
  it('RDP-вкладка на iron с ошибкой и включённой галочкой — переходим сами', () => {
    expect(shouldAutoFallbackToLegacy(base)).toBe(true);
  });

  it('галочка снята — решение остаётся пользователю (кнопка в оверлее)', () => {
    expect(shouldAutoFallbackToLegacy({ ...base, enabled: false })).toBe(false);
  });

  it('не RDP-вкладка — не переходим', () => {
    expect(shouldAutoFallbackToLegacy({ ...base, kind: 'terminal' })).toBe(false);
    expect(shouldAutoFallbackToLegacy({ ...base, kind: 'vnc' })).toBe(false);
    expect(shouldAutoFallbackToLegacy({ ...base, kind: 'sftp' })).toBe(false);
  });

  it('ошибка уже на системном или rdpjs-движке — второго перехода нет (петля исключена)', () => {
    expect(shouldAutoFallbackToLegacy({ ...base, engine: 'legacy' })).toBe(false);
    expect(shouldAutoFallbackToLegacy({ ...base, engine: 'rdpjs' })).toBe(false);
  });

  it('фаза не error — не переходим', () => {
    for (const phase of ['connecting', 'connected', 'closed']) {
      expect(shouldAutoFallbackToLegacy({ ...base, phase })).toBe(false);
    }
  });

  it('автопереход на этой вкладке уже запускался — повторно не переходим', () => {
    expect(shouldAutoFallbackToLegacy({ ...base, alreadyAttempted: true })).toBe(false);
  });
});
