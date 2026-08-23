/**
 * Шов для встраивания окна mstsc в окно Electron (Win32 SetParent).
 *
 * Единственный шов, через который main трогает Win32 в RDP-фиче: юнит-тесты
 * подменяют движок фейком, а сам koffi (нативный модуль) грузится лениво
 * внутри фабрики win32-engine и только на Windows.
 */
import { createWin32Engine } from './win32-engine';

/** Прямоугольник в физических пикселях относительно клиентской области родителя. */
export interface EmbedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RdpEmbedEngine {
  /**
   * Ищет верхнеуровневое окно процесса pid. Предпочитает видимое окно —
   * у mstsc бывают скрытые служебные окна того же PID.
   */
  findWindowByPid(pid: number, timeoutMs?: number, intervalMs?: number): Promise<number | null>;
  isWindow(hwnd: number): boolean;
  /** Ищет видимый или скрытый диалог предупреждения сертификата у pid. */
  findSecurityWarning(pid: number): number | null;
  confirmSecurityWarning(pid: number): boolean;
  /** Нажимает «Отмена» у предупреждения сертификата. */
  rejectSecurityWarning(pid: number): boolean;
  /**
   * Делает hwnd дочерним окном parentHwnd, снимает заголовок/рамку/кнопки
   * минимизации и убирает окно из панели задач. Видимостью управляет show/hide.
   */
  embed(hwnd: number, parentHwnd: number): void;
  /** Позиционирует встроенное окно в rect (SWP_FRAMECHANGED, без активации). */
  setRect(hwnd: number, rect: EmbedRect): void;
  show(hwnd: number): void;
  hide(hwnd: number): void;
  setForeground(hwnd: number): void;
  /** Best-effort закрытие (WM_CLOSE). Надёжный путь — TerminateProcess у менеджера. */
  close(hwnd: number): void;
}

const noopEngine: RdpEmbedEngine = {
  findWindowByPid: async () => null,
  isWindow: () => false,
  findSecurityWarning: () => null,
  confirmSecurityWarning: () => false,
  rejectSecurityWarning: () => false,
  embed: () => undefined,
  setRect: () => undefined,
  show: () => undefined,
  hide: () => undefined,
  setForeground: () => undefined,
  close: () => undefined
};

export function createEmbedEngine(): RdpEmbedEngine {
  if (process.platform !== 'win32') return noopEngine;
  return createWin32Engine();
}
