/**
 * Перечисление установленных в системе моноширинных шрифтов.
 *
 * Основной путь — Local Font Access API (`window.queryLocalFonts`): он отдаёт
 * семейства шрифтов напрямую из системы, поэтому список в настройках — не
 * предопределённый, а фактический. Моноширинность API не сообщает, её
 * определяет canvas-проба (см. `createMonospaceProbe`).
 *
 * Если API недоступен или в доступе отказано, возвращаем null — вызывающий
 * переключается на статический набор из shared/fonts.ts.
 */
import { fontValue, quotedFamily } from '@shared/fonts';

/** Узкие и широкие глифы: в моноширинном шрифте их ширина совпадает. */
const NARROW = 'iiiiiiiiii';
const WIDE = 'mmmmmmmmmm';
/** Заведомо отсутствующее семейство — эталон подстановки запасного шрифта. */
const MISSING_FONT = quotedFamily('__remotehub_no_such_font__');
/**
 * Порог «строчные заметно ниже прописных». У текстовых шрифтов отношение
 * высоты строчных к прописным ≤ 0.8; у символьных (Wingdings, Marlett,
 * Bookshelf Symbol) значки занимают почти полную высоту em, и отношение ~1.0.
 */
const MAX_LOWER_TO_CAPS_RATIO = 0.9;

function createMonospaceProbe(ctx: CanvasRenderingContext2D): (family: string) => boolean {
  const measure = (stack: string, text: string): TextMetrics => {
    ctx.font = `16px ${stack}`;
    return ctx.measureText(text);
  };
  return (family: string): boolean => {
    // 1. Моноширинность: ширина строки из узких и широких глифов одинакова.
    if (Math.abs(measure(fontValue(family), NARROW).width - measure(fontValue(family), WIDE).width) > 0.01) {
      return false;
    }
    // 2. Семейство реально найдено: его метрики отличаются от подстановки
    //    запасным шрифтом (иначе в списке были бы шрифты без латинских глифов).
    const ownFamily = quotedFamily(family);
    const resolved = [NARROW, WIDE, '0123456789', 'Wg@'].some(
      (text) => Math.abs(measure(ownFamily, text).width - measure(MISSING_FONT, text).width) > 0.01
    );
    if (!resolved) return false;
    // 3. Это текстовый шрифт, а не набор значков: строчные ниже прописных.
    const caps = measure(ownFamily, 'M').actualBoundingBoxAscent;
    const lower = measure(ownFamily, 'm').actualBoundingBoxAscent;
    return caps > 0 && lower / caps <= MAX_LOWER_TO_CAPS_RATIO;
  };
}

async function queryOnce(): Promise<string[] | null> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<readonly { family?: string }[]> })
    .queryLocalFonts;
  if (typeof query !== 'function') return null;
  let fonts: readonly { family?: string }[];
  try {
    fonts = await query();
  } catch {
    // Разрешение не выдано или API отключён — сигнал перейти на статический набор.
    return null;
  }
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  const probe = createMonospaceProbe(ctx);
  const unique = new Map<string, string>();
  for (const font of fonts) {
    const name = (font.family ?? '').trim();
    if (name) unique.set(name.toLowerCase(), name);
  }
  return [...unique.values()].filter(probe);
}

/** Последний успешный результат — начальное значение при следующем открытии. */
let lastFamilies: string[] | null = null;

/**
 * Все моноширинные семейства, установленные в системе (или null, если системный
 * API недоступен). Запрос выполняется при каждом вызове: шрифт, установленный
 * при работающем приложении, появляется в списке при следующем открытии
 * настроек, без перезапуска. Открытие настроек — редкое действие, поэтому
 * повторный запрос систему не нагружает.
 */
export async function loadInstalledMonospaceFamilies(): Promise<string[] | null> {
  const families = await queryOnce();
  if (families && families.length > 0) lastFamilies = families;
  return families;
}

/**
 * Список из последнего успешного запроса: пока новый запрос выполняется, форма
 * настроек показывает его — список не мигает статическим набором при открытии.
 */
export function lastInstalledMonospaceFamilies(): string[] | null {
  return lastFamilies;
}
