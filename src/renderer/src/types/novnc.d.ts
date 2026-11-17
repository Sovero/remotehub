declare module '@novnc/novnc' {
  export interface RfbOptions {
    credentials?: Record<string, string>;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RfbOptions);
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    /** Отправить клиентский буфер обмена серверу (extended clipboard или ClientCutText). */
    clipboardPasteFrom(text: string): void;
    requestFullscreen(): void;
    focus(): void;
  }
}
