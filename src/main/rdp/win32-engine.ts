/**
 * Реализация RdpEmbedEngine на koffi (N-API FFI, user32.dll).
 *
 * koffi — нативный модуль; он грузится только внутри createWin32Engine()
 * (на Windows и при реальном использовании), чтобы модуль можно было
 * импортировать в тестах и вне Windows без падений.
 *
 * Синтаксис вызовов проверен против реального mstsc.exe: поиск окна по PID,
 * SetParent, снятие рамки, позиционирование, show/hide, close.
 */
import type KoffiDefault from 'koffi';
import type { EmbedRect, RdpEmbedEngine } from './embed';

// eslint-disable-next-line @typescript-eslint/no-var-requires
function getKoffi(): typeof KoffiDefault {
  return require('koffi') as typeof KoffiDefault;
}

export function createWin32Engine(): RdpEmbedEngine {
  const koffi = getKoffi();
  const user32 = koffi.load('user32.dll');

  const BOOL = koffi.alias('BOOL', 'int32_t');
  const DWORD = koffi.alias('DWORD', 'uint32_t');
  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  const HWND = koffi.alias('HWND', HANDLE);
  const LPARAM = koffi.alias('LPARAM', koffi.types.intptr);
  const WPARAM = koffi.alias('WPARAM', koffi.types.intptr);

  const EnumWindowsProc = koffi.proto('BOOL __stdcall EnumWindowsProc(HWND hwnd, LPARAM lParam)');
  const EnumWindows = user32.func('BOOL __stdcall EnumWindows(EnumWindowsProc *callback, LPARAM lParam)');
  const EnumChildWindows = user32.func('BOOL __stdcall EnumChildWindows(HWND hwnd, EnumWindowsProc *callback, LPARAM lParam)');
  const GetWindowThreadProcessId = user32.func(
    'DWORD __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ DWORD *pid)'
  );
  const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hwnd, _Out_ char16_t *buf, int max)');
  const SendMessageW = user32.func('intptr_t __stdcall SendMessageW(HWND hwnd, uint32_t msg, WPARAM wParam, LPARAM lParam)');
  const IsWindowVisible = user32.func('BOOL __stdcall IsWindowVisible(HWND hwnd)');
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int nIndex)');
  const SetWindowLongPtrW = user32.func(
    'intptr_t __stdcall SetWindowLongPtrW(HWND hwnd, int nIndex, intptr_t dwNewLong)'
  );
  const SetParent = user32.func('HWND __stdcall SetParent(HWND hwndChild, HWND hwndNewParent)');
  const IsWindow = user32.func('BOOL __stdcall IsWindow(HWND hwnd)');
  const ShowWindow = user32.func('BOOL __stdcall ShowWindow(HWND hwnd, int nCmdShow)');
  const PostMessageW = user32.func(
    'BOOL __stdcall PostMessageW(HWND hwnd, uint32_t msg, WPARAM wParam, LPARAM lParam)'
  );
  const SetWindowPos = user32.func(
    'BOOL __stdcall SetWindowPos(HWND hwnd, HWND hwndInsertAfter, int x, int y, int cx, int cy, uint32_t flags)'
  );
  const SetForegroundWindow = user32.func('BOOL __stdcall SetForegroundWindow(HWND hwnd)');

  const GWL_STYLE = -16;
  const GWL_EXSTYLE = -20;

  const WS_CHILD = 0x40000000;
  const WS_POPUP = 0x80000000;
  const WS_CAPTION = 0x00c00000;
  const WS_THICKFRAME = 0x00040000;
  const WS_MINIMIZEBOX = 0x00020000;
  const WS_MAXIMIZEBOX = 0x00010000;
  const WS_SYSMENU = 0x00080000;
  const WS_EX_APPWINDOW = 0x00040000;
  const WS_EX_TOOLWINDOW = 0x00000080;

  const SW_HIDE = 0;
  const SW_SHOW = 5;
  const WM_CLOSE = 0x0010;
  const BM_CLICK = 0x00f5;
  const SWP_NOZORDER = 0x0004;
  const SWP_NOACTIVATE = 0x0010;
  const SWP_FRAMECHANGED = 0x0020;

  /** Текст окна (заголовок / текст кнопки). */
  const windowText = (hwnd: unknown): string => {
    const buf = Buffer.allocUnsafe(4096);
    const n = GetWindowTextW(hwnd, buf, 2048);
    return n > 0 ? buf.subarray(0, n * 2).toString('utf16le') : '';
  };

  const isWarningDialog = (hwnd: unknown): boolean => {
    const t = windowText(hwnd);
    return (
      t.includes('Предупреждение системы безопасности') ||
      t.includes('Remote Desktop Connection') ||
      /security warning/i.test(t)
    );
  };

  /**
   * Если у процесса pid открыт диалог предупреждения безопасности mstsc
   * («Подключить»/«Отмена» для непроверенного сертификата), подтверждаем его
   * кликом по «Подключить». Возвращает true, если клик выполнен.
   *
   * mstsc в новых Windows не запоминает принятый сертификат (CertHash не
   * пишется даже после ручного принятия), поэтому предупреждение всплывает
   * при каждом подключении — его нужно гасить автоматически.
   */
  const confirmSecurityWarning = (pid: number): boolean => {
    let clicked = false;
    EnumWindows((hwnd: unknown) => {
      if (hwnd === null) return 1;
      const pidRef: (number | null)[] = [null];
      GetWindowThreadProcessId(hwnd, pidRef);
      if (pidRef[0] !== pid) return 1;
      if (!isWarningDialog(hwnd)) return 1;
      // В диалоге ищем кнопку «Подключить» (с мнемоникой & и без).
      EnumChildWindows(hwnd, (child: unknown) => {
        if (child === null || clicked) return 1;
        const t = windowText(child).replace(/&/g, '');
        if (t.includes('Подключить') || t.includes('Connect')) {
          SendMessageW(child, BM_CLICK, 0, 0);
          clicked = true;
          return 0;
        }
        return 1;
      }, 0);
      return 1;
    }, 0);
    return clicked;
  };

  /** Пропускаем диалог предупреждения при выборе окна для встраивания. */
  const isSkipWindow = (hwnd: unknown): boolean => isWarningDialog(hwnd);

  /** koffi 3.x возвращает указатели BigInt'ами; внутри движка работаем с Number. */
  const toNum = (v: bigint | number | null | undefined): number =>
    typeof v === 'bigint' ? Number(v) : (v as number) ?? 0;

  return {
    async findWindowByPid(pid: number, timeoutMs = 15000, intervalMs = 120): Promise<number | null> {
      const deadline = Date.now() + timeoutMs;
      const scan = (): number | null => {
        // Предупреждение безопасности здесь не гасим: авто-подтверждение —
        // настройка пользователя, и ей управляет менеджер (attachWindow/tick).
        // Сам диалог исключаем из кандидатов на встраивание (isSkipWindow).
        let first: number | null = null;
        let visible: number | null = null;
        EnumWindows((hwnd: unknown) => {
          if (hwnd === null) return 1;
          const pidRef: (number | null)[] = [null];
          GetWindowThreadProcessId(hwnd, pidRef);
          if (pidRef[0] !== pid) return 1;
          if (isSkipWindow(hwnd)) return 1;
          const h = toNum(hwnd as number | bigint);
          if (first === null) first = h;
          if (IsWindowVisible(hwnd) !== 0) {
            visible = h;
            return 0; // нашли видимое окно процесса — стоп
          }
          return 1;
        }, 0);
        return visible ?? first;
      };
      return await new Promise((resolve) => {
        const tick = (): void => {
          const hwnd = scan();
          if (hwnd !== null || Date.now() > deadline) {
            resolve(hwnd);
            return;
          }
          setTimeout(tick, intervalMs);
        };
        tick();
      });
    },

    isWindow(hwnd: number): boolean {
      return IsWindow(hwnd) !== 0;
    },

    confirmSecurityWarning(pid: number): boolean {
      return confirmSecurityWarning(pid);
    },

    embed(hwnd: number, parentHwnd: number): void {
      ShowWindow(hwnd, SW_HIDE);
      SetParent(hwnd, parentHwnd);
      const style = toNum(GetWindowLongPtrW(hwnd, GWL_STYLE));
      // Дочернее окно без рамки/заголовка/кнопок; видимостью рулит show/hide.
      const next =
        (style | WS_CHILD) &
        ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
      SetWindowLongPtrW(hwnd, GWL_STYLE, next);
      const ex = toNum(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      // Убрать кнопку из панели задач, пометить как окно-инструмент.
      SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW);
    },

    setRect(hwnd: number, rect: EmbedRect): void {
      SetWindowPos(
        hwnd,
        0, // HWND_TOP
        rect.x,
        rect.y,
        Math.max(1, rect.width),
        Math.max(1, rect.height),
        SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
      );
    },

    show(hwnd: number): void {
      ShowWindow(hwnd, SW_SHOW);
    },

    hide(hwnd: number): void {
      ShowWindow(hwnd, SW_HIDE);
    },

    setForeground(hwnd: number): void {
      SetForegroundWindow(hwnd);
    },

    close(hwnd: number): void {
      PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
  };
}
