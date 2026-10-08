/**
 * The valley village, drawn in code as SVG paths (original art, no assets).
 *
 * Three depth layers: the far hills, the village itself and the meadow in front.
 * The WebGL background packs each layer into one colour channel of a texture so
 * mist can drift between them; the static fallback draws the same paths as SVG.
 *
 * Art space is 2048 × 512 units with y pointing down, and it tiles horizontally.
 * One art unit is 1/1024 of a scene unit (see shader.ts), and x = 1024 sits in
 * the middle of the screen, where the church is. Every shape is wound clockwise
 * so a layer's shapes can share one path filled with the nonzero rule without
 * overlaps turning into holes.
 */
import { mulberry32 } from "../art/rng";

export const VILLAGE_WIDTH = 2048;
export const VILLAGE_HEIGHT = 512;
const VW = VILLAGE_WIDTH;
const VH = VILLAGE_HEIGHT;
const TAU = Math.PI * 2;

export type LayerName = "far" | "mid" | "near";
export const LAYER_NAMES: readonly LayerName[] = ["far", "mid", "near"];

/** Window brightness levels. Each level also flickers at its own pace in the shader. */
export const LIGHT_LEVELS = [0.55, 0.7, 0.85, 1] as const;

export interface LightGroup {
  level: number;
  path: string;
  /** Filled with the even-odd rule (the clock face, whose hands are holes). */
  evenOdd: boolean;
}

/** Bounding box of a drawn object, for tests and debugging. */
export interface VillageObject {
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VillageLayer {
  name: LayerName;
  path: string;
  lights: LightGroup[];
  objects: VillageObject[];
}

/** The windmill's hub; the shader draws the turning sails around it. */
export interface Windmill {
  x: number;
  y: number;
  radius: number;
}

export interface Village {
  width: number;
  height: number;
  layers: Record<LayerName, VillageLayer>;
  windmill: Windmill;
}

type Point = readonly [number, number];

const num = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? "0" : String(r);
};

function polygonPath(points: readonly Point[]): string {
  // Shoelace sum: positive means clockwise on screen (y points down).
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b) sum += a[0] * b[1] - b[0] * a[1];
  }
  const ordered = sum < 0 ? [...points].reverse() : points;
  return ordered.map(([x, y], i) => `${i === 0 ? "M" : "L"}${num(x)} ${num(y)}`).join("") + "z";
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  // Two half arcs with sweep 1: left → top → right → bottom, clockwise on screen.
  return (
    `M${num(cx - rx)} ${num(cy)}` +
    `a${num(rx)} ${num(ry)} 0 1 1 ${num(2 * rx)} 0` +
    `a${num(rx)} ${num(ry)} 0 1 1 ${num(-2 * rx)} 0z`
  );
}

/** A rectangle with a round top (church windows, doors). */
function archPath(x: number, y: number, w: number, h: number): string {
  const r = w / 2;
  return `M${num(x)} ${num(y + h)}V${num(y + r)}A${num(r)} ${num(r)} 0 0 1 ${num(x + w)} ${num(y + r)}V${num(y + h)}z`;
}

class Shapes {
  private readonly parts: string[] = [];
  readonly objects: VillageObject[] = [];

  note(kind: string, x: number, y: number, w: number, h: number): void {
    this.objects.push({ kind, x, y, w, h });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.parts.push(rectPath(x, y, w, h));
  }
  circle(cx: number, cy: number, r: number): void {
    this.parts.push(ellipsePath(cx, cy, r, r));
  }
  ellipse(cx: number, cy: number, rx: number, ry: number): void {
    this.parts.push(ellipsePath(cx, cy, rx, ry));
  }
  poly(points: readonly Point[]): void {
    this.parts.push(polygonPath(points));
  }
  arch(x: number, y: number, w: number, h: number): void {
    this.parts.push(archPath(x, y, w, h));
  }
  path(): string {
    return this.parts.join("");
  }
}

class Lights {
  private readonly byLevel = new Map<number, string[]>();
  private readonly evenOdd: LightGroup[] = [];

