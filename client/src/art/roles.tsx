import { useId, type ReactNode } from "react";
import type { ContentMode, Role, Winner } from "@mafia/shared";
import { mulberry32 } from "./rng";

/** Each role's colours, original icon and card frame, drawn in SVG. */

export interface RoleTheme {
  main: string;
  light: string;
  dark: string;
  accent: string;
}

/**
 * Role colours from the Okabe–Ito palette, chosen so every pair stays clearly
 * different for people with red-green (protan, deutan) and blue-yellow (tritan)
 * colour blindness (see roleColors.test.ts). Colour is never the only clue: each
 * role also has its own picture and is always named in words.
 */
export const ROLE_THEME: Record<Role, RoleTheme> = {
  mafia: { main: "#d55e00", light: "#f3d2b8", dark: "#5c2b11", accent: "#e8c36a" },
  doctor: { main: "#009e73", light: "#b8e4d8", dark: "#0b433d", accent: "#ffffff" },
  detective: { main: "#e69f00", light: "#f8e4b8", dark: "#634411", accent: "#cfe8ff" },
  villager: { main: "#56b4e9", light: "#d0eaf9", dark: "#2c4c6a", accent: "#ffd36b" },
  jester: { main: "#f0e442", light: "#fbf7ca", dark: "#665e2a", accent: "#5b2d8c" },
  bodyguard: { main: "#0072b2", light: "#b8d8e9", dark: "#0b3355", accent: "#eef4ff" },
  cupid: { main: "#cc79a7", light: "#f1d9e6", dark: "#593551", accent: "#ffd166" },
};

const INK = "#1f1630";
const ol = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

