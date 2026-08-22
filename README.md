# Remote Hub

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Electron](https://img.shields.io/badge/Electron-43.4.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078D6?logo=windows&logoColor=white)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Sovero/remotehub/pulls)

Termius-подобный рабочий стол для Windows: SSH, Telnet, RDP, VNC и SFTP.

## Возможности

- Дерево профилей с группами, поиском и тегами
- Встроенные терминалы (SSH, Telnet) на xterm.js
- VNC (noVNC) и RDP
- SFTP-файловый менеджер
- Проверка доступности хостов (TCP + ping) с живым статусом в дереве
- Наборы учётных данных, сниппеты, горячие клавиши
- Тёмная и светлая темы, настройка шрифта и акцентного цвета

## Сборка

```bash
npm ci
npm run dist
```

Установщик появится в `release/` (`Remote Hub Setup 0.1.0.exe`). Сборка под x64 (win32 + nsis).

Инсталлятор автоматически создаёт:

- ярлык на рабочем столе (пересоздаётся даже при переустановке);
- ярлык в меню «Пуск» → «Remote Hub»;
- запускает приложение после установки.

## Код-подпись

Подписанная сборка (SHA-256 + RFC 3161 таймстамп, чтобы подпись не «протухала»):

```bash
cp cert.env.example cert.env
# заполните cert.env: путь к PFX-сертификату и пароль
npm run dist:sign
```

`cert.env` добавлен в `.gitignore` и в репозиторий не попадает. Сертификат передаётся
через стандартные переменные electron-builder `CSC_LINK` / `CSC_KEY_PASSWORD`
(на Windows — `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`). Если сертификат не задан,
`npm run dist:sign` соберёт инсталлятор без подписи — так же, как `npm run dist`.

Таймстамп-сервер задан в `build.win.signtoolOptions.rfc3161TimeStampServer`
(`http://timestamp.digicert.com`); при необходимости замените его на сервер вашего
удостоверяющего центра.

## Автообновление

Приложение проверяет обновления в фоне (при старте и раз в 4 часа) и скачивает их
автоматически. Пользователь видит баннер со статусом и сам запускает установку
(«Перезапустить и установить»), либо обновление устанавливается при выходе из
приложения. Пункт меню **Помощь → Проверить обновления** запускает проверку вручную.

Источник обновлений — GitHub Releases (`build.publish`, репозиторий `Sovero/remotehub`).

**Проверка подписи.** `build.win.verifyUpdateCodeSignature` включён, поэтому
electron-updater отклонит неподписанный инсталлятор или инсталлятор, подписанный
другим издателем. Значение `build.win.publisherName` (`Remote Hub`) должно **точно**
совпадать с именем издателя в вашем сертификате код-подписи — при получении сертификата
поправьте это поле.

Публикация новой версии:

```bash
npm version patch          # поднять версию в package.json
npm run dist:sign          # собрать и подписать инсталлятор
# загрузить release/Remote Hub Setup <версия>.exe в GitHub Release;
# electron-builder сам публикует артефакты и latest.yml при настроенном GH_TOKEN:
GH_TOKEN=... npx electron-builder --win --x64 --publish always
```

В dev-режиме (`npm run dev`) автообновление отключено: electron-updater работает
только в установленной сборке.

## Разработка

```bash
npm run dev     # dev-режим (electron-vite)
npm run typecheck
npm test
```

## Лицензия

[MIT](LICENSE) © 2026 Remote Hub