  private add(level: number, part: string): void {
    const list = this.byLevel.get(level);
    if (list) list.push(part);
    else this.byLevel.set(level, [part]);
  }
  rect(x: number, y: number, w: number, h: number, level: number): void {
    this.add(level, rectPath(x, y, w, h));
  }
  circle(cx: number, cy: number, r: number, level: number): void {
    this.add(level, ellipsePath(cx, cy, r, r));
  }
  arch(x: number, y: number, w: number, h: number, level: number): void {
    this.add(level, archPath(x, y, w, h));
  }
  /** A lit clock face; the hands (angles in turns from 12 o'clock) are cut out. */
  clock(cx: number, cy: number, r: number, level: number, hour: number, minute: number): void {
    const hand = (turns: number, length: number, width: number): string => {
      const a = turns * TAU;
      const dx = Math.sin(a);
      const dy = -Math.cos(a);
      const px = -dy * (width / 2);
      const py = dx * (width / 2);
      return polygonPath([
        [cx - px - dx * 1.5, cy - py - dy * 1.5],
        [cx + px - dx * 1.5, cy + py - dy * 1.5],
        [cx + px + dx * length, cy + py + dy * length],
        [cx - px + dx * length, cy - py + dy * length],
      ]);
    };
    const path = ellipsePath(cx, cy, r, r) + hand(hour, r * 0.5, 1.9) + hand(minute, r * 0.78, 1.4);
    this.evenOdd.push({ level, path, evenOdd: true });
  }
  groups(): LightGroup[] {
    const groups: LightGroup[] = [];
    for (const level of LIGHT_LEVELS) {
      const parts = this.byLevel.get(level);
      if (parts && parts.length > 0) groups.push({ level, path: parts.join(""), evenOdd: false });
    }
    return [...groups, ...this.evenOdd];
  }
}

// ------------------------------------------------------------------ ground lines

function wrapDelta(x: number, centre: number): number {
  let d = (x - centre) % VW;
  if (d > VW / 2) d -= VW;
  if (d < -VW / 2) d += VW;
  return d;
}

function bump(x: number, centre: number, width: number, amount: number): number {
  const d = wrapDelta(x, centre);
  return amount * Math.exp(-(d * d) / (2 * width * width));
}

const wave = (x: number, cycles: number, phase: number): number => Math.sin((TAU * cycles * x) / VW + phase);

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Height of the far ridge above the bottom edge: a valley in the middle, mountains at the sides. */
export function farHeight(x: number): number {
  const fromCentre = Math.abs(wrapDelta(x, VW / 2));
  return (
    282 +
    125 * smooth(260, 820, fromCentre) +
    16 * wave(x, 3, 0.7) +
    9 * wave(x, 7, 2.1) +
    5 * wave(x, 13, 0.3) +
    bump(x, 330, 80, 46) +
    bump(x, 1760, 100, 40) +
    bump(x, 1229, 70, 16) -
    bump(x, 1024, 160, 12)
  );
}

/** The village's ground, with a mound for the windmill. */
export function midHeight(x: number): number {
  return (
    196 +
    9 * wave(x, 2, 1.0) +
    6 * wave(x, 5, 0.2) +
    3 * wave(x, 11, 1.7) +
    bump(x, 1330, 55, 30) +
    bump(x, 1024, 150, 8) +
    bump(x, 520, 110, 16) +
    bump(x, 1720, 90, 12)
  );
}

/** The meadow in front, dipping in the middle so the church stays in view. */
export function nearHeight(x: number): number {
  return (
    150 +
    7 * wave(x, 3, 2.3) +
    5 * wave(x, 8, 0.9) +
    2.5 * wave(x, 17, 0.4) +
    bump(x, 780, 110, 16) +
    bump(x, 1560, 120, 14) +
    bump(x, 300, 140, 12) -
    bump(x, 1024, 120, 10)
  );
}

/** Screen y (art units, down) of a ground line at x. */
const groundY = (height: (x: number) => number, x: number): number => VH - height(x);

function ground(shapes: Shapes, height: (x: number) => number): void {
  const points: Point[] = [];
  // A little past both edges so tiled copies overlap instead of leaving a seam.
  for (let x = -8; x <= VW + 8; x += 8) points.push([x, groundY(height, x)]);
  points.push([VW + 8, VH + 4], [-8, VH + 4]);
  shapes.poly(points);
}

