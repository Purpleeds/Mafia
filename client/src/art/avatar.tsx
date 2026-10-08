import { memo } from "react";
import type { Avatar, AvatarColor } from "@mafia/shared";
import { hashString, mulberry32, pickFrom } from "./rng";

/**
 * Procedural characters: the avatar's seed decides the hat, hair, face and
 * extras; the colour the player picked dresses them. Pure SVG, drawn in code.
 */

export const AVATAR_COLOR_HEX: Record<AvatarColor, string> = {
  red: "#e5484d",
  orange: "#f2762e",
  amber: "#f2b134",
  lime: "#8bc34a",
  green: "#2fb26d",
  teal: "#1fa99a",
  cyan: "#22b8d6",
  blue: "#3d7fe0",
  indigo: "#5b5fd6",
  violet: "#8d5ad8",
  pink: "#e45a9b",
  slate: "#6b7a90",
};

const OUTLINE = "#2b2140";
const SKINS = ["#ffdcc2", "#f4c39e", "#dfa57b", "#bd8258", "#93603c", "#6c4128"] as const;
const HAIR_COLORS = ["#2a1b14", "#4a2e1c", "#7b4a26", "#b97a35", "#e3be6a", "#c9c9d3", "#b8402f", "#34345c"] as const;
const HAT_COLORS = ["#3b3355", "#a8432f", "#2f6d5a", "#d9a441", "#5b6fbf", "#8a3d7a", "#ece7dc", "#2d2d33"] as const;

export const HEADS = ["round", "oval", "square"] as const;
export const EYES = ["dots", "big", "happy", "sleepy", "wide", "glasses"] as const;
export const BROWS = ["none", "calm", "raised", "suspicious"] as const;
export const MOUTHS = ["smile", "grin", "o", "flat", "smirk"] as const;
export const HAIRS = ["none", "short", "bob", "curly", "long", "spiky", "bun"] as const;
export const HATS = [
  "none",
  "top",
  "beret",
  "cap",
  "beanie",
  "straw",
  "bowler",
  "party",
  "flatcap",
  "witch",
  "flower",
] as const;
export const EXTRAS = ["none", "mustache", "freckles", "bowtie", "scarf", "earring"] as const;

export interface CharacterTraits {
  skin: string;
  hairColor: string;
  hatColor: string;
  head: (typeof HEADS)[number];
  eyes: (typeof EYES)[number];
  brows: (typeof BROWS)[number];
  mouth: (typeof MOUTHS)[number];
  hair: (typeof HAIRS)[number];
  hat: (typeof HATS)[number];
  extra: (typeof EXTRAS)[number];
  blush: boolean;
}

/** The same seed always gives the same character. */
export function traitsFor(seed: string): CharacterTraits {
  const rand = mulberry32(hashString(`look:${seed}`));
  const hatRoll = rand();
  return {
    skin: pickFrom(rand, SKINS),
    hairColor: pickFrom(rand, HAIR_COLORS),
    hatColor: pickFrom(rand, HAT_COLORS),
    head: pickFrom(rand, HEADS),
    eyes: pickFrom(rand, EYES),
    brows: pickFrom(rand, BROWS),
    mouth: pickFrom(rand, MOUTHS),
    hair: pickFrom(rand, HAIRS),
    // A quarter of the town goes bare-headed.
    hat: hatRoll < 0.25 ? "none" : pickFrom(rand, ["top", "beret", "cap", "beanie", "straw", "bowler", "party", "flatcap", "witch", "flower"]),
    extra: rand() < 0.45 ? "none" : pickFrom(rand, ["mustache", "freckles", "bowtie", "scarf", "earring"]),
    blush: rand() < 0.5,
  };
}

const HAT_LABEL: Record<CharacterTraits["hat"], string> = {
  none: "no hat",
  top: "a top hat",
  beret: "a beret",
  cap: "a cap",
  beanie: "a beanie",
  straw: "a straw hat",
  bowler: "a bowler hat",
  party: "a party hat",
  flatcap: "a flat cap",
  witch: "a pointy hat",
  flower: "a flower",
};

/** "teal, with a beret" – for screen readers. */
export function describeAvatar(avatar: Avatar): string {
  const t = traitsFor(avatar.seed);
  return `${avatar.color} character with ${HAT_LABEL[t.hat]}`;
}

