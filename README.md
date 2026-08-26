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

### Как получить «рабочую» подпись для автообновления

1. Купите код-подписывающий сертификат в удостоверяющем центре (DigiCert, Sectigo,
   GlobalSign и т.п.) — выдаётся только после проверки владельца, это платно.
   Подойдёт и сертификат от Azure Trusted Signing (без PFX, через `azureSignOptions`).
2. **CN (общее имя) сертификата должен быть `Remote Hub`** — по нему electron-updater
   сверяет подпись с `build.win.signtoolOptions.publisherName`. Если CN другой,
   поправьте `publisherName` на своё значение (и в `app-update.yml` после сборки
   окажется именно оно).
3. Экспортируйте сертификат в PFX (с приватным ключом, с паролем) и укажите его
   в `cert.env`. Соберите: `npm run dist:sign`.
4. Проверьте, что подпись читается: `Get-AuthenticodeSignature "release/Remote Hub Setup <версия>.exe"`
   — `Status` должен быть `Valid`, `SignerCertificate.Subject` — `CN=Remote Hub`.

Самоподписанный сертификат для автообновления **не подходит**: electron-updater
требует `Status = Valid`, то есть цепочку до доверенного корня. У сертификата УЦ
доверие автоматическое; у самоподписанного — только если вручную добавить его
в корневые доверенные хранилища каждой машины.

### Проверка пайплайна подписи без покупки сертификата

`scripts/make-test-cert.ps1` генерирует самоподписанный тестовый сертификат
`CN=Remote Hub` и экспортирует `certs/remote-hub-test.pfx` (пароль `remotehub-test`),
чтобы проверить всю цепочку сборки — signtool, таймстамп, имя издателя:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/make-test-cert.ps1
$env:CSC_LINK = "certs/remote-hub-test.pfx"
$env:CSC_KEY_PASSWORD = "remotehub-test"
npx electron-builder --win --x64 --config.directories.output=release-signed
```

Подпись появится (`Get-AuthenticodeSignature` покажет `CN=Remote Hub` и таймстамп),
но `Status` останется `UnknownError`, пока тестовый корень не добавлен в доверенные
(`-Trust` в скрипте). Для реального сертификата УЦ этот шаг не нужен.

`certs/` и `release-signed/` в `.gitignore` — приватный ключ в git не попадает.

## Автообновление

Приложение проверяет обновления в фоне (при старте и раз в 4 часа) и скачивает их
автоматически. Пользователь видит баннер со статусом и сам запускает установку
(«Перезапустить и установить»), либо обновление устанавливается при выходе из
приложения. Пункт меню **Помощь → Проверить обновления** запускает проверку вручную.

Источник обновлений — GitHub Releases (`build.publish`, репозиторий `Sovero/remotehub`).

**Проверка подписи.** `build.win.verifyUpdateCodeSignature` сейчас **выключен**, поэтому
electron-updater принимает неподписанные обновления — это позволяет автообновлению
работать до покупки код-подписывающего сертификата. После подключения реального PFX
верните `verifyUpdateCodeSignature: true`: тогда неподписанный инсталлятор или
подписанный другим издателем будет отклонён. Значение `build.win.publisherName`
(`Remote Hub`) должно **точно** совпадать с именем издателя в вашем сертификате
код-подписи — при получении сертификата поправьте это поле.

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

### IronRDP smoke на реальном хосте

Опциональный smoke запускает отдельный Electron-профиль, создаёт временный зашифрованный credential и открывает реальный RDP-хост движком IronRDP. Он завершается только после проверки `state.phase === "connected"` и ненулевых не-чёрных пикселей в canvas. Пароль не выводится в лог и не записывается в репозиторий.

```powershell
$env:RH_RDP_HOST = "rdp.example.com"
$env:RH_RDP_USERNAME = "user"
$env:RH_RDP_PASSWORD = "<password>"
$env:RH_RDP_PORT = "3389"              # optional
$env:RH_RDP_DOMAIN = "DOMAIN"          # optional
$env:RH_RDP_TIMEOUT_MS = "90000"       # optional
npm run smoke:rdp:iron
```

В Unix shell используются те же имена переменных через `export`. Smoke opt-in и не входит в обычный `npm test`; запуск без обязательных переменных завершается с кодом `2`.

### E2E-проверка живого RDP-хоста (без пароля)

Быстрый сетевой тест, который проверяет реальный путь IronRDP-моста до сервера:
TCP-подключение к порту 3389, X.224 Connection Request с RDP-переговорами
(SSL + CredSSP) и ответ сервера, проброшенный обратно через локальный
WebSocket-туннель. Логин и пароль не нужны — это проверка транспорта и
согласования, а не аутентификации.

```powershell
$env:RH_E2E_RDP_HOST = "10.10.51.2"
$env:RH_E2E_RDP_PORT = "3389"    # optional
npm run test:e2e:rdp
```

Без `RH_E2E_RDP_HOST` тест пропускается, поэтому обычный `npm test` не зависит
от конкретного сервера или сети.

## Лицензия

[MIT](LICENSE) © 2026 Remote Hub
