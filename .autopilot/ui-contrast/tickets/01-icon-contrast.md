# T01: Контраст иконок и видимость кнопок-иконок

## Требования
R01, R02, R03, R04, A01, A02, A03

## Что сделать
1. `App.tsx` — `relativeLuminance`, `accentFg` (`--accent-fg`), `mixWithBlack`, `accentHover` (`--accent-hover`).
2. `global.css` — `--accent-fg` на всех акцентных поверхностях; `--text-muted` светлой темы; `.tabbar-new`/`.tab-close`/`.tab-save`/`.avail-tip__close` — полный цвет текста; `.ctxmenu-icon` без прозрачности; `.tree-tag` через `color-mix`; `:focus-visible`.
3. `main.tsx` — хук `window.__RH_STORE__`.
4. `src/main/index.ts` — смоук `RH_SMOKE_CONTRAST` (12 комбинаций, hover по CSS-переменным) + хук скриншотов `RH_SHOT_DIR`.

## Готово, когда
- `RH_SMOKE_CONTRAST` зелёный в dev и packaged: все комбинации ≥ 3:1, hover ≥ 3:1.
- `RH_SMOKE_ICONS` зелёный, 107/107 тестов, typecheck чист, установщик пересобран.
