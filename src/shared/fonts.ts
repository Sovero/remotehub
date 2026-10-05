/**
 * Набор шрифтов для настроек терминала.
 *
 * В списке — только то, что реально доступно на Windows, чтобы ничего не
 * приходилось устанавливать: стандартные шрифты (Consolas, Lucida Console,
 * Courier New) есть в любой системе, а популярные дополнительные (Cascadia
 * Mono, JetBrains Mono, Fira Code, DejaVu Sans Mono) добавляются, только если
 * найдены в системе.
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
 * Список для выпадающего списка настроек: стандартные шрифты, затем
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
