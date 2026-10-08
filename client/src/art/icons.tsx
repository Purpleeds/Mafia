import type { ReactNode } from "react";

/** Small line icons drawn for this game (24×24, currentColor). They replace emoji in the UI. */
const F = { fill: "currentColor", stroke: "none" } as const;

const ICONS = {
  check: <path d="M5 12.5 L10 17 L19 7" />,
  close: <path d="M6 6 L18 18 M18 6 L6 18" />,
  back: <path d="M15 5 L8 12 L15 19" />,
  lock: (
    <>
      <rect x={5} y={11} width={14} height={10} rx={2.2} />
      <path d="M8 11 V8.2 a4 4 0 0 1 8 0 V11" />
    </>
  ),
  unlock: (
    <>
      <rect x={5} y={11} width={14} height={10} rx={2.2} />
      <path d="M8 11 V8.2 a4 4 0 0 1 7.6 -1.8" />
    </>
  ),
  crown: <path d="M4 18 L4 8.5 L8.6 12 L12 5.5 L15.4 12 L20 8.5 L20 18 Z" {...F} />,
  timer: (
    <>
      <circle cx={12} cy={13.5} r={7.5} />
      <path d="M12 13.5 L12 9.5 M9.5 3 H14.5 M18.6 6.4 L17.2 7.8" />
    </>
  ),
  ballot: (
    <>
      <path d="M8.5 11 V3.5 H15.5 V11" />
      <path d="M10.4 7.4 L11.6 8.6 L13.8 6.2" />
      <path d="M3.5 11.5 H20.5 V20.5 H3.5 Z" />
      <path d="M7 15 H17" />
    </>
  ),
  skip: <path d="M5 6 L11 12 L5 18 M12 6 L18 12 L12 18" />,
  heart: <path d="M12 20 C5 15 3 11 5 8 C7 5 10.5 6 12 8.5 C13.5 6 17 5 19 8 C21 11 19 15 12 20 Z" {...F} />,
  brokenHeart: (
    <>
      <path d="M12 20 C5 15 3 11 5 8 C7 5 10.5 6 12 8.5 C13.5 6 17 5 19 8 C21 11 19 15 12 20 Z" />
      <path d="M12 8.5 L10.4 12 L13.2 13.6 L11.4 17.5" />
    </>
  ),
  sparkle: <path d="M12 3 L13.6 10.4 L21 12 L13.6 13.6 L12 21 L10.4 13.6 L3 12 L10.4 10.4 Z" {...F} />,
  dice: (
    <>
      <rect x={4} y={4} width={16} height={16} rx={3.5} />
      <circle cx={8.5} cy={8.5} r={1.4} {...F} />
      <circle cx={15.5} cy={15.5} r={1.4} {...F} />
      <circle cx={12} cy={12} r={1.4} {...F} />
      <circle cx={15.5} cy={8.5} r={1.4} {...F} />
      <circle cx={8.5} cy={15.5} r={1.4} {...F} />
    </>
  ),
  help: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M9.4 9.4 a2.7 2.7 0 1 1 3.9 2.4 c-0.9 0.45 -1.3 1 -1.3 1.9" />
      <circle cx={12} cy={16.9} r={1.1} {...F} />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12 C5.5 6.5 18.5 6.5 21.5 12 C18.5 17.5 5.5 17.5 2.5 12 Z" />
      <circle cx={12} cy={12} r={3} />
    </>
  ),
  moon: <path d="M19.5 14.6 A8 8 0 1 1 9.4 4.5 A6.4 6.4 0 0 0 19.5 14.6 Z" {...F} />,
  sun: (
    <>
      <circle cx={12} cy={12} r={4.4} {...F} />
      <path d="M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7 7 M17 17 L18.7 18.7 M18.7 5.3 L17 7 M7 17 L5.3 18.7" />
    </>
  ),
  mic: (
    <>
      <rect x={9} y={3} width={6} height={11} rx={3} />
      <path d="M5.8 11 a6.2 6.2 0 0 0 12.4 0 M12 17.2 V21 M8.5 21 H15.5" />
    </>
  ),
  copy: (
    <>
      <rect x={8} y={8} width={12} height={12} rx={2.2} />
      <path d="M16 8 V5.5 A1.5 1.5 0 0 0 14.5 4 H5.5 A1.5 1.5 0 0 0 4 5.5 V14.5 A1.5 1.5 0 0 0 5.5 16 H8" />
    </>
  ),
  share: <path d="M12 3.5 V15 M7.5 8 L12 3.5 L16.5 8 M5 12.5 V20 H19 V12.5" />,
  phone: (
    <>
      <rect x={7} y={2.5} width={10} height={19} rx={2.4} />
      <path d="M11 18.5 H13" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3.5 L21.5 20 H2.5 Z" />
      <path d="M12 10 V14" />
      <circle cx={12} cy={17} r={1.1} {...F} />
    </>
  ),
  home: <path d="M3.5 11 L12 3.8 L20.5 11 M6 9.4 V20 H18 V9.4 M10 20 V14.5 H14 V20" />,
  grave: (
    <>
      <path d="M6.5 20.5 V10.5 a5.5 5.5 0 0 1 11 0 V20.5 Z" />
      <path d="M9.5 12 H14.5 M12 9.5 V15 M3 20.5 H21" />
    </>
  ),
  scales: (
    <>
      <path d="M12 4 V20 M5 7 H19 M8 20 H16" />
      <path d="M5 7 L2.6 13 a2.6 2.6 0 0 0 4.8 0 Z M19 7 L16.6 13 a2.6 2.6 0 0 0 4.8 0 Z" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4 H17 V9 a5 5 0 0 1 -10 0 Z" />
      <path d="M7 6 H4.5 a2.5 3 0 0 0 3 4 M17 6 H19.5 a2.5 3 0 0 1 -3 4 M12 14 V18 M8 20.5 H16 M9.5 18 H14.5" />
    </>
  ),
  flag: <path d="M5.5 21 V4 M5.5 4.5 H17.5 L15 8.5 L17.5 12.5 H5.5" />,
  whisper: (
    <>
      <path d="M4 5 H20 V15 H10.5 L6.5 19 V15 H4 Z" />
      <circle cx={8.5} cy={10} r={1} {...F} />
      <circle cx={12} cy={10} r={1} {...F} />
      <circle cx={15.5} cy={10} r={1} {...F} />
    </>
  ),
  shield: <path d="M12 3 L19.5 6 Q19.5 15 12 21 Q4.5 15 4.5 6 Z" />,
  search: (
    <>
      <circle cx={10.5} cy={10.5} r={6} />
      <path d="M15 15 L20.5 20.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7 H20 M4 17 H20" />
      <circle cx={9} cy={7} r={2.4} {...F} />
      <circle cx={15} cy={17} r={2.4} {...F} />
    </>
  ),
  leave: <path d="M14 4 H19 V20 H14 M10 8 L6 12 L10 16 M6 12 H15" />,
  volume: (
    <>
      <path d="M4 9.5 V14.5 H8 L13 18.5 V5.5 L8 9.5 Z" />
      <path d="M16.2 9.2 a4.2 4.2 0 0 1 0 5.6 M18.8 6.5 a8 8 0 0 1 0 11" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M4 9.5 V14.5 H8 L13 18.5 V5.5 L8 9.5 Z" />
      <path d="M16.5 9.5 L21.5 14.5 M21.5 9.5 L16.5 14.5" />
    </>
  ),
  thinking: (
    <>
      <circle cx={11} cy={13} r={7.5} />
      <circle cx={8.5} cy={11.5} r={0.9} {...F} />
      <circle cx={13.5} cy={11.5} r={0.9} {...F} />
      <path d="M8.5 16 H13.5" />
      <circle cx={19} cy={5.5} r={1.2} {...F} />
      <circle cx={21} cy={2.8} r={0.8} {...F} />
    </>
  ),
  suspicious: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M6.8 9.6 H10.6 M13.4 9.6 H17.2" />
      <circle cx={9.6} cy={11.2} r={0.9} {...F} />
      <circle cx={16.2} cy={11.2} r={0.9} {...F} />
      <path d="M8.5 16.2 L15.5 15" />
    </>
  ),
  laughing: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M6.8 10.5 q1.6 -2.2 3.2 0 M14 10.5 q1.6 -2.2 3.2 0" />
      <path d="M7.5 14 H16.5 a4.5 4.5 0 0 1 -9 0 Z" />
    </>
  ),
  shocked: (
    <>
      <circle cx={12} cy={12} r={9} />
      <circle cx={9} cy={10} r={1.1} {...F} />
      <circle cx={15} cy={10} r={1.1} {...F} />
      <ellipse cx={12} cy={16} rx={2} ry={2.6} />
    </>
  ),
  info: (
    <>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 11 V16.5" />
      <circle cx={12} cy={7.6} r={1.1} {...F} />
    </>
  ),
  forward: <path d="M9 5 L16 12 L9 19" />,
  bulb: (
    <>
      <path d="M9.2 17.5 H14.8 M10.2 20.5 H13.8" />
      <path d="M9.2 17.5 C9.2 14.6 6.5 13.6 6.5 10 a5.5 5.5 0 0 1 11 0 C17.5 13.6 14.8 14.6 14.8 17.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Give a title only when the icon is the sole content; otherwise it is decorative. */
  title?: string;
}

export function Icon({ name, size = 18, className, title }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`icon${className ? ` ${className}` : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
