/** The title emblem: a moonlit village with one window still lit. Original SVG. */
export function Logo({ size = 112 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className="logo-art" aria-hidden="true" focusable="false">
      <circle cx={60} cy={60} r={56} fill="#141a45" stroke="#f2c94c" strokeWidth={3} />
      <circle cx={60} cy={60} r={49} fill="none" stroke="#f2c94c" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="2 5" />
      <g fill="#fff6d8" opacity={0.9}>
        <circle cx={30} cy={34} r={1.4} />
        <circle cx={44} cy={22} r={1.1} />
        <circle cx={92} cy={46} r={1.2} />
        <circle cx={22} cy={52} r={1} />
      </g>
      <path d="M86 24 A17 17 0 1 1 70 46 A13.5 13.5 0 0 0 86 24 Z" fill="#fff2c4" />
      <path d="M8 80 Q34 70 60 76 Q88 82 112 72 L112 82 A56 56 0 0 1 8 82 Z" fill="#0a0c24" />
      <g fill="#0a0c24">
        <path d="M24 82 V64 L33 56 L42 64 V82 Z" />
        <path d="M46 82 V54 H52 V44 L57 38 L62 44 V54 H68 V82 Z" />
        <path d="M72 82 V66 L81 58 L90 66 V82 Z" />
      </g>
      <rect x={55} y={47} width={4.5} height={6} fill="#ffcf6b" />
      <rect x={78} y={68} width={5} height={5} fill="#ffcf6b" />
      <path d="M12 94 A52 52 0 0 0 108 94" fill="none" stroke="#f2c94c" strokeOpacity={0.5} strokeWidth={1.5} />
    </svg>
  );
}