// ------------------------------------------------------------------ building blocks

type Rand = () => number;

const between = (rand: Rand, lo: number, hi: number): number => lo + (hi - lo) * rand();

function pickLevel(rand: Rand): number {
  return LIGHT_LEVELS[Math.floor(rand() * LIGHT_LEVELS.length)] ?? 1;
}

function pine(shapes: Shapes, x: number, base: number, width: number, height: number): void {
  // Two stacked tiers read as a fir tree even when tiny.
  shapes.poly([
    [x - width / 2, base],
    [x, base - height * 0.62],
    [x + width / 2, base],
  ]);
  shapes.poly([
    [x - width * 0.36, base - height * 0.38],
    [x, base - height],
    [x + width * 0.36, base - height * 0.38],
  ]);
  shapes.rect(x - width * 0.08, base - 2, width * 0.16, 4);
  shapes.note("pine", x - width / 2, base - height, width, height);
}

function roundTree(shapes: Shapes, x: number, base: number, r: number, rand: Rand): void {
  const trunkH = r * 0.9;
  shapes.rect(x - r * 0.13, base - trunkH, r * 0.26, trunkH + 3);
  const cy = base - trunkH - r * 0.7;
  shapes.circle(x, cy, r);
  shapes.circle(x - r * 0.62, cy + r * 0.32, r * between(rand, 0.55, 0.7));
  shapes.circle(x + r * 0.6, cy + r * 0.28, r * between(rand, 0.55, 0.72));
  shapes.circle(x + r * 0.12, cy - r * 0.55, r * 0.62);
  shapes.note("tree", x - r * 1.3, cy - r * 1.2, r * 2.6, base - (cy - r * 1.2));
}

function cypress(shapes: Shapes, x: number, base: number, width: number, height: number): void {
  shapes.ellipse(x, base - height / 2, width / 2, height / 2);
  shapes.rect(x - 1.5, base - 6, 3, 8);
  shapes.note("cypress", x - width / 2, base - height, width, height);
}

function bush(shapes: Shapes, x: number, base: number, size: number): void {
  shapes.circle(x - size * 0.8, base - size * 0.45, size * 0.7);
  shapes.circle(x, base - size * 0.7, size);
  shapes.circle(x + size * 0.85, base - size * 0.4, size * 0.65);
  shapes.note("bush", x - size * 1.5, base - size * 1.7, size * 3, size * 1.7);
}

type Roof = "gable" | "hip" | "steep";

interface HouseSpec {
  x: number;
  w: number;
  h: number;
  roof: Roof;
  /** Chimney side: -1 left, 1 right, 0 none. */
  chimney: -1 | 0 | 1;
}

function house(shapes: Shapes, lights: Lights, spec: HouseSpec, base: number, rand: Rand, windowSize: number): void {
  const { x, w, h } = spec;
  const left = x - w / 2;
  const top = base - h;
  shapes.rect(left, top, w, h + 6);
  let roofH = w * 0.42;
  if (spec.roof === "gable") {
    shapes.poly([
      [left - 4, top + 1],
      [x, top - roofH],
      [left + w + 4, top + 1],
    ]);
  } else if (spec.roof === "steep") {
    roofH = w * 0.72;
    shapes.poly([
      [left - 3, top + 1],
      [x, top - roofH],
      [left + w + 3, top + 1],
    ]);
  } else {
    roofH = w * 0.3;
    shapes.poly([
      [left - 4, top + 1],
      [left + w * 0.24, top - roofH],
      [left + w * 0.76, top - roofH],
      [left + w + 4, top + 1],
    ]);
  }
  if (spec.chimney !== 0) {
    const cx = x + spec.chimney * w * 0.27;
    shapes.rect(cx - 3, top - roofH * 0.82 - 7, 6.5, roofH * 0.6 + 7);
  }
  shapes.note("house", left - 4, top - roofH - 8, w + 8, h + roofH + 8);

  // Windows: one or two per floor, some left dark.
  const floors = h >= 38 ? 2 : 1;
  const perFloor = w >= 42 ? 2 : 1;
  for (let f = 0; f < floors; f++) {
    const wy = base - h + 8 + f * (h / floors) * 0.95 + (floors === 1 ? h * 0.12 : 0);
    for (let i = 0; i < perFloor; i++) {
      if (rand() < 0.2) continue;
      const wx = perFloor === 1 ? x : x + (i === 0 ? -1 : 1) * w * 0.24;
      lights.rect(wx - windowSize / 2, wy, windowSize, windowSize * 1.25, pickLevel(rand));
    }
  }
}

