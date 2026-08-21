# Remote Hub

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
