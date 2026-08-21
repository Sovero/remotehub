import { useEffect, useState } from 'react';
import { useApp } from '../store';

const FONTS = [
  { label: 'Cascadia Mono', value: '"Cascadia Mono", Consolas, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", Consolas, monospace' },
  { label: 'Fira Code', value: '"Fira Code", Consolas, monospace' },
  { label: 'DejaVu Sans Mono', value: '"DejaVu Sans Mono", monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' }
];

/** Какие моноширинные шрифты реально установлены в системе (для пометки в списке). */
function installedFonts(): Set<string> {
  if (typeof document === 'undefined') return new Set();
  const probe = (name: string): boolean => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.font = `16px "${name}", monospace`;
    const width = ctx.measureText('iiiiiiiiii').width;
    ctx.font = '16px monospace';
    return Math.abs(width - ctx.measureText('iiiiiiiiii').width) > 0.01;
  };
  const result = new Set<string>();
  for (const f of FONTS) if (probe(f.label)) result.add(f.label);
  return result;
}

/** Человекочитаемое имя первого шрифта в CSS-стеке. */
function familyName(cssStack: string): string {
  const m = cssStack.match(/(["'])?([^"',]+)\1/);
  return m ? m[2].trim() : cssStack;
}

const ACCENTS = ['#2d95ec', '#57ab5a', '#c678dd', '#e5534b', '#d29922', '#39c5cf'];

/** Форма настроек: используется во встроенной панели левого сайдбара. */
export default function SettingsForm(): React.JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const pushToast = useApp((s) => s.pushToast);
  const [fontPreview, setFontPreview] = useState(settings.fontFamily);
  const [installed, setInstalled] = useState<Set<string>>(() => installedFonts());

  // Синхронизация: внешнее изменение шрифта (Ctrl+= и т.п.) отражается в селекте.
  useEffect(() => {
    setFontPreview(settings.fontFamily);
  }, [settings.fontFamily]);

  const applyFont = (): void => {
    void patchSettings({ fontFamily: fontPreview });
    const fam = familyName(fontPreview);
    const note = installed.has(fam) ? '' : ' — шрифт не найден в системе, будет использован запасной';
    pushToast(`Шрифт терминала: ${fam}${note}`);
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
        <select className="input" value={fontPreview} onChange={(e) => setFontPreview(e.target.value)}>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
              {installed.has(f.label) ? '' : ' (не установлен)'}
            </option>
          ))}
        </select>
        <div className="form-hint" style={{ fontFamily: fontPreview }}>
          AaBbCc 123 ← терминал будет выглядеть так
        </div>
        <div className="settings-form__actions">
          <button className="btn btn--sm" onClick={applyFont}>
            Применить шрифт
          </button>
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
    </div>
  );
}
