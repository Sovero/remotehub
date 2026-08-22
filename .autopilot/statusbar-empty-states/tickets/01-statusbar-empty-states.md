# T01: Иконки в строке статуса и пустых состояниях

## Требования
R01, R02, R03, R04, A01, A02

## Что сделать
1. `src/renderer/src/components/Icon.tsx` — иконка `warning`.
2. `src/renderer/src/components/StatusBar.tsx` — ProtocolIcon протокола, StateIcon по фазам (спиннер/check/key/warning/power), «Готово» с check.
3. `src/renderer/src/App.tsx` — EmptyWorkspace: `<Icon name="host" size={44}/>`; PlaceholderPane: `<Icon name="code" size={44}/>`.
4. `src/renderer/src/components/Welcome.tsx` — логотип `<Icon name="host" size={56}/>`.
5. `src/renderer/src/styles/global.css` — `.statusbar-item` (inline-flex), `.statusbar-state--*` цвета, светлый `--ok: #259e57`.
6. `src/main/index.ts` — скан `.statusbar-item` в смоуке контраста.

## Готово, когда
- `RH_SMOKE_CONTRAST` зелёный в dev и packaged (включая статусбар).
- `RH_SMOKE_ICONS` зелёный, 107/107 тестов, typecheck чист, установщик пересобран.