/** Mix a hex colour with white (amount 0..1). */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Mix a hex colour with black (amount 0..1). */
export function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

const line = { stroke: OUTLINE, strokeWidth: 2.4, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

function HairBack({ t }: { t: CharacterTraits }) {
  if (t.hair === "long") return <path d="M28 44 Q24 72 33 80 L67 80 Q76 72 72 44 Z" fill={t.hairColor} {...line} />;
  if (t.hair === "bob") return <path d="M28 42 Q26 63 34 66 L66 66 Q74 63 72 42 Z" fill={t.hairColor} {...line} />;
  return null;
}

function HairFront({ t }: { t: CharacterTraits }) {
  switch (t.hair) {
    case "short":
      return <path d="M29 44 Q28 21 50 20 Q72 21 71 44 Q64 32 50 32 Q37 32 29 44 Z" fill={t.hairColor} {...line} />;
    case "bob":
    case "long":
      return <path d="M29 45 Q29 20 50 20 Q71 20 71 45 Q61 35 52 31 Q43 38 29 45 Z" fill={t.hairColor} {...line} />;
    case "curly":
      return (
        <g fill={t.hairColor} {...line}>
          {[
            [33, 33, 7],
            [40, 25, 8],
            [50, 22, 8.5],
            [60, 25, 8],
            [67, 33, 7],
          ].map(([cx, cy, r]) => (
            <circle key={cx} cx={cx} cy={cy} r={r} />
          ))}
        </g>
      );
    case "spiky":
      return <path d="M30 40 L32 23 L39 31 L44 17 L50 29 L56 16 L61 30 L68 22 L70 40 Q50 30 30 40 Z" fill={t.hairColor} {...line} />;
    case "bun":
      return (
        <g fill={t.hairColor} {...line}>
          <circle cx={50} cy={16} r={7.5} />
          <path d="M29 44 Q28 21 50 20 Q72 21 71 44 Q64 32 50 32 Q37 32 29 44 Z" />
        </g>
      );
    default:
      return null;
  }
}

function Head({ t }: { t: CharacterTraits }) {
  const props = { fill: t.skin, ...line };
  if (t.head === "oval") return <ellipse cx={50} cy={46} rx={19} ry={23} {...props} />;
  if (t.head === "square") return <rect x={30} y={25} width={40} height={43} rx={14} {...props} />;
  return <circle cx={50} cy={46} r={21} {...props} />;
}

function Eyes({ t }: { t: CharacterTraits }) {
  const xs = [42, 58];
  switch (t.eyes) {
    case "big":
      return (
        <g>
          {xs.map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={46} rx={4.6} ry={5.4} fill="#fff" stroke={OUTLINE} strokeWidth={1.6} />
              <circle cx={x + 0.6} cy={46.8} r={2.4} fill={OUTLINE} />
              <circle cx={x + 1.5} cy={45.6} r={0.9} fill="#fff" />
            </g>
          ))}
        </g>
      );
    case "happy":
      return <path d="M38 47 Q42 42 46 47 M54 47 Q58 42 62 47" fill="none" {...line} />;
    case "sleepy":
      return <path d="M38 46 Q42 49.5 46 46 M54 46 Q58 49.5 62 46" fill="none" {...line} />;
    case "wide":
      return (
        <g>
          {xs.map((x) => (
            <g key={x}>
              <circle cx={x} cy={46} r={4.2} fill="#fff" stroke={OUTLINE} strokeWidth={1.6} />
              <circle cx={x} cy={46} r={1.7} fill={OUTLINE} />
            </g>
          ))}
        </g>
      );
    case "glasses":
      return (
        <g>
          {xs.map((x) => (
            <circle key={x} cx={x} cy={46} r={2.2} fill={OUTLINE} />
          ))}
          <g fill="rgba(255,255,255,0.22)" stroke={OUTLINE} strokeWidth={2}>
            <circle cx={42} cy={46} r={6.4} />
            <circle cx={58} cy={46} r={6.4} />
          </g>
          <path d="M48.4 46 L51.6 46" {...line} strokeWidth={2} />
        </g>
      );
    default:
      return (
        <g fill={OUTLINE}>
          {xs.map((x) => (
            <circle key={x} cx={x} cy={46} r={2.6} />
          ))}
        </g>
      );
  }
}

