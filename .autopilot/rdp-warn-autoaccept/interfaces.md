# Интерфейсы (для следующих тикетов)

## RdpEmbedEngine (`src/main/rdp/embed.ts`)

```ts
interface RdpEmbedEngine {
  findWindowByPid(pid: number, timeoutMs?: number, intervalMs?: number): Promise<number | null>;
  isWindow(hwnd: number): boolean;
  /** Подтверждает предупреждение безопасности mstsc (клик «Подключить»), если оно открыто. */
  confirmSecurityWarning(pid: number): boolean;
  embed(hwnd: number, parentHwnd: number): void;
  setRect(hwnd: number, rect: EmbedRect): void;
  show(hwnd: number): void;
  hide(hwnd: number): void;
  setForeground(hwnd: number): void;
  close(hwnd: number): void;
}
```

## RdpManager (`src/main/rdp/manager.ts`)

- `tick()` вызывает `engine.confirmSecurityWarning(pid)` на каждый тик активной
  embedded-сессии; идемпотентно (нет диалога → нет клика).

## Смоук

- `RH_SMOKE_RDP_EMBED=1 RH_RDP_PORT=<порт>` — реальный mstsc; после встраивания ждёт,
  пока у живых mstsc-процессов не останется видимых окон «Предупреждение системы безопасности».