// ------------------------------------------------------------------ layers

function farLayer(): VillageLayer {
  const shapes = new Shapes();
  const lights = new Lights();
  const rand = mulberry32(0xfa12);
  ground(shapes, farHeight);
  const y = (x: number) => groundY(farHeight, x);

  // Fir forests on the slopes.
  const forests: Array<[number, number]> = [
    [40, 270],
    [520, 700],
    [1470, 1600],
    [1700, 2000],
  ];
  for (const [from, to] of forests) {
    for (let x = from; x < to; x += between(rand, 6, 12)) {
      const h = between(rand, 14, 27);
      pine(shapes, x, y(x) + 3, h * 0.55, h);
    }
  }

  // The lookout tower on the ridge, its lamp always burning.
  const tx = 1229;
  const ty = y(tx) + 3;
  shapes.rect(tx - 6, ty - 46, 12, 50);
  shapes.rect(tx - 8.5, ty - 50, 17, 6);
  shapes.poly([
    [tx - 9, ty - 49],
    [tx, ty - 66],
    [tx + 9, ty - 49],
  ]);
  shapes.note("tower", tx - 9, ty - 66, 18, 66);
  lights.rect(tx - 3, ty - 43, 6, 7, 1);
  lights.rect(tx - 2, ty - 26, 4, 5, 0.7);

  // Two hamlets on the far slopes.
  for (const hx of [430, 1650]) {
    for (let i = 0; i < 4; i++) {
      const x = hx + i * 15 + between(rand, -2, 2);
      const w = between(rand, 11, 16);
      const h = between(rand, 7, 10);
      const base = y(x) + 3;
      shapes.rect(x - w / 2, base - h, w, h + 3);
      shapes.poly([
        [x - w / 2 - 2, base - h + 0.5],
        [x, base - h - w * 0.45],
        [x + w / 2 + 2, base - h + 0.5],
      ]);
      shapes.note("hamlet", x - w / 2 - 2, base - h - w * 0.45, w + 4, h + w * 0.45);
      if (rand() < 0.8) lights.rect(x - 1.5, base - h + 2.5, 3, 3, pickLevel(rand));
    }
  }

  return { name: "far", path: shapes.path(), lights: lights.groups(), objects: shapes.objects };
}

const MID_HOUSES: HouseSpec[] = [
  { x: 120, w: 40, h: 32, roof: "gable", chimney: 1 },
  { x: 300, w: 44, h: 34, roof: "gable", chimney: 1 },
  { x: 352, w: 36, h: 28, roof: "hip", chimney: 0 },
  { x: 540, w: 50, h: 40, roof: "steep", chimney: -1 },
  { x: 596, w: 38, h: 30, roof: "gable", chimney: 1 },
  { x: 690, w: 46, h: 36, roof: "gable", chimney: 0 },
  { x: 760, w: 40, h: 44, roof: "steep", chimney: 1 },
  { x: 850, w: 52, h: 34, roof: "hip", chimney: -1 },
  { x: 906, w: 34, h: 40, roof: "gable", chimney: 1 },
  { x: 1142, w: 44, h: 38, roof: "steep", chimney: 1 },
  { x: 1196, w: 50, h: 32, roof: "gable", chimney: -1 },
  { x: 1254, w: 36, h: 42, roof: "gable", chimney: 1 },
  { x: 1420, w: 48, h: 34, roof: "hip", chimney: 1 },
  { x: 1478, w: 38, h: 40, roof: "steep", chimney: -1 },
  { x: 1590, w: 54, h: 36, roof: "gable", chimney: 1 },
  { x: 1652, w: 40, h: 30, roof: "hip", chimney: 0 },
  { x: 1810, w: 46, h: 38, roof: "gable", chimney: -1 },
  { x: 1870, w: 36, h: 30, roof: "steep", chimney: 1 },
  { x: 1980, w: 44, h: 34, roof: "hip", chimney: 0 },
];

