/**
 * Набор линейных иконок (инлайн-SVG, stroke = currentColor).
 * Одна точка стиля для всех кнопок приложения — без внешних зависимостей.
 */
export type IconName =
  | 'plus'
  | 'folder-plus'
  | 'host'
  | 'import'
  | 'export'
  | 'key'
  | 'gear'
  | 'close'
  | 'refresh'
  | 'stop'
  | 'check'
  | 'pencil'
  | 'trash'
  | 'expand'
  | 'window'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'chevron-up'
  | 'chevron-down'
  | 'upload'
  | 'download'
  | 'arrow-right'
  | 'save'
  | 'link'
  | 'code'
  | 'power'
  | 'search'
  | 'copy'
  | 'play'
  | 'folder'
  | 'file'
  | 'spinner';

const PATHS: Record<IconName, React.JSX.Element> = {
  plus: <path d="M8 3.2v9.6M3.2 8h9.6" />,
  'folder-plus': (
    <>
      <path d="M2.2 4.2h3.9l1.5 1.7h6.2a1.1 1.1 0 0 1 1.1 1.1v5.6a1.1 1.1 0 0 1-1.1 1.1H3.3a1.1 1.1 0 0 1-1.1-1.1V4.2z" />
      <path d="M8 7.4v4.2M5.9 9.5h4.2" />
    </>
  ),
  host: (
    <>
      <rect x="1.6" y="2.4" width="12.8" height="9.4" rx="1.4" />
      <path d="M5.6 14.4h4.8M3.4 16h9.2" />
    </>
  ),
  import: <path d="M8 2.4v6.4M5.4 6.2 8 8.8l2.6-2.6M2.4 12.2v.8a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-.8" />,
  export: <path d="M8 9.4V3M5.4 5.6 8 3l2.6 2.6M2.4 12.2v.8a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-.8" />,
  key: (
    <>
      <circle cx="5.6" cy="8" r="2.3" />
      <path d="M7.7 8h5.4M11.5 8v1.7M13.1 8v1.7" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
    </>
  ),
  close: <path d="M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />,
  refresh: (
    <>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.9" />
      <path d="M13.4 2.4v2.4h-2.4" />
    </>
  ),
  stop: <rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.6" fill="currentColor" stroke="none" />,
  check: <path d="M3 8.4l3.3 3.3L13 4.6" />,
  pencil: (
    <>
      <path d="M11.2 2.9l1.9 1.9L5 12.9 2.6 13.4l.5-2.4z" />
      <path d="M9.8 4.3l1.9 1.9" />
    </>
  ),
  trash: (
    <>
      <path d="M2.8 4.3h10.4M6.4 4.3V2.9h3.2v1.4" />
      <path d="M4 4.3l.7 9h6.6l.7-9" />
      <path d="M6.5 6.8v4.4M9.5 6.8v4.4" />
    </>
  ),
  expand: (
    <>
      <path d="M2.6 6V2.6H6M9.6 2.6H13.4V6.4M13.4 10v3.4H9.6M6.4 13.4H2.6V9.6" />
    </>
  ),
  window: (
    <>
      <rect x="2" y="3.2" width="12" height="9.6" rx="1.2" />
      <path d="M2 6.4h12" />
    </>
  ),
  'arrow-up': <path d="M8 12.8V3.2M4.6 6.6 8 3.2l3.4 3.4" />,
  'arrow-down': <path d="M8 3.2v9.6M4.6 9.4 8 12.8l3.4-3.4" />,
  'arrow-left': <path d="M12.8 8H3.2M6.6 4.4 3.2 8l3.4 3.6" />,
  'chevron-up': <path d="M4.6 9.6 8 6.2l3.4 3.4" />,
  'chevron-down': <path d="M4.6 6.4 8 9.8l3.4-3.4" />,
  upload: <path d="M8 9.6V4M5.4 6.6 8 4l2.6 2.6M2.4 12.4v.6a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-.6" />,
  download: <path d="M8 2.6v5.8M5.4 6 8 8.6 10.6 6M2.4 12.4v.6a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-.6" />,
  'arrow-right': <path d="M2.8 8h9.6M8.2 4.4 11.8 8l-3.6 3.6" />,
  save: (
    <>
      <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.2" />
      <path d="M5 2.4v3.6h5.4V2.4" />
      <path d="M5.4 13.6V9.4h5.2v4.2" />
    </>
  ),
  link: (
    <>
      <circle cx="4.4" cy="6.6" r="1.7" />
      <circle cx="11.6" cy="6.6" r="1.7" />
      <path d="M6 6.6h4M8 6.6v2.3" />
      <circle cx="8" cy="11.8" r="1.5" />
    </>
  ),
  code: <path d="M2.6 5.4l3 2.6-3 2.6M13.4 5.4l-3 2.6 3 2.6" />,
  power: <path d="M8 2.6v5.4M5.1 4.3a5.2 5.2 0 1 0 5.8 0" />,
  search: (
    <>
      <circle cx="7" cy="7" r="3.6" />
      <path d="M9.8 9.8l3.2 3.2" />
    </>
  ),
  copy: (
    <>
      <rect x="5.4" y="5.4" width="8" height="8" rx="1.2" />
      <path d="M10.6 5.4V3.8a1.2 1.2 0 0 0-1.2-1.2H4a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.4" />
    </>
  ),
  play: <path d="M5.6 3.6v8.8l6.8-4.4z" />,
  folder: <path d="M2.2 4.2h3.9l1.5 1.7h6.2a1.1 1.1 0 0 1 1.1 1.1v5.6a1.1 1.1 0 0 1-1.1 1.1H3.3a1.1 1.1 0 0 1-1.1-1.1V4.2z" />,
  file: (
    <>
      <path d="M3.2 2.4h6.3l3.1 3.1v8.1a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1z" />
      <path d="M9.5 2.4v3.1h3.1" />
    </>
  ),
  // Дуговая «загрузочная» иконка: вращается через .icon-spin.
  spinner: <path d="M8 1.8a6.2 6.2 0 1 1-6.15 5.05" />
};

export default function Icon({
  name,
  size = 14,
  className
}: {
  name: IconName;
  size?: number;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
