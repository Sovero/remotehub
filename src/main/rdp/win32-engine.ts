/**
 * Реализация RdpEmbedEngine на koffi (N-API FFI, user32.dll).
 *
 * HWND в 64-битных Windows — BigInt-значения, которые не помещаются в Number
 * (BigInt > 2⁵³). Движок работает с BigInt от getNativeWindowHandle до
 * SetParent, чтобы SetParent получал точный указатель, а не обрезанный Number.
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

  const BOOL = koffi.alias('BOOL', 'int32');
  const DWORD = koffi.alias('DWORD', 'uint32_t');
  // HWND как uintptr_t (BigInt/number), а не koffi.opaque(): opaque-указатели
  // koffi не умеет вернуть из нативных функций (даёт null для валидных HWND),
  // из-за чего ломались SetParent/GetParent/GetAncestor.
  const HANDLE = koffi.alias('HANDLE', koffi.types.uintptr_t);
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
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hwnd, _Out_ char16_t *buf, int max)');
  const SendMessageW = user32.func('intptr_t __stdcall SendMessageW(HWND hwnd, uint32_t msg, WPARAM wParam, LPARAM lParam)');
  const IsWindowVisible = user32.func('BOOL __stdcall IsWindowVisible(HWND hwnd)');
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int nIndex)');
  const SetWindowLongPtrW = user32.func(
    'intptr_t __stdcall SetWindowLongPtrW(HWND hwnd, int nIndex, intptr_t dwNewLong)'
  );
  const SetParent = user32.func('HWND __stdcall SetParent(HWND hwndChild, HWND hwndNewParent)');
  const GetParent = user32.func('HWND __stdcall GetParent(HWND hwnd)');
  const GetAncestor = user32.func('HWND __stdcall GetAncestor(HWND hwnd, uint32_t gaFlags)');
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
  const GA_PARENT = 1;

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
  const SW_SHOWNA = 8;
  const WM_CLOSE = 0x0010;
  const BM_CLICK = 0x00f5;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOZORDER = 0x0004;
  const SWP_NOACTIVATE = 0x0010;
  const SWP_FRAMECHANGED = 0x0020;

  /** HWND из koffi — BigInt; используем как есть без toNum. */
  const hwndValue = (v: unknown): bigint | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return null;
  };

  /** Текст окна (заголовок / текст кнопки). */
  const windowText = (hwnd: unknown): string => {
    const buf = Buffer.allocUnsafe(4096);
    const n = GetWindowTextW(hwnd, buf, 2048);
    return n > 0 ? buf.subarray(0, n * 2).toString('utf16le') : '';
  };

  /** Имя Win32-класса окна. */
  const windowClass = (hwnd: unknown): string => {
    const buf = Buffer.allocUnsafe(512);
    const n = GetClassNameW(hwnd, buf, 256);
    return n > 0 ? buf.subarray(0, n * 2).toString('utf16le') : '';
  };

  /** Текст корневого окна и всех его дочерних контролов. */
  const windowTreeText = (hwnd: unknown): string => {
    const parts = [windowText(hwnd)];
    EnumChildWindows(hwnd, (child: unknown) => {
      if (child !== null) parts.push(windowText(child));
      return 1;
    }, 0);
    return parts.filter(Boolean).join('\n');
  };

  /** Идентификатор процесса окна (BigInt -> pid). */
  const pidOf = (hwnd: unknown): number | null => {
    const pidRef: (number | null)[] = [null];
    GetWindowThreadProcessId(hwnd, pidRef);
    return pidRef[0];
  };

  /**
   * Отличает предупреждение сертификата от основного окна mstsc.
   * Требуем стандартный класс диалога + текст предупреждения.
   */
  const isWarningDialog = (hwnd: unknown): boolean => {
    const klass = windowClass(hwnd);
    const text = windowTreeText(hwnd).replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const isDialogClass = klass === '#32770' || /(^|\.)dialog/i.test(klass);
    if (!isDialogClass) return false;

    const hasWarningText =
      text.includes('security warning') ||
      text.includes('предупреждение системы безопасности') ||
      text.includes('identity of the remote computer') ||
      text.includes('подлинность удаленного компьютера') ||
      text.includes('не удается проверить') ||
      text.includes('не удаётся проверить') ||
      text.includes('certificate') ||
      text.includes('сертификат');
    const hasConnectCancel =
      /(подключ|connect)/i.test(text) && /(отмена|cancel)/i.test(text);
    const hasYesNo = /(^|\s)(да|yes)(?=\s|$)/i.test(text) && /(^|\s)(нет|no)(?=\s|$)/i.test(text);
    const hasRemoteTitle =
      text.includes('remote desktop') || text.includes('удаленн') || text.includes('удалённ') || text.includes('rdp');

    return hasWarningText || (hasRemoteTitle && (hasConnectCancel || hasYesNo));
  };

  const findSecurityWarning = (pid: number): bigint | null => {
    let found: bigint | null = null;
    EnumWindows((hwnd: unknown) => {
      if (hwnd === null || found !== null) return 1;
      if (pidOf(hwnd) !== pid || !isWarningDialog(hwnd)) return 1;
      const h = hwndValue(hwnd);
      if (h !== null) found = h;
      return 0;
    }, 0);
    return found;
  };

  const confirmSecurityWarning = (pid: number): boolean => {
    let clicked = false;
    EnumWindows((hwnd: unknown) => {
      if (hwnd === null) return 1;
      if (pidOf(hwnd) !== pid) return 1;
      if (!isWarningDialog(hwnd)) return 1;
      EnumChildWindows(hwnd, (child: unknown) => {
        if (child === null || clicked) return 1;
        const t = windowText(child).replace(/&/g, '').trim().toLocaleLowerCase();
        if (
          t.includes('подключить') ||
          t.includes('connect') ||
          t === 'да' ||
          t === 'yes' ||
          t === 'ок' ||
          t === 'ok'
        ) {
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

  const rejectSecurityWarning = (pid: number): boolean => {
    let clicked = false;
    EnumWindows((hwnd: unknown) => {
      if (hwnd === null || clicked) return 1;
      if (pidOf(hwnd) !== pid || !isWarningDialog(hwnd)) return 1;
      EnumChildWindows(hwnd, (child: unknown) => {
        if (child === null || clicked) return 1;
        const t = windowText(child).replace(/&/g, '').trim().toLocaleLowerCase();
        if (t.includes('отмена') || t.includes('cancel') || t === 'нет' || t === 'no') {
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

  return {
    async findWindowByPid(pid: number, timeoutMs = 15000, intervalMs = 120): Promise<bigint | null> {
      const deadline = Date.now() + timeoutMs;
      const scan = (): bigint | null => {
        let shell: bigint | null = null;
        let first: bigint | null = null;
        let visible: bigint | null = null;
        EnumWindows((hwnd: unknown) => {
          if (hwnd === null) return 1;
          if (pidOf(hwnd) !== pid) return 1;
          // Диалог предупреждения не кандидат на встраивание.
          if (isWarningDialog(hwnd)) return 1;
          const klass = windowClass(hwnd);
          const wasVisible = IsWindowVisible(hwnd) !== 0;
          const h = hwndValue(hwnd);
          // Вспомогательные окна mstsc — НЕ кандидаты: прогресс подключения
          // (TSC_POPUP_PARENT_WNDCLASS), звук (RDPSoundDVCWnd), буфер обмена
          // (RdpClipRdrWindowClass), IME-окна. Если встроить попап прогресса,
          // реальная сессия останется отдельным top-level окном.
          if (
            klass === 'TSC_POPUP_PARENT_WNDCLASS' ||
            klass === 'RDPSoundDVCWnd' ||
            klass === 'RdpClipRdrWindowClass' ||
            /IME|MSCTF/i.test(klass)
          ) {
            return 1;
          }
          // Настоящая сессия mstsc (TscShellContainerClass, в старых версиях
          // UIMainClass) — приоритет. Во время подключения она скрыта, поэтому
          // выбираем её даже если не видна.
          if (klass === 'TscShellContainerClass' || /Tsc|UIMainClass/i.test(klass)) {
            if (shell === null) {
              shell = h;
              ShowWindow(hwnd, SW_HIDE);
            }
            return 1;
          }
          // Прочие top-level окна процесса: прячем до SetParent.
          ShowWindow(hwnd, SW_HIDE);
          if (first === null) first = h;
          if (wasVisible && h !== null) visible = h;
          return 1;
        }, 0);
        return shell ?? visible ?? first;
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

    isWindow(hwnd: bigint): boolean {
      return IsWindow(hwnd) !== 0;
    },

    findSecurityWarning(pid: number): bigint | null {
      return findSecurityWarning(pid);
    },

    confirmSecurityWarning(pid: number): boolean {
      return confirmSecurityWarning(pid);
    },

    rejectSecurityWarning(pid: number): boolean {
      return rejectSecurityWarning(pid);
    },

    embed(hwnd: bigint, parentHwnd: bigint): void {
      // Скрываем до SetParent — исключаем внешний «всплеск».
      ShowWindow(hwnd, SW_HIDE);

      // По документации SetParent: перед сменой родителя НУЖНО очистить
      // WS_POPUP и выставить WS_CHILD — иначе окно не станет полноценным
      // дочерним и не будет рендериться внутри родителя. Верификацию при
      // этом делаем НЕ по WS_CHILD (SetParent не меняет стили сам), а по
      // фактическому родителю через GetAncestor(GA_PARENT).
      const childStyleBefore = Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) & 0xffffffff;
      const embeddedStyle =
        (childStyleBefore | WS_CHILD) &
        ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
      SetWindowLongPtrW(hwnd, GWL_STYLE, embeddedStyle);

      // Привязываем окно к родителю. Возврат SetParent (старый родитель) не
      // читаем — он не нужен для верификации.
      try {
        SetParent(hwnd, parentHwnd);
      } catch (err) {
        throw new Error(`Win32 SetParent вызвал ошибку: ${(err as Error).message}`);
      }

      // Честная верификация: фактический родитель окна. GetParent у диалогов
      // возвращает владельца, поэтому используем GetAncestor(GA_PARENT) — он
      // возвращает именно родителя из дерева окон.
      const actualParent = hwndValue(GetAncestor(hwnd, GA_PARENT));
      if (actualParent === null || actualParent !== parentHwnd) {
        console.error(
          `[rdp-embed] SetParent не привязал: hwnd=0x${hwnd.toString(16)} ` +
          `parent=0x${parentHwnd.toString(16)} actual=0x${(actualParent ?? 0n).toString(16)}`
        );
        throw new Error('Win32 SetParent не привязал окно mstsc к окну приложения');
      }

      // Убираем окно из панели задач и принудительно поднимаем в Z-порядке
      // родителя: в Electron контент Chromium рисуется поверх нативных
      // дочерних окон, поэтому без явного подъёма mstsc останется невидимым.
      const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & 0xffffffff;
      SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW);
      SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    },

    setRect(hwnd: bigint, rect: EmbedRect): void {
      SetWindowPos(
        hwnd,
        0,
        rect.x,
        rect.y,
        Math.max(1, rect.width),
        Math.max(1, rect.height),
        SWP_NOACTIVATE | SWP_FRAMECHANGED
      );
    },

    show(hwnd: bigint): void {
      ShowWindow(hwnd, SW_SHOWNA);
      // После показа поднимаем окно поверх контента Chromium.
      SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    },

    hide(hwnd: bigint): void {
      ShowWindow(hwnd, SW_HIDE);
    },

    setForeground(hwnd: bigint): void {
      SetForegroundWindow(hwnd);
    },

    hideAuxiliaryWindows(pid: number): void {
      EnumWindows((hwnd: unknown) => {
        if (hwnd === null) return 1;
        if (pidOf(hwnd) !== pid) return 1;
        const klass = windowClass(hwnd);
        // Панель подключения mstsc (чёрная полоса с адресом) и прогресс
        // «Подключение…» не должны всплывать поверх встроенной сессии.
        if (
          klass === 'BBarWindowClass' ||
          klass === 'TSC_POPUP_PARENT_WNDCLASS'
        ) {
          ShowWindow(hwnd, SW_HIDE);
        }
        return 1;
      }, 0);
    },

    close(hwnd: bigint): void {
      PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
  };
}