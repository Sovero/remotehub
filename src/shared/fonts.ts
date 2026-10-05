/**
 * Набор шрифтов для настроек терминала.
 *
 * Основной путь — динамический список: renderer спрашивает у системы все
 * моноширинные семейства (см. src/renderer/src/system-fonts.ts) и строит
 * варианты через `dynamicFontOptions`. Статический набор ниже — запасной: он
 * работает, когда системный API недоступен, и содержит только то, что реально
 * есть в системе (стандартные шрифты Windows — всегда, популярные
 * дополнительные — если найдены).
 */

export interface FontOption {
  label: string;
  value: string;
}

/** Стандартные моноширинные шрифты Windows — есть всегда, установка не нужна. */
export const STANDARD_FONTS: readonly FontOption[] = [
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'Lucida Console', value: '"Lucida Console", Consolas, monospace' },
  { label: 'Courier New', value: '"Courier New", Consolas, monospace' }
];

/** Популярные шрифты, которых может не быть: показываются, только если установлены. */
export const OPTIONAL_FONTS: readonly FontOption[] = [
  { label: 'Cascadia Mono', value: '"Cascadia Mono", Consolas, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
  { label: 'Fira Code', value: '"Fira Code", Consolas, monospace' },
  { label: 'DejaVu Sans Mono', value: '"DejaVu Sans Mono", Consolas, monospace' }
];

/** Шрифт терминала по умолчанию — стандартный и всегда доступный. */
export const DEFAULT_FONT_FAMILY = 'Consolas, "Courier New", monospace';

/** Старый дефолт прежних версий: первым стоял Cascadia Mono, которого может не быть в системе. */
export const LEGACY_DEFAULT_FONT_FAMILY = '"Cascadia Mono", Consolas, "Courier New", monospace';

/** Человекочитаемое имя первого шрифта в CSS-стеке. */
export function fontFamilyName(cssStack: string): string {
  const m = cssStack.match(/(["'])?([^"',]+)\1/);
  return m ? m[2].trim() : cssStack.trim();
}

/** Старый дефолт переводится на стандартный шрифт; осознанный выбор пользователя не трогаем. */
export function normalizeFontFamily(fontFamily: string): string {
  return fontFamily === LEGACY_DEFAULT_FONT_FAMILY ? DEFAULT_FONT_FAMILY : fontFamily;
}

/**
 * Запасной список, когда системный API недоступен: стандартные шрифты, затем
 * установленные дополнительные. Сохранённое значение, которого нет в списке
 * (например, выбранное в прежней версии), добавляется отдельным пунктом —
 * селект не должен оставаться без выбранного шрифта.
 */
export function fontOptions(installed: ReadonlySet<string>, current: string): FontOption[] {
  const options: FontOption[] = [
    ...STANDARD_FONTS,
    ...OPTIONAL_FONTS.filter((font) => installed.has(font.label))
  ];
  if (current && !options.some((option) => option.value === current)) {
    options.push({ label: `${fontFamilyName(current)} — текущий выбор`, value: current });
  }
  return options;
}

/** CSS-имя семейства в кавычках (кавычки и обратные слэши экранируются). */
export function quotedFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`;
}

/** Значение настройки для семейства: сам шрифт плюс запасной моноширинный. */
export function fontValue(family: string): string {
  return `${quotedFamily(family)}, monospace`;
}

/**
 * Динамический список: все установленные в системе моноширинные семейства,
 * отсортированные по алфавиту. Сохранённое значение не теряется: если его
 * первый шрифт есть в списке, вариант этого семейства получает текущий стек
 * (селект остаётся валидным); если такого семейства нет — значение добавляется
 * отдельным пунктом «— текущий выбор».
 */
export function dynamicFontOptions(families: readonly string[], current: string): FontOption[] {
  const options: FontOption[] = [];
  const seen = new Set<string>();
  for (const family of families) {
    const name = family.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    options.push({ label: name, value: fontValue(name) });
  }
  if (current) {
    const currentName = fontFamilyName(current).toLowerCase();
    const match = options.find((option) => option.label.toLowerCase() === currentName);
    if (match) match.value = current;
    else options.push({ label: `${fontFamilyName(current)} — текущий выбор`, value: current });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  return options;
}