function Brows({ t }: { t: CharacterTraits }) {
  const props = { fill: "none", stroke: OUTLINE, strokeWidth: 2.1, strokeLinecap: "round" as const };
  switch (t.brows) {
    case "calm":
      return <path d="M38 38.5 Q42 36.5 46 38.5 M54 38.5 Q58 36.5 62 38.5" {...props} />;
    case "raised":
      return <path d="M38 36 Q42 32.5 46 35.5 M54 35.5 Q58 32.5 62 36" {...props} />;
    case "suspicious":
      // one brow up, one down: very Mafia
      return <path d="M38 35.5 Q42 33 46 36.5 M54 39.5 L62 37.5" {...props} />;
    default:
      return null;
  }
}

function Mouth({ t }: { t: CharacterTraits }) {
  switch (t.mouth) {
    case "grin":
      return (
        <g>
          <path d="M42 55 Q50 65 58 55 Z" fill={OUTLINE} {...line} strokeWidth={1.8} />
          <path d="M44 55.6 L56 55.6 L55 57.5 L45 57.5 Z" fill="#fff" />
        </g>
      );
    case "o":
      return <ellipse cx={50} cy={57.5} rx={2.6} ry={3.2} fill={OUTLINE} />;
    case "flat":
      return <path d="M45 58 L55 58" {...line} />;
    case "smirk":
      return <path d="M44 58 Q52 60 57 54" fill="none" {...line} />;
    default:
      return <path d="M43 55.5 Q50 62 57 55.5" fill="none" {...line} />;
  }
}

function Extra({ t, shirt }: { t: CharacterTraits; shirt: string }) {
  switch (t.extra) {
    case "mustache":
      return (
        <path
          d="M40 55 Q45 49.5 50 53.5 Q55 49.5 60 55 Q55 57.5 50 55.5 Q45 57.5 40 55 Z"
          fill={t.hairColor}
          {...line}
          strokeWidth={1.6}
        />
      );
    case "freckles":
      return (
        <g fill="#a0522d" opacity={0.55}>
          {[
            [37, 52],
            [40, 54.5],
            [36, 55.5],
            [63, 52],
            [60, 54.5],
            [64, 55.5],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={0.9} />
          ))}
        </g>
      );
    case "bowtie":
      return (
        <g fill={t.hatColor} {...line} strokeWidth={1.8}>
          <path d="M50 76 L40 71 L40 81 Z" />
          <path d="M50 76 L60 71 L60 81 Z" />
          <circle cx={50} cy={76} r={2.6} />
        </g>
      );
    case "scarf":
      return (
        <g fill={shade(t.hatColor, 0.1)} {...line} strokeWidth={1.8}>
          <path d="M35 70 Q50 79 65 70 L66 77 Q50 86 34 77 Z" />
          <path d="M57 79 L61 92 L54 92 L52 81 Z" />
        </g>
      );
    case "earring":
      return <circle cx={29.5} cy={55} r={2.2} fill="#f2c94c" stroke={OUTLINE} strokeWidth={1.2} />;
    default:
      return null;
  }
}

function Hat({ t }: { t: CharacterTraits }) {
  const c = t.hatColor;
  const props = { fill: c, ...line };
  switch (t.hat) {
    case "top":
      return (
        <g>
          <rect x={37} y={2} width={26} height={22} rx={2.5} {...props} />
          <rect x={37} y={17} width={26} height={4.5} fill="#c0392b" />
          <rect x={30} y={22} width={40} height={6} rx={3} {...props} />
        </g>
      );
    case "beret":
      return (
        <g transform="rotate(-9 50 24)">
          <ellipse cx={48} cy={23} rx={23} ry={8.5} {...props} />
          <circle cx={53} cy={14.5} r={2.6} {...props} />
        </g>
      );
    case "cap":
      return (
        <g>
          <path d="M29 31 Q29 11 50 11 Q71 11 71 31 Z" {...props} />
          <path d="M52 30 Q72 27 82 33 Q72 36.5 52 34 Z" fill={shade(c, 0.25)} {...line} />
          <circle cx={50} cy={11.5} r={2.2} fill={shade(c, 0.3)} />
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d="M29 32 Q29 9 50 9 Q71 9 71 32 Z" {...props} />
          <rect x={27.5} y={26} width={45} height={9} rx={4} fill={shade(c, 0.2)} {...line} />
          <circle cx={50} cy={7} r={5.2} fill={tint(c, 0.5)} {...line} />
        </g>
      );
    case "straw":
      return (
        <g>
          <ellipse cx={50} cy={27} rx={33} ry={7.5} fill="#e8c66a" {...line} />
          <path d="M35 27 Q35 9 50 9 Q65 9 65 27 Z" fill="#efd27e" {...line} />
          <path d="M35.5 21 Q50 25 64.5 21 L65 26 Q50 30 35 26 Z" fill={c} />
        </g>
      );
    case "bowler":
      return (
        <g>
          <path d="M34 26 Q34 7 50 7 Q66 7 66 26 Z" {...props} />
          <ellipse cx={50} cy={26.5} rx={22} ry={4.5} {...props} />
        </g>
      );
    case "party":
      return (
        <g>
          <path d="M38 27 L50 1 L62 27 Z" {...props} />
          <path d="M42 18 L58 18 M45.5 10 L54.5 10" stroke={tint(c, 0.65)} strokeWidth={3} strokeLinecap="round" />
          <circle cx={50} cy={2} r={4} fill="#f2c94c" {...line} />
        </g>
      );
    case "flatcap":
      return (
        <g>
          <path d="M29 30 Q30 13 52 13 Q73 15 75 29 Q60 25 29 30 Z" {...props} />
          <path d="M58 27 Q70 26 78 30 Q68 32 58 30.5 Z" fill={shade(c, 0.25)} {...line} />
        </g>
      );
    case "witch":
      return (
        <g>
          <ellipse cx={50} cy={26} rx={31} ry={6.5} {...props} />
          <path d="M37 26 Q45 12 52 2 Q55 -3 62 -1 Q56 4 58 12 L64 26 Z" {...props} />
          <path d="M37.5 22 L63 22 L64 26 L37 26 Z" fill="#f2c94c" />
        </g>
      );
    case "flower":
      return (
        <g transform="translate(66 27)">
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse
              key={a}
              cx={0}
              cy={-5.5}
              rx={3.6}
              ry={5.4}
              fill={tint(c, 0.35)}
              stroke={OUTLINE}
              strokeWidth={1.4}
              transform={`rotate(${a})`}
            />
          ))}
          <circle r={3} fill="#f2c94c" stroke={OUTLINE} strokeWidth={1.4} />
        </g>
      );
    default:
      return null;
  }
}

interface CharacterProps {
  avatar: Avatar;
  /** Hide the hair under hats that cover it. */
  className?: string;
}

/** The character drawing (100×100 units). Wrap it in something round. */
export const Character = memo(function Character({ avatar, className }: CharacterProps) {
  const t = traitsFor(avatar.seed);
  const shirt = AVATAR_COLOR_HEX[avatar.color] ?? "#888";
  const coveredHair = t.hat === "beanie" || t.hat === "cap" || t.hat === "bowler" || t.hat === "top";
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect width={100} height={100} fill={tint(shirt, 0.62)} />
      <circle cx={50} cy={30} r={38} fill={tint(shirt, 0.75)} />
      <g transform="translate(0 4)">
        <HairBack t={t} />
        <path d="M43 62 L57 62 L56.5 73 Q50 76 43.5 73 Z" fill={t.skin} {...line} />
        <path d="M15 104 C15 81 31 71 50 71 C69 71 85 81 85 104 Z" fill={shirt} {...line} />
        <path d="M42 71.5 Q50 79 58 71.5" fill="none" stroke={shade(shirt, 0.35)} strokeWidth={2} strokeLinecap="round" />
        {t.head !== "square" ? (
          <g fill={t.skin} {...line}>
            <circle cx={29.5} cy={48} r={4.8} />
            <circle cx={70.5} cy={48} r={4.8} />
          </g>
        ) : null}
        <Head t={t} />
        {coveredHair ? null : <HairFront t={t} />}
        {t.blush ? (
          <g fill="#ff7a8a" opacity={0.42}>
            <circle cx={37.5} cy={54} r={3.6} />
            <circle cx={62.5} cy={54} r={3.6} />
          </g>
        ) : null}
        <Eyes t={t} />
        <Brows t={t} />
        <Mouth t={t} />
        <Extra t={t} shirt={shirt} />
        <Hat t={t} />
      </g>
    </svg>
  );
});
