import type { Protocol } from '@shared/types';

const COLORS: Record<Protocol, string> = {
  ssh: '#57ab5a',
  telnet: '#d29922',
  rdp: '#2d95ec',
  vnc: '#c678dd'
};

/**
 * Иконки дерева профилей и вкладок.
 * - protocol-иконки (ssh/telnet/rdp/vnc) — цветные, как раньше;
 * - protocol="group" — папка группы: открытая (развёрнутый узел) или закрытая,
 *   рисуется currentColor, чтобы цвет задавала тема (var(--warn) в дереве).
 */
export default function ProtocolIcon({
  protocol,
  size = 14,
  open,
  drag
}: {
  protocol: Protocol | 'group';
  size?: number;
  /** Для групп: true — развёрнутый узел (открытая папка), false/undefined — свёрнутый. */
  open?: boolean;
  /** Для групп: true — drag-over (папка «приоткрыта»). Приоритетнее open. */
  drag?: boolean;
}): React.JSX.Element {
  if (protocol === 'group') {
    const label = drag ? 'Группа (принимает)' : open ? 'Группа (открыта)' : 'Группа';
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-label={label}>
        {drag ? (
          <>
            {/* «Приоткрытая» папка: крышка приподнята наполовину, лоток виден. */}
            <path
              d="M1.9 4.9l.6-1.3h3.4l1.3 1.4h4.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2.4 6.3h9.2a.95.95 0 0 1 .9 1.28l-.85 2.4a.95.95 0 0 1-.9.62H3.25a.95.95 0 0 1-.9-.62l-.85-2.4a.95.95 0 0 1 .9-1.28z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : open ? (
          <>
            {/* Открытая папка: поднятая крышка + основание. */}
            <path
              d="M1.9 3.7h3.4l1.3 1.5h5.5l-.55 2a.95.95 0 0 1-.9.65H3.4a.95.95 0 0 1-.9-.65l-1-3.5z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2.35 7.6h9.3a.95.95 0 0 1 .9 1.3l-.85 2.4a.95.95 0 0 1-.9.6H3.2a.95.95 0 0 1-.9-.6l-.85-2.4a.95.95 0 0 1 .9-1.3z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <path
            d="M1.9 3.7h3.4l1.3 1.5h5.4a1 1 0 0 1 1 1v4.9a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1V3.7z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  }

  const color = COLORS[protocol];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-label={protocol}>
      {protocol === 'ssh' && (
        <>
          <rect x="1" y="2" width="12" height="10" rx="2" stroke={color} strokeWidth="1.4" />
          <path d="M3.5 5.2l2.2 1.8-2.2 1.8" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 8.8h2.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {protocol === 'telnet' && (
        <>
          <rect x="1" y="2" width="12" height="10" rx="2" stroke={color} strokeWidth="1.4" />
          <path d="M3.5 5.2l2.2 1.8-2.2 1.8" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 8.8h2.6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {protocol === 'rdp' && (
        <>
          <rect x="1" y="2.5" width="12" height="8" rx="1.5" stroke={color} strokeWidth="1.4" />
          <path d="M5 10.5v1.5M9 10.5V12M3 12h8" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {protocol === 'vnc' && (
        <>
          <path
            d="M1.2 7c1.4-2.2 3.7-3.4 5.8-3.4S11.4 4.8 12.8 7C11.4 9.2 9.1 10.4 7 10.4S2.6 9.2 1.2 7z"
            stroke={color}
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <circle cx="7" cy="7" r="1.7" stroke={color} strokeWidth="1.4" />
        </>
      )}
    </svg>
  );
}
