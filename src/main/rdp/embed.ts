/**
 * Шов для псевдо-встраивания окна MsRdpClient ActiveX-хоста в окно Electron.
 *
 * Настоящий WS_CHILD + SetParent не работает: Chromium композитит своё окно
 * через DirectComposition в обход классического Win32 Z-порядка, и «сырой»
 * дочерний HWND остаётся чёрным независимо от Z-позиции и GPU-ускорения.
 * Вместо этого окно остаётся отдельным top-level окном без рамки/заголовка/
 * в панели задач, привязанным к родителю через GWLP_HWNDPARENT (owned window),
 * и main вручную синхронизирует его позицию/размер/видимость с областью
 * вкладки и состоянием главного окна (move/resize/minimize/restore).
 *
 * Единственный шов, через который main трогает Win32 в legacy RDP-движке: юнит-тесты
 * подменяют движок фейком, а сам koffi (нативный модуль) грузится лениво
 * внутри фабрики win32-engine и только на Windows.
 */
import { createWin32Engine } from './win32-engine';

/** Прямоугольник в физических пикселях — АБСОЛЮТНЫЕ экранные координаты. */
export interface EmbedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RdpEmbedEngine {
  isWindow(hwnd: bigint): boolean;
  /**
   * Делает hwnd owned-окном parentHwnd (GWLP_HWNDPARENT) и убирает его из
   * панели задач/Alt-Tab. Видимостью управляет show/hide.
   */
  embed(hwnd: bigint, parentHwnd: bigint): void;
  /** Позиционирует окно в rect — абсолютные экранные координаты (SWP_FRAMECHANGED, без активации). */
  setRect(hwnd: bigint, rect: EmbedRect): void;
  show(hwnd: bigint): void;
  hide(hwnd: bigint): void;
  setForeground(hwnd: bigint): void;
  /** Клавиатурный фокус встроенному окну: AttachThreadInput + SetFocus + подъём в Z-порядке. */
  focus(hwnd: bigint): void;
  /** Best-effort закрытие (WM_CLOSE). Надёжный путь — TerminateProcess у менеджера. */
  close(hwnd: bigint): void;
}

const noopEngine: RdpEmbedEngine = {
  isWindow: () => false,
  embed: () => undefined,
  setRect: () => undefined,
  show: () => undefined,
  hide: () => undefined,
  setForeground: () => undefined,
  focus: () => undefined,
  close: () => undefined
};

export function createEmbedEngine(): RdpEmbedEngine {
  if (process.platform !== 'win32') return noopEngine;
  return createWin32Engine();
}
