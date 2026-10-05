import { useEffect, useState } from 'react';
import type { RdpEngine } from '@shared/types';
import { dynamicFontOptions, fontFamilyName, fontOptions, OPTIONAL_FONTS } from '@shared/fonts';
import { lastInstalledMonospaceFamilies, loadInstalledMonospaceFamilies } from '../system-fonts';
import { useApp } from '../store';

/**
 * Необязательные шрифты показываем только при наличии: canvas-проба меряет
 * строку одинаковыми символами и отсекает семейства, которых в системе нет.
 * Стандартные (Consolas, Lucida Console, Courier New) есть в любой Windows,
 * поэтому показываются всегда — устанавливать ничего не нужно.
 */
function installedOptionalFonts(): Set<string> {
  const result = new Set<string>();
  if (typeof document === 'undefined') return result;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return result;
  const sample = 'mmmmmmmmmmlli';
  const width = (stack: string): number => {
    ctx.font = `16px ${stack}`;
    return ctx.measureText(sample).width;
  };
  const widthOfFallbacks = ['monospace', 'sans-serif', 'serif'].map((family) => width(family));
  for (const font of OPTIONAL_FONTS) {
    const probeWidth = width(`"${font.label}", monospace`);
    // Нет шрифта — ширина совпадает с одним из запасных семейств.
    if (widthOfFallbacks.every((fallback) => Math.abs(probeWidth - fallback) > 0.01)) {
      result.add(font.label);
    }
  }
  return result;
}

const ACCENTS = ['#2d95ec', '#57ab5a', '#c678dd', '#e5534b', '#d29922', '#39c5cf'];

/** Форма настроек: используется во встроенной панели левого сайдбара. */
export default function SettingsForm(): React.JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const pushToast = useApp((s) => s.pushToast);
  const [installed] = useState<Set<string>>(() => installedOptionalFonts());
  const [systemFamilies, setSystemFamilies] = useState<string[] | null>(() =>
    lastInstalledMonospaceFamilies()
  );
  // Основной список — все моноширинные шрифты системы; пока он не пришёл (или
  // системный API недоступен), работаем по статическому набору. Запрос идёт
  // при каждом открытии настроек, поэтому установленный при работающем
  // приложении шрифт появляется здесь без перезапуска. Сохранённое значение в
  // обоих случаях остаётся в списке — селект не должен быть пустым.
  useEffect(() => {
    let alive = true;
    void loadInstalledMonospaceFamilies().then((families) => {
      // null — API недоступен: оставляем показанный список, не обнуляем его.
      if (alive && families && families.length > 0) setSystemFamilies(families);
    });
    return () => {
      alive = false;
    };
  }, []);
  const fontList = systemFamilies
    ? dynamicFontOptions(systemFamilies, settings.fontFamily)
    : fontOptions(installed, settings.fontFamily);

  // Шрифт применяется сразу при выборе (как тема, размер и акцентный цвет).
  const applyFont = (value: string): void => {
    void patchSettings({ fontFamily: value });
    pushToast(`Шрифт терминала: ${fontFamilyName(value)}`);
  };

  const applyRdpEngine = (rdpEngine: RdpEngine): void => {
    void patchSettings({ rdpEngine });
    pushToast(
      rdpEngine === 'iron'
        ? 'RDP: IronRDP (WASM) будет использоваться для новых подключений'
        : 'RDP: legacy canvas (node-rdpjs) будет использоваться для новых подключений'
    );
  };

  return (
    <div className="form settings-form">
      <div className="form-row">
        <label className="form-label">Тема</label>
        <div className="seg">
          <button
            className={`seg-btn${settings.theme === 'dark' ? ' seg-btn--active' : ''}`}
            onClick={() => void patchSettings({ theme: 'dark' })}
          >
            Тёмная
          </button>
          <button
            className={`seg-btn${settings.theme === 'light' ? ' seg-btn--active' : ''}`}
            onClick={() => void patchSettings({ theme: 'light' })}
          >
            Светлая
          </button>
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Шрифт терминала</label>
        <select
          className="input"
          value={settings.fontFamily}
          onChange={(e) => applyFont(e.target.value)}
        >
          {fontList.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="form-hint" style={{ fontFamily: settings.fontFamily }}>
          AaBbCc 123 ← терминал выглядит так
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Размер шрифта: {settings.fontSize}px (Ctrl+= / Ctrl+-)</label>
        <input
          className="input"
          type="range"
          min={10}
          max={22}
          value={settings.fontSize}
          onChange={(e) => void patchSettings({ fontSize: Number(e.target.value) })}
        />
      </div>

      <div className="form-row">
        <label className="form-label">Акцентный цвет</label>
        <div className="accent-row">
          {ACCENTS.map((c) => (
            <button
              key={c}
              className={`accent-swatch${settings.accent === c ? ' accent-swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => void patchSettings({ accent: c })}
              aria-label={c}
            />
          ))}
        </div>
      </div>

      <div className="form-row">
        <label className="form-label" htmlFor="rdp-engine">Движок RDP</label>
        <select
          id="rdp-engine"
          className="input"
          value={settings.rdpEngine}
          onChange={(e) => applyRdpEngine(e.target.value as RdpEngine)}
        >
          <option value="iron">IronRDP (WASM, canvas) — рекомендуется</option>
          <option value="rdpjs">Legacy canvas (node-rdpjs)</option>
        </select>
        <div className="form-hint">
          Выбор применяется к новым подключениям. Для уже открытой вкладки используйте переподключение.
        </div>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.rdpAutoFallbackToLegacy}
          onChange={(e) => void patchSettings({ rdpAutoFallbackToLegacy: e.target.checked })}
        />
        Автоматически переключаться на системный RDP, если IronRDP не смог подключиться
      </label>
      <div className="form-hint">
        Выключено — при ошибке вкладка покажет кнопку «Подключиться через системный RDP» и не подключается сама.
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.confirmOnDelete}
          onChange={(e) => void patchSettings({ confirmOnDelete: e.target.checked })}
        />
        Подтверждать удаление профилей и закрытие активных вкладок
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.restoreTabs}
          onChange={(e) => void patchSettings({ restoreTabs: e.target.checked })}
        />
        Восстанавливать вкладки после перезапуска
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.rdpAutoAcceptCert}
          onChange={(e) => void patchSettings({ rdpAutoAcceptCert: e.target.checked })}
        />
        Авто-подтверждать сертификат RDP
      </label>
      <div className="form-hint">
        Вкл: предупреждение о недоверенном сертификате гасится автоматически. Выкл: оно
        показывается при каждом подключении — вы решаете сами.
      </div>
    </div>
  );
}
