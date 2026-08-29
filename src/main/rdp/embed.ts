/**
 * Тип прямоугольника для псевдо-встраивания окна MsRdpClient ActiveX-хоста
 * в окно Electron.
 *
 * Настоящий WS_CHILD + SetParent не работает: Chromium композитит своё окно
 * через DirectComposition в обход классического Win32 Z-порядка, и «сырой»
 * дочерний HWND остаётся чёрным независимо от Z-позиции и GPU-ускорения.
 * Вместо этого окно остаётся отдельным top-level окном без рамки/заголовка/
 * в панели задач, привязанным к родителю через GWLP_HWNDPARENT (owned window).
 *
 * Все Win32-манипуляции с этим окном (встраивание, позиция, видимость, фокус)
 * выполняет САМ rdp-com-host.exe по текстовым командам через stdin (см.
 * manager.ts) — они всегда адресованы собственному окну процесса, поэтому
 * FFI из main-процесса Electron в чужой HWND не нужен. Раньше это делалось
 * через koffi (FFI в user32.dll), но её .node-бинарник ломался при первом
 * запуске на пользовательских машинах («Module did not self-register») —
 * единственный настоящий native Node-addon в проекте, отличный от давно
 * стабильных ssh2/cpu-features/bufferutil.
 */
export interface EmbedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
