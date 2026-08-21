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

Установщик появится в `release/`. Сборка под x64 (win32 + nsis).

## Разработка

```bash
npm run dev     # dev-режим (electron-vite)
npm run typecheck
npm test
```

## Лицензия

[MIT](LICENSE) © 2026 Remote Hub