function church(shapes: Shapes, lights: Lights, cx: number, base: number): void {
  // Side aisles with lean-to roofs.
  for (const side of [-1, 1] as const) {
    const ax = side < 0 ? cx - 76 : cx + 50;
    shapes.rect(ax, base - 40, 26, 44);
    const inner = side < 0 ? ax + 26 : ax;
    const outer = side < 0 ? ax - 4 : ax + 30;
    shapes.poly([
      [outer, base - 39],
      [inner, base - 58],
      [inner, base - 39],
    ]);
    lights.arch(ax + 10, base - 30, 6, 13, 0.7);
  }
  // Nave and its roof.
  shapes.rect(cx - 50, base - 64, 100, 68);
  shapes.poly([
    [cx - 56, base - 63],
    [cx, base - 104],
    [cx + 56, base - 63],
  ]);
  // Tower with a belfry, clock and spire.
  shapes.rect(cx - 18, base - 178, 36, 182);
  shapes.rect(cx - 21, base - 182, 42, 7);
  shapes.poly([
    [cx - 23, base - 180],
    [cx, base - 268],
    [cx + 23, base - 180],
  ]);
  shapes.circle(cx, base - 270, 3.2);
  shapes.rect(cx - 0.9, base - 282, 1.8, 12);
  shapes.note("church", cx - 80, base - 282, 160, 286);

  lights.clock(cx, base - 140, 11, 1, -0.17, 0.17);
  lights.arch(cx - 6, base - 112, 12, 20, 0.85);
  lights.arch(cx - 40, base - 52, 8, 20, 0.85);
  lights.arch(cx + 32, base - 52, 8, 20, 0.85);
  lights.arch(cx - 7, base - 30, 14, 30, 0.55);
}

function windmill(shapes: Shapes, lights: Lights, cx: number, base: number): Windmill {
  shapes.poly([
    [cx - 18, base + 4],
    [cx - 10, base - 88],
    [cx + 10, base - 88],
    [cx + 18, base + 4],
  ]);
  shapes.circle(cx, base - 90, 12);
  shapes.rect(cx - 13, base - 92, 26, 5);
  shapes.note("windmill", cx - 18, base - 102, 36, 106);
  lights.rect(cx - 3, base - 62, 6, 8, 0.85);
  lights.arch(cx - 5, base - 17, 10, 17, 0.55);
  return { x: cx, y: base - 94, radius: 74 };
}

function lampPost(shapes: Shapes, lights: Lights, x: number, base: number): void {
  shapes.rect(x - 1, base - 30, 2, 33);
  shapes.rect(x - 3.5, base - 37, 7, 7);
  shapes.poly([
    [x - 4.5, base - 36.5],
    [x, base - 41],
    [x + 4.5, base - 36.5],
  ]);
  shapes.note("lamp", x - 4.5, base - 41, 9, 44);
  lights.circle(x, base - 33.5, 2.6, 1);
}

function midLayer(): { layer: VillageLayer; windmill: Windmill } {
  const shapes = new Shapes();
  const lights = new Lights();
  const rand = mulberry32(0x3d17);
  ground(shapes, midHeight);
  const y = (x: number) => groundY(midHeight, x);

  church(shapes, lights, 1024, y(1024) + 2);
  for (const spec of MID_HOUSES) house(shapes, lights, spec, y(spec.x) + 3, rand, 7);
  const mill = windmill(shapes, lights, 1330, y(1330) + 2);

  const roundTrees: Array<[number, number]> = [
    [40, 15],
    [200, 18],
    [420, 20],
    [640, 16],
    [805, 14],
    [1300, 13],
    [1530, 18],
    [1750, 20],
  ];
  for (const [x, r] of roundTrees) roundTree(shapes, x, y(x) + 3, r, rand);
  for (const x of [250, 728, 945, 1103, 1920]) cypress(shapes, x, y(x) + 3, 14, between(rand, 44, 56));
  for (const x of [470, 1372, 1700, 2010]) pine(shapes, x, y(x) + 3, 22, between(rand, 40, 52));
  for (const x of [655, 940, 1112, 1290, 1545, 1770]) lampPost(shapes, lights, x, y(x) + 2);

  return {
    layer: { name: "mid", path: shapes.path(), lights: lights.groups(), objects: shapes.objects },
    windmill: mill,
  };
}

function cottage(
  shapes: Shapes,
  lights: Lights,
  cx: number,
  base: number,
  style: "thatch" | "gable",
): void {
  const w = style === "thatch" ? 72 : 62;
  const h = style === "thatch" ? 52 : 48;
  const left = cx - w / 2;
  shapes.rect(left, base - h, w, h + 6);
  if (style === "thatch") {
    // A rounded thatched roof.
    const points: Point[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      points.push([left - 9 + (w + 18) * t, base - h + 3 - 50 * Math.pow(Math.sin(Math.PI * t), 0.7)]);
    }
    shapes.poly(points);
    shapes.rect(cx + 16, base - h - 56, 9, 34);
    shapes.rect(cx + 14.5, base - h - 59, 12, 4);
    lights.rect(left + 7, base - 37, 13, 13, 1);
    lights.rect(left + w - 20, base - 37, 13, 13, 0.85);
    lights.circle(cx, base - h - 16, 5, 0.7);
    shapes.note("cottage", left - 9, base - h - 59, w + 18, h + 59);
  } else {
    shapes.poly([
      [left - 8, base - h + 1],
      [cx, base - h - 40],
      [left + w + 8, base - h + 1],
    ]);
    shapes.rect(cx + 10, base - h - 36, 8, 28);
    lights.rect(left + 8, base - 34, 12, 12, 0.85);
    lights.rect(left + w - 20, base - 34, 12, 12, 0.7);
    lights.circle(cx, base - h - 14, 5, 1);
    shapes.note("cottage", left - 8, base - h - 40, w + 16, h + 40);
  }
}

function fence(shapes: Shapes, from: number, to: number, height: (x: number) => number): void {
  let prev: Point | null = null;
  for (let x = from; x <= to; x += 9) {
    const base = groundY(height, x) + 3;
    shapes.poly([
      [x, base + 2],
      [x, base - 14],
      [x + 1.8, base - 17],
      [x + 3.6, base - 14],
      [x + 3.6, base + 2],
    ]);
    const here: Point = [x + 1.8, base];
    if (prev) {
      for (const lift of [11, 5]) {
        shapes.poly([
          [prev[0], prev[1] - lift - 1.3],
          [here[0], here[1] - lift - 1.3],
          [here[0], here[1] - lift + 1.3],
          [prev[0], prev[1] - lift + 1.3],
        ]);
      }
    }
    prev = here;
  }
  shapes.note("fence", from, groundY(height, from) - 17, to - from + 4, 19);
}

function nearLayer(): VillageLayer {
  const shapes = new Shapes();
  const lights = new Lights();
  const rand = mulberry32(0x9e41);
  ground(shapes, nearHeight);
  const y = (x: number) => groundY(nearHeight, x);

  cottage(shapes, lights, 780, y(780) + 3, "thatch");
  cottage(shapes, lights, 1560, y(1560) + 3, "gable");

  const bigTrees: Array<[number, number]> = [
    [270, 32],
    [640, 34],
    [1345, 28],
    [1720, 36],
    [1905, 30],
  ];
  for (const [x, r] of bigTrees) roundTree(shapes, x, y(x) + 4, r, rand);
  for (const [x, h] of [
    [120, 92],
    [905, 70],
    [1455, 82],
    [1998, 76],
  ] as const) {
    pine(shapes, x, y(x) + 4, h * 0.42, h);
  }

  fence(shapes, 690, 736, nearHeight);
  fence(shapes, 826, 880, nearHeight);
  fence(shapes, 1092, 1250, nearHeight);

  for (const [x, s] of [
    [30, 10],
    [180, 12],
    [372, 11],
    [700, 9],
    [884, 10],
    [962, 8],
    [1080, 9],
    [1270, 12],
    [1402, 10],
    [1500, 11],
    [1640, 9],
    [1800, 13],
  ] as const) {
    bush(shapes, x, y(x) + 4, s);
  }

  // A lantern hanging from a post at the edge of the square.
  const lx = 1185;
  const lb = y(lx) + 3;
  shapes.rect(lx - 1.6, lb - 52, 3.2, 55);
  shapes.rect(lx - 1.6, lb - 52, 15, 2.6);
  shapes.rect(lx + 10.2, lb - 50, 1.4, 5);
  shapes.rect(lx + 6.5, lb - 45, 9, 12);
  shapes.poly([
    [lx + 5.5, lb - 44.5],
    [lx + 11, lb - 49],
    [lx + 16.5, lb - 44.5],
  ]);
  shapes.note("lantern", lx - 2, lb - 52, 19, 55);
  lights.rect(lx + 8, lb - 43, 6, 8.5, 1);

  // Grass tufts all along the meadow.
  for (let x = 4; x < VW - 4; x += between(rand, 9, 17)) {
    const base = y(x) + 3;
    const blades = 2 + Math.floor(rand() * 2);
    for (let b = 0; b < blades; b++) {
      const bx = x + between(rand, -3, 3);
      const h = between(rand, 5, 11);
      const lean = between(rand, -3.5, 3.5);
      shapes.poly([
        [bx - 1.3, base + 2],
        [bx + lean, base - h],
        [bx + 1.3, base + 2],
      ]);
    }
  }

  return { name: "near", path: shapes.path(), lights: lights.groups(), objects: shapes.objects };
}

/** Draws the whole village. Deterministic: the same art every time, on every device. */
export function createVillage(): Village {
  const mid = midLayer();
  return {
    width: VW,
    height: VH,
    layers: { far: farLayer(), mid: mid.layer, near: nearLayer() },
    windmill: mid.windmill,
  };
}

let cached: Village | null = null;

/** The village, built once and cached. */
export function buildVillage(): Village {
  cached ??= createVillage();
  return cached;
}

/** Static windmill sails (for the SVG fallback); `angle` in radians. */
export function windmillSailsPath(mill: Windmill, angle: number): string {
  const parts: string[] = [];
  for (let k = 0; k < 4; k++) {
    const a = angle + (k * Math.PI) / 2;
    const dx = Math.cos(a);
    const dy = -Math.sin(a); // y down
    const nx = -dy;
    const ny = dx;
    const at = (along: number, across: number): Point => [
      mill.x + dx * along + nx * across,
      mill.y + dy * along + ny * across,
    ];
    parts.push(polygonPath([at(0, -1.3), at(mill.radius, -1.3), at(mill.radius, 1.3), at(0, 1.3)]));
    parts.push(polygonPath([at(14, 0), at(mill.radius, 0), at(mill.radius, 9), at(14, 9)]));
  }
  parts.push(ellipsePath(mill.x, mill.y, 4, 4));
  return parts.join("");
}

export interface VillageTextures {
  /** R = far, G = mid, B = near silhouettes. */
  silhouettes: HTMLCanvasElement;
  /** Window lights per layer in the same channels, brightness = level. */
  lights: HTMLCanvasElement;
}

/**
 * Draws the layers into two canvases for WebGL. `scale` 1 gives 2048 × 512;
 * 0.5 gives 1024 × 256 for weaker devices (both powers of two for mipmaps).
 */
export function rasterizeVillage(village: Village, scale: number): VillageTextures {
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(village.width * scale);
    canvas.height = Math.round(village.height * scale);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Adding light keeps each layer in its own channel.
    ctx.globalCompositeOperation = "lighter";
    return [canvas, ctx];
  };
  const channel = (name: LayerName, value: number): string => {
    const v = Math.round(value * 255);
    return name === "far" ? `rgb(${v},0,0)` : name === "mid" ? `rgb(0,${v},0)` : `rgb(0,0,${v})`;
  };

  const [silhouettes, sctx] = make();
  const [lights, lctx] = make();
  for (const name of LAYER_NAMES) {
    const layer = village.layers[name];
    sctx.fillStyle = channel(name, 1);
    sctx.fill(new Path2D(layer.path));
    for (const group of layer.lights) {
      lctx.fillStyle = channel(name, group.level);
      lctx.fill(new Path2D(group.path), group.evenOdd ? "evenodd" : "nonzero");
    }
  }
  return { silhouettes, lights };
}