/** The role's picture on a 64×64 grid. */
export function RoleGlyph({ role }: { role: Role }): ReactNode {
  const t = ROLE_THEME[role];
  switch (role) {
    case "mafia":
      return (
        <g>
          <path d="M5 41 C14 37 50 37 59 41 C61 44 56 47 50 47.5 C38 49 26 49 14 47.5 C8 47 3 44 5 41 Z" fill={t.dark} {...ol} />
          <path
            d="M15 42 C14 30 16 20 22 17 C27 14.5 30 18 32 18 C34 18 37 14.5 42 17 C48 20 50 30 49 42 C38 44.5 26 44.5 15 42 Z"
            fill={t.dark}
            {...ol}
          />
          <path d="M15.3 35.5 C26 38 38 38 48.7 35.5 L49 42 C38 44.5 26 44.5 15 42 Z" fill={t.main} {...ol} />
          <path d="M20 31 C20 25 21 21 24 19.5" fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={2.4} strokeLinecap="round" />
        </g>
      );
    case "doctor":
      return (
        <g>
          <path d="M23 19 V15 C23 11 26 9 32 9 C38 9 41 11 41 15 V19" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
          <path d="M23 19 V15 C23 11 26 9 32 9 C38 9 41 11 41 15 V19" fill="none" stroke={t.dark} strokeWidth={2} strokeLinecap="round" />
          <rect x={9} y={18} width={46} height={36} rx={8} fill={t.main} {...ol} />
          <path d="M9.5 26 H54.5" {...ol} />
          <rect x={28} y={29} width={8} height={20} rx={1.5} fill={t.accent} {...ol} strokeWidth={1.6} />
          <rect x={22} y={35} width={20} height={8} rx={1.5} fill={t.accent} {...ol} strokeWidth={1.6} />
          <rect x={28.8} y={35.8} width={6.4} height={6.4} fill={t.accent} />
        </g>
      );
    case "detective":
      return (
        <g>
          <path d="M40 40 L55 55" stroke={INK} strokeWidth={11} strokeLinecap="round" />
          <path d="M40 40 L55 55" stroke={t.dark} strokeWidth={6.5} strokeLinecap="round" />
          <circle cx={27} cy={27} r={18.5} fill={t.main} {...ol} />
          <circle cx={27} cy={27} r={13.5} fill={t.accent} {...ol} />
          <path d="M19 23 A9.5 9.5 0 0 1 26 17" fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.85} />
        </g>
      );
    case "villager":
      return (
        <g>
          <rect x={41} y={11} width={7} height={15} fill={t.dark} {...ol} />
          <rect x={13} y={30} width={38} height={25} fill="#fff3d6" {...ol} />
          <path d="M6 33 L32 11 L58 33 Z" fill={t.main} {...ol} />
          <rect x={28} y={40} width={9.5} height={15} rx={1} fill={t.dark} {...ol} />
          <rect x={17} y={37} width={8} height={8} fill={t.accent} {...ol} strokeWidth={1.6} />
          <path d="M21 37 V45 M17 41 H25" stroke={INK} strokeWidth={1.2} />
          <path d="M4 55.5 H60" {...ol} />
        </g>
      );
    case "jester":
      return (
        <g>
          <path d="M13 45 C11 34 8 27 3 22 C12 22 20 30 25 44 Z" fill={t.main} {...ol} />
          <path d="M23 45 C25 32 28 18 32 8 C36 18 39 32 41 45 Z" fill={t.dark} {...ol} />
          <path d="M39 44 C44 30 52 22 61 22 C56 27 53 34 51 45 Z" fill={t.main} {...ol} />
          <path d="M12 44 C24 50 40 50 52 44 L53 51 C40 57 24 57 11 51 Z" fill={t.accent} {...ol} />
          {[
            [3, 22],
            [32, 8],
            [61, 22],
          ].map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r={4} fill={t.accent} {...ol} strokeWidth={1.8} />
          ))}
        </g>
      );
    case "bodyguard":
      return (
        <g>
          <path d="M32 5 L54 13 C54 33 46 47 32 58 C18 47 10 33 10 13 Z" fill={t.main} {...ol} />
          <path d="M32 11 L48 17 C48 33 42 43 32 51 C22 43 16 33 16 17 Z" fill="none" stroke={t.light} strokeWidth={2.5} strokeLinejoin="round" />
          <path d={starPath(32, 30, 10, 4.2)} fill={t.accent} {...ol} strokeWidth={1.6} />
        </g>
      );
    case "cupid":
      return (
        <g>
          <path d="M7 53 L57 11" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />
          <path d="M32 52 C14 41 9 31 14 23 C19 16 28 18 32 25 C36 18 45 16 50 23 C55 31 50 41 32 52 Z" fill={t.main} {...ol} />
          <path d="M44 21.9 L57 11" stroke={INK} strokeWidth={3.4} strokeLinecap="round" />
          <path d="M60 8.6 L55.4 18.4 L49.4 11.2 Z" fill={t.accent} {...ol} strokeWidth={1.6} />
          <path d="M9.5 51 L3 48.5 L6.5 55 Z M11 54.2 L6 59 L12.4 59.4 Z" fill={t.light} {...ol} strokeWidth={1.4} />
          <path d="M22 27 C21 30 22 33 24 35" fill="none" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={2.4} strokeLinecap="round" />
        </g>
      );
  }
}

interface RoleIconProps {
  role: Role;
  size?: number;
  /** Set when the icon is the only thing naming the role. */
  title?: string;
  className?: string;
}

