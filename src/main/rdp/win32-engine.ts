/**
 * Реализация RdpEmbedEngine на koffi (N-API FFI, user32.dll).
 *
 * HWND в 64-битных Windows — BigInt-значения, которые не помещаются в Number
 * (BigInt > 2⁵³). Движок работает с BigInt от rdp-com-host.exe до вызовов
 * Win32, чтобы они получали точный указатель, а не обрезанный Number.
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
  const kernel32 = koffi.load('kernel32.dll');

  const BOOL = koffi.alias('BOOL', 'int32');
  const DWORD = koffi.alias('DWORD', 'uint32_t');
  // HWND как uintptr_t (BigInt/number), а не koffi.opaque(): opaque-указатели
  // koffi не умеет вернуть из нативных функций (даёт null для валидных HWND),
  // из-за чего ломались SetParent/GetParent/GetAncestor.
  const HANDLE = koffi.alias('HANDLE', koffi.types.uintptr_t);
  const HWND = koffi.alias('HWND', HANDLE);
  const LPARAM = koffi.alias('LPARAM', koffi.types.intptr);
  const WPARAM = koffi.alias('WPARAM', koffi.types.intptr);

  const GetWindowThreadProcessId = user32.func(
    'DWORD __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ DWORD *pid)'
  );
  const IsWindow = user32.func('BOOL __stdcall IsWindow(HWND hwnd)');
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(HWND hwnd, int nIndex)');
  const SetWindowLongPtrW = user32.func(
    'intptr_t __stdcall SetWindowLongPtrW(HWND hwnd, int nIndex, intptr_t dwNewLong)'
  );
  const GetWindow = user32.func('HWND __stdcall GetWindow(HWND hwnd, uint32_t uCmd)');
  const ShowWindow = user32.func('BOOL __stdcall ShowWindow(HWND hwnd, int nCmdShow)');
  const PostMessageW = user32.func(
    'BOOL __stdcall PostMessageW(HWND hwnd, uint32_t msg, WPARAM wParam, LPARAM lParam)'
  );
  const SetWindowPos = user32.func(
    'BOOL __stdcall SetWindowPos(HWND hwnd, HWND hwndInsertAfter, int x, int y, int cx, int cy, uint32_t flags)'
  );
  const SetForegroundWindow = user32.func('BOOL __stdcall SetForegroundWindow(HWND hwnd)');
  const SetFocus = user32.func('HWND __stdcall SetFocus(HWND hwnd)');
  const AttachThreadInput = user32.func(
    'BOOL __stdcall AttachThreadInput(DWORD idAttach, DWORD idAttachTo, BOOL fAttach)'
  );
  const GetCurrentThreadId = kernel32.func('DWORD __stdcall GetCurrentThreadId()');

  const GWL_EXSTYLE = -20;
  const GWLP_HWNDPARENT = -8;
  const GW_OWNER = 4;

  const WS_EX_APPWINDOW = 0x00040000;
  const WS_EX_TOOLWINDOW = 0x00000080;

  const SW_HIDE = 0;
  const SW_SHOWNA = 8;
  const WM_CLOSE = 0x0010;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const SWP_FRAMECHANGED = 0x0020;

  const hwndValue = (v: unknown): bigint | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(v);
    return null;
  };

  return {
    isWindow(hwnd: bigint): boolean {
      return IsWindow(hwnd) !== 0;
    },

    embed(hwnd: bigint, parentHwnd: bigint): void {
      // Настоящий WS_CHILD + SetParent здесь не работает: Electron/Chromium
      // композитит своё окно через DirectComposition, который рисует контент
      // в обход классического Win32 Z-порядка — «сырой» дочерний HWND остаётся
      // чёрным независимо от Z-позиции и GPU-ускорения (подтверждено диагностикой:
      // тот же самый механизм отлично работает при встраивании в обычное,
      // не-Chromium окно). Псевдо-встраивание: окно остаётся ОТДЕЛЬНЫМ top-level
      // окном (без рамки/заголовка/в панели задач — уже задано хостом),
      // привязанным к родителю через GWLP_HWNDPARENT (owned window) — так оно
      // рисуется собственным DWM-композитингом, но следует за родителем по
      // Z-порядку и автоматически прячется/показывается при его minimize/restore.
      // Позицию и размер приходится синхронизировать вручную (см. setRect
      // и вызовы при move/resize родителя в main/index.ts).
      ShowWindow(hwnd, SW_HIDE);

      try {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, parentHwnd);
      } catch (err) {
        throw new Error(`Win32 SetWindowLongPtr(GWLP_HWNDPARENT) вызвал ошибку: ${(err as Error).message}`);
      }

      const actualOwner = hwndValue(GetWindow(hwnd, GW_OWNER));
      if (actualOwner === null || actualOwner !== parentHwnd) {
        console.error(
          `[rdp-embed] GWLP_HWNDPARENT не привязал: hwnd=0x${hwnd.toString(16)} ` +
            `parent=0x${parentHwnd.toString(16)} actual=0x${(actualOwner ?? 0n).toString(16)}`
        );
        throw new Error('Win32 не удалось привязать окно RDP-хоста к окну приложения (owner)');
      }

      // Убираем окно из панели задач/Alt-Tab — как и раньше, но здесь это
      // единственный способ сообщить пользователю, что это не отдельное окно.
      const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & 0xffffffff;
      SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW);
    },

    /** rect — АБСОЛЮТНЫЕ экранные координаты (окно больше не WS_CHILD). */
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
      // Owned-окна и так держатся над владельцем, но явно поднимаем в
      // Z-порядке — на случай если поверх успело встать что-то ещё.
      SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    },

    hide(hwnd: bigint): void {
      ShowWindow(hwnd, SW_HIDE);
    },

    setForeground(hwnd: bigint): void {
      SetForegroundWindow(hwnd);
    },

    focus(hwnd: bigint): void {
      // Перед фокусом каждый раз поднимаем окно в Z-порядке.
      SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      // Клавиатура сама к чужому top-level окну не приходит: присоединяем
      // потоки ввода на время SetFocus, иначе фокус из чужого процесса молча
      // не сработает.
      const pidRef: (number | null)[] = [null];
      const childTid = GetWindowThreadProcessId(hwnd, pidRef);
      const myTid = GetCurrentThreadId();
      const attach = childTid !== 0 && childTid !== myTid;
      if (attach) AttachThreadInput(myTid, childTid, 1);
      try {
        SetFocus(hwnd);
      } finally {
        if (attach) AttachThreadInput(myTid, childTid, 0);
      }
    },

    close(hwnd: bigint): void {
      PostMessageW(hwnd, WM_CLOSE, 0, 0);
    }
  };
}
