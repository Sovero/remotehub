import type { Protocol } from '@shared/types';

const COLORS: Record<Protocol, string> = {
  ssh: '#57ab5a',
  telnet: '#d29922',
  rdp: '#2d95ec',
  vnc: '#c678dd'
};

export default function ProtocolIcon({
  protocol,
  size = 14
}: {
  protocol: Protocol;
  size?: number;
}): React.JSX.Element {
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