export function RoleIcon({ role, size = 24, title, className }: RoleIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`role-icon${className ? ` ${className}` : ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      overflow="visible"
    >
      <RoleGlyph role={role} />
    </svg>
  );
}

// ---------------------------------------------------------------- cards

interface CardColors {
  edge: string;
  paper: string;
  border: string;
  ornament: string;
  ribbon: string;
  ribbonEdge: string;
  ribbonInk: string;
  medallion: string;
  ring: string;
}

export function cardColors(role: Role, mode: ContentMode): CardColors {
  const t = ROLE_THEME[role];
  if (mode === "normal") {
    return {
      edge: "#0d0b10",
      paper: "#1c1820",
      border: "#c9a45a",
      ornament: t.main,
      ribbon: t.dark === "#2c2632" ? "#5c1420" : t.dark,
      ribbonEdge: "#0d0b10",
      ribbonInk: "#f3e3c3",
      medallion: "#26212b",
      ring: "#c9a45a",
    };
  }
  return {
    edge: t.main,
    paper: t.light,
    border: t.main,
    ornament: t.dark,
    ribbon: t.main,
    ribbonEdge: t.dark,
    ribbonInk: "#ffffff",
    medallion: "#fffaf0",
    ring: t.main,
  };
}

function Corners({ draw }: { draw: (x: number, y: number, sx: number, sy: number) => ReactNode }) {
  return (
    <>
      {[
        [44, 44, 1, 1],
        [456, 44, -1, 1],
        [44, 656, 1, -1],
        [456, 656, -1, -1],
      ].map(([x, y, sx, sy]) => (
        <g key={`${x}-${y}`}>{draw(x ?? 0, y ?? 0, sx ?? 1, sy ?? 1)}</g>
      ))}
    </>
  );
}

/** Border decorations: every role has its own. */
function Ornaments({ role, c, accent }: { role: Role; c: CardColors; accent: string }) {
  const line = { fill: "none", stroke: c.ornament, strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (role) {
    case "mafia":
      // art-deco fans in the corners, diamonds at top and bottom
      return (
        <g>
          <Corners
            draw={(x, y, sx, sy) => (
              <g {...line}>
                {[22, 38, 54].map((r) => (
                  <path key={r} d={`M${x + sx * r} ${y} A${r} ${r} 0 0 ${sx * sy > 0 ? 1 : 0} ${x} ${y + sy * r}`} />
                ))}
                {[0, 30, 60, 90].map((a) => {
                  const rad = (a * Math.PI) / 180;
                  return <path key={a} d={`M${x} ${y} L${x + sx * 54 * Math.cos(rad)} ${y + sy * 54 * Math.sin(rad)}`} />;
                })}
              </g>
            )}
          />
          {[44, 656].map((y) => (
            <path key={y} d={`M250 ${y - 14} L266 ${y} L250 ${y + 14} L234 ${y} Z`} fill={accent} stroke={c.ornament} strokeWidth={2.5} />
          ))}
        </g>
      );
    case "doctor":
      return (
        <g>
          <rect x={44} y={44} width={412} height={612} rx={16} fill="none" stroke={c.ornament} strokeWidth={2.5} strokeDasharray="14 10" />
          <Corners
            draw={(x, y, sx, sy) => {
              const cx = x + sx * 30;
              const cy = y + sy * 30;
              return (
                <g fill={c.border} stroke={c.ornament} strokeWidth={2}>
                  <rect x={cx - 5} y={cy - 14} width={10} height={28} rx={2} />
                  <rect x={cx - 14} y={cy - 5} width={28} height={10} rx={2} />
                </g>
              );
            }}
          />
        </g>
      );
    case "detective":
      return (
        <g>
          <rect x={44} y={44} width={412} height={612} rx={16} fill="none" stroke={c.ornament} strokeWidth={4} strokeDasharray="1 12" strokeLinecap="round" />
          <Corners
            draw={(x, y, sx, sy) => (
              <path d={`M${x + sx * 4} ${y + sy * 48} V${y + sy * 4} H${x + sx * 48}`} {...line} strokeWidth={7} />
            )}
          />
          {[0, 1].map((i) => (
            <ellipse key={i} cx={232 + i * 36} cy={636 - i * 10} rx={7} ry={11} fill={c.ornament} opacity={0.55} transform={`rotate(${i ? 18 : -18} ${232 + i * 36} ${636 - i * 10})`} />
          ))}
        </g>
      );
    case "villager":
      return (
        <g>
          <rect x={44} y={44} width={412} height={612} rx={16} fill="none" stroke={c.ornament} strokeWidth={2.5} />
          <Corners
            draw={(x, y, sx, sy) => (
              <g fill={c.border} stroke={c.ornament} strokeWidth={2}>
                <ellipse cx={x + sx * 26} cy={y + sy * 14} rx={14} ry={7} transform={`rotate(${sx * sy * 25} ${x + sx * 26} ${y + sy * 14})`} />
                <ellipse cx={x + sx * 14} cy={y + sy * 28} rx={7} ry={14} transform={`rotate(${sx * sy * 25} ${x + sx * 14} ${y + sy * 28})`} />
              </g>
            )}
          />
          <g fill={c.paper} stroke={c.ornament} strokeWidth={2.2} strokeLinejoin="round">
            <rect x={70} y={622} width={360} height={6} />
            {Array.from({ length: 16 }, (_, i) => {
              const x = 74 + i * 23.5;
              return <path key={i} d={`M${x} 640 V614 L${x + 6} 606 L${x + 12} 614 V640 Z`} />;
            })}
          </g>
        </g>
      );
    case "jester":
      return (
        <g>
          {[58, 642].map((y) => (
            <g key={y} stroke={c.ornament} strokeWidth={2}>
              {Array.from({ length: 14 }, (_, i) => {
                const x = 69 + i * 28.6;
                return (
                  <path
                    key={i}
                    d={`M${x} ${y - 13} L${x + 11} ${y} L${x} ${y + 13} L${x - 11} ${y} Z`}
                    fill={i % 2 === 0 ? c.border : accent}
                  />
                );
              })}
            </g>
          ))}
          <Corners draw={(x, y, sx, sy) => <circle cx={x + sx * 4} cy={y + sy * 4} r={10} fill={accent} stroke={c.ornament} strokeWidth={2} />} />
        </g>
      );
    case "bodyguard":
      return (
        <g fill={c.border} stroke={c.ornament} strokeWidth={1.8}>
          <rect x={44} y={44} width={412} height={612} rx={16} fill="none" stroke={c.ornament} strokeWidth={2.5} />
          {Array.from({ length: 12 }, (_, i) => 64 + i * 33.8).map((x) => (
            <g key={x}>
              <circle cx={x} cy={58} r={5.5} />
              <circle cx={x} cy={642} r={5.5} />
            </g>
          ))}
          {Array.from({ length: 16 }, (_, i) => 92 + i * 34.4).map((y) => (
            <g key={y}>
              <circle cx={58} cy={y} r={5.5} />
              <circle cx={442} cy={y} r={5.5} />
            </g>
          ))}
        </g>
      );
    case "cupid": {
      const scallops = (y: number, dir: number) =>
        `M60 ${y} ` + Array.from({ length: 19 }, () => `a10 10 0 0 ${dir > 0 ? 1 : 0} 20 0`).join(" ");
      return (
        <g>
          <path d={scallops(58, 1)} fill="none" stroke={c.ornament} strokeWidth={2.5} />
          <path d={scallops(642, -1)} fill="none" stroke={c.ornament} strokeWidth={2.5} />
          <Corners
            draw={(x, y, sx, sy) => {
              const cx = x + sx * 28;
              const cy = y + sy * 28;
              return (
                <path
                  d={`M${cx} ${cy + 10} C${cx - 16} ${cy} ${cx - 12} ${cy - 13} ${cx} ${cy - 5} C${cx + 12} ${cy - 13} ${cx + 16} ${cy} ${cx} ${cy + 10} Z`}
                  fill={c.border}
                  stroke={c.ornament}
                  strokeWidth={2}
                />
              );
            }}
          />
        </g>
      );
    }
  }
}

interface RoleCardArtProps {
  role: Role;
  mode: ContentMode;
  name: string;
  className?: string;
}

/** A full role card (500×700): paper, role border, medallion with the icon, and a name ribbon. */
export function RoleCardArt({ role, mode, name, className }: RoleCardArtProps) {
  const c = cardColors(role, mode);
  const t = ROLE_THEME[role];
  const shine = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 500 700" className={className} role="img" aria-label={`${name} card`} focusable="false">
      <defs>
        <radialGradient id={`shine${shine}`} cx="30%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={mode === "normal" ? 0.08 : 0.45} />
          <stop offset="60%" stopColor="#ffffff" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x={6} y={6} width={488} height={688} rx={36} fill={c.edge} />
      <rect x={18} y={18} width={464} height={664} rx={28} fill={c.paper} />
      <rect x={18} y={18} width={464} height={664} rx={28} fill={`url(#shine${shine})`} />
      <rect x={30} y={30} width={440} height={640} rx={22} fill="none" stroke={c.border} strokeWidth={6} />
      <Ornaments role={role} c={c} accent={mode === "normal" ? "#c9a45a" : t.accent} />
      <circle cx={250} cy={190} r={112} fill={c.medallion} stroke={c.ring} strokeWidth={8} />
      <circle cx={250} cy={190} r={98} fill="none" stroke={c.ornament} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="4 8" />
      <svg x={170} y={110} width={160} height={160} viewBox="0 0 64 64" overflow="visible">
        <RoleGlyph role={role} />
      </svg>
      <path d="M78 330 L40 330 L58 350 L40 370 L78 370 Z" fill={c.ribbonEdge} />
      <path d="M422 330 L460 330 L442 350 L460 370 L422 370 Z" fill={c.ribbonEdge} />
      <rect x={66} y={318} width={368} height={52} rx={6} fill={c.ribbon} stroke={c.ribbonEdge} strokeWidth={3} />
      <text
        x={250}
        y={355}
        textAnchor="middle"
        fill={c.ribbonInk}
        className="card-name"
        style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 36, letterSpacing: 2 }}
      >
        {name.toUpperCase()}
      </text>
    </svg>
  );
}

