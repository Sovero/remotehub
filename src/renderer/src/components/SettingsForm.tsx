import { useState } from 'react';
import { useApp } from '../store';

const FONTS = [
  '"Cascadia Mono", Consolas, monospace',
  'Consolas, monospace',
  '"JetBrains Mono", Consolas, monospace',
  '"Fira Code", Consolas, monospace',
  '"DejaVu Sans Mono", monospace',
  '"Courier New", monospace'
];

const ACCENTS = ['#2d95ec', '#57ab5a', '#c678dd', '#e5534b', '#d29922', '#39c5cf'];

/** Форма настроек: используется во встроенной панели левого сайдбара. */
export default function SettingsForm(): React.JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const [fontPreview, setFontPreview] = useState(settings.fontFamily);

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
            <option key={f} value={f}>
              {f.split('"')[1] ?? f}
            </option>
          ))}
        </select>
        <div className="form-hint" style={{ fontFamily: fontPreview }}>
          AaBbCc 123 ← терминал будет выглядеть так
        </div>
        <div className="settings-form__actions">
          <button className="btn btn--sm" onClick={() => void patchSettings({ fontFamily: fontPreview })}>
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
