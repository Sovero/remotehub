# Спека: иконки в строке статуса и пустых состояниях

## Требования

### R01 — строка статуса активной сессии
- `StatusBar`: перед «PROTOCOL · title» — `ProtocolIcon` протокола сессии (12px).
- Состояние — inline-flex с иконкой и текстом:
  - `connecting` — спиннер (`.icon-spin`);
  - `connected` — `check` (цвет `--ok`);
  - `auth-required` — `key` (цвет `--warn`);
  - `error` — `warning` (новая иконка, цвет `--danger`);
  - `closed` — `power`.
- Без сессии: «Готово» с иконкой `check`.

### R02 — иконки состояний
- В набор Icon добавлена `warning` (треугольник с восклицательным знаком).
- Цвета состояний через `.statusbar-state--connected/--error/--auth-required`.

### R03 — EmptyWorkspace
- Глиф `▤` заменён на `<Icon name="host" size={44} />` (монитор) в `.placeholder-icon` (декоративная прозрачность сохранена).
- `PlaceholderPane` («не реализован») — `<Icon name="code" size={44} />`.

### R04 — Welcome
- Логотип `◈` → `<Icon name="host" size={56} />` (акцентный цвет через `.welcome-logo`).

### A01/A02 — контраст
- Смоук `RH_SMOKE_CONTRAST` сканирует `.statusbar-item` во всех 12 комбинациях.
- Светлый `--ok` затемнён `#27ae60 → #259e57`: «Готово» и точки-статусы на белом ≥ 3.4:1.

## Проверка
- Скриншоты (Welcome, EmptyWorkspace) — визуально подтверждены.
- `RH_SMOKE_CONTRAST` и `RH_SMOKE_ICONS` зелёные в dev и packaged; 107/107 тестов; typecheck чист.