/** The face-down side: a starry village crest. Identical for everyone, so it gives nothing away. */
export function CardBackArt({ mode, className }: { mode: ContentMode; className?: string }) {
  const night = mode === "normal";
  const paper = night ? "#121016" : "#1b2152";
  const gold = night ? "#c9a45a" : "#f2c94c";
  const sky = night ? "#0a090d" : "#0f1438";
  const rand = mulberry32(7);
  const stars = Array.from({ length: 46 }, () => [40 + rand() * 420, 40 + rand() * 620, 1 + rand() * 2.4] as const);
  const cx = 250;
  const cy = 330;
  const r = 130;
  const chord = Math.sqrt(r * r - 46 * 46);
  return (
    <svg viewBox="0 0 500 700" className={className} aria-hidden="true" focusable="false">
      <rect x={6} y={6} width={488} height={688} rx={36} fill="#08070b" />
      <rect x={18} y={18} width={464} height={664} rx={28} fill={paper} />
      <g fill={gold} opacity={0.75}>
        {stars.map(([x, y, s], i) => (
          <circle key={i} cx={x} cy={y} r={s} />
        ))}
      </g>
      <rect x={30} y={30} width={440} height={640} rx={22} fill="none" stroke={gold} strokeWidth={5} />
      <rect x={44} y={44} width={412} height={612} rx={16} fill="none" stroke={gold} strokeOpacity={0.5} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke={gold} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r} fill={sky} stroke={gold} strokeWidth={6} />
      <path d="M296 240 A42 42 0 1 1 262 294 A34 34 0 0 0 296 240 Z" fill={night ? "#dfe6f0" : "#fff2c4"} />
      <path d={`M${cx - chord} ${cy + 46} A${r} ${r} 0 0 0 ${cx + chord} ${cy + 46} Z`} fill="#06050a" />
      <g fill="#06050a">
        <path d="M168 377 V338 L186 322 L204 338 V377 Z" />
        <path d="M206 377 V312 H222 V290 L232 278 L242 290 V312 H258 V377 Z" />
        <path d="M262 377 V346 L281 330 L300 346 V377 Z" />
        <path d="M302 377 V352 L316 341 L330 352 V377 Z" />
      </g>
      <g fill={night ? "#f2a65a" : "#ffd36b"}>
        <rect x={182} y={346} width={8} height={9} />
        <rect x={228} y={296} width={8} height={10} />
        <rect x={277} y={352} width={8} height={9} />
      </g>
      <text x={cx} y={250} textAnchor="middle" fill={gold} style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 92 }} opacity={0.9}>
        ?
      </text>
    </svg>
  );
}

const WINNER_ROLE: Record<Winner, Role> = { town: "villager", mafia: "mafia", jester: "jester" };

/** The game-over emblem: the winning side's icon in a sunburst medallion. */
export function WinnerEmblem({ winner, size = 120 }: { winner: Winner; size?: number }) {
  const role = WINNER_ROLE[winner];
  const t = ROLE_THEME[role];
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className="winner-emblem" aria-hidden="true" focusable="false">
      <g className="rays" stroke={t.accent} strokeWidth={4} strokeLinecap="round" opacity={0.8}>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i * Math.PI) / 8;
          return <path key={i} d={`M${60 + 44 * Math.cos(a)} ${60 + 44 * Math.sin(a)} L${60 + 56 * Math.cos(a)} ${60 + 56 * Math.sin(a)}`} />;
        })}
      </g>
      <circle cx={60} cy={60} r={40} fill={t.light} stroke={t.main} strokeWidth={5} />
      <svg x={30} y={30} width={60} height={60} viewBox="0 0 64 64" overflow="visible">
        <RoleGlyph role={role} />
      </svg>
    </svg>
  );
}
