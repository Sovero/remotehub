# Interfaces — что изменилось для следующих тикетов

## UI

- `LoadingSplash` (App.tsx) — заставка до готовности: `.loading-logo`,
  `.loading-name`, `.loading-version` («Версия X.Y.Z»), `.loading-progress`
  (анимация точек). Версию получает сам через `window.api.appInfo()`.
- `InteractiveTour` — в футере тултипа `.tour-tooltip-version` (vX.Y.Z)
  из `appInfo` стора; виден на каждом шаге.

## Смоук

- Смоук иконок: `ui-version=1` — проверяет заставку (`ready:false` →
  `.loading-version` по шаблону `Версия X.Y.Z`) и тур
  (`.tour-tooltip-version` по шаблону `vX.Y.Z`, оверлей закрывается).
