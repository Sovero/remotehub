/**
 * Список шрифтов в настройках — только доступное в системе.
 *
 * Стандартные шрифты Windows (Consolas, Lucida Console, Courier New) есть
 * всегда, дополнительные (Cascadia Mono и др.) показываются, лишь если
 * установлены. Чистая логика живёт здесь, DOM-проба — в компоненте.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_FAMILY,
  LEGACY_DEFAULT_FONT_FAMILY,
  fontOptions,
  normalizeFontFamily,
  OPTIONAL_FONTS,
  STANDARD_FONTS
} from '../src/shared/fonts';

describe('список шрифтов терминала', () => {
  it('стандартные шрифты показываются всегда и ничего не требуют устанавливать', () => {
    const options = fontOptions(new Set<string>(), DEFAULT_FONT_FAMILY);
    expect(options.map((o) => o.label)).toEqual(['Consolas', 'Lucida Console', 'Courier New']);
    expect(options.every((o) => o.value.includes('monospace'))).toBe(true);
  });

  it('дефолтный шрифт — стандартный Consolas и он есть в списке', () => {
    expect(DEFAULT_FONT_FAMILY.startsWith('Consolas')).toBe(true);
    expect(fontOptions(new Set<string>(), DEFAULT_FONT_FAMILY).some((o) => o.value === DEFAULT_FONT_FAMILY)).toBe(true);
  });

  it('установленные дополнительные шрифты добавляются в список', () => {
    const labels = fontOptions(new Set(['Cascadia Mono', 'Fira Code']), DEFAULT_FONT_FAMILY).map(
      (o) => o.label
    );
    expect(labels).toContain('Cascadia Mono');
    expect(labels).toContain('Fira Code');
  });

  it('неустановленные дополнительные шрифты в списке не появляются', () => {
    const labels = fontOptions(new Set<string>(), DEFAULT_FONT_FAMILY).map((o) => o.label);
    for (const font of OPTIONAL_FONTS) expect(labels).not.toContain(font.label);
  });

  it('старый дефолт (Cascadia Mono первым) заменяется стандартным шрифтом', () => {
    expect(normalizeFontFamily(LEGACY_DEFAULT_FONT_FAMILY)).toBe(DEFAULT_FONT_FAMILY);
    expect(normalizeFontFamily(DEFAULT_FONT_FAMILY)).toBe(DEFAULT_FONT_FAMILY);
    // Осознанный выбор пользователя не переписываем.
    expect(normalizeFontFamily('Fira Code, Consolas, monospace')).toBe('Fira Code, Consolas, monospace');
  });

  it('сохранённое значение вне списка показывается отдельным пунктом — селект не пустой', () => {
    const current = '"Cascadia Code", Consolas, monospace';
    const options = fontOptions(new Set<string>(), current);
    const last = options[options.length - 1];
    expect(last.label).toBe('Cascadia Code — текущий выбор');
    expect(last.value).toBe(current);
  });

  it('текущее значение из списка не дублируется', () => {
    const options = fontOptions(new Set(['Cascadia Mono']), DEFAULT_FONT_FAMILY);
    expect(options.filter((o) => o.value === DEFAULT_FONT_FAMILY)).toHaveLength(1);
    expect(options.map((o) => o.label)).not.toContain('Consolas — текущий выбор');
  });

  it('стандартные и дополнительные значения шрифтов уникальны', () => {
    const values = [...STANDARD_FONTS, ...OPTIONAL_FONTS].map((f) => f.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
