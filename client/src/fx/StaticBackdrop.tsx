import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { mulberry32 } from "../art/rng";
import { rgbToCss, sceneColors, sceneUnit, sunAndMoon, type RGB } from "./palette";
import { dayForScene, type SceneTarget } from "./timeOfDay";
import { LAYER_NAMES, VILLAGE_HEIGHT, VILLAGE_WIDTH, buildVillage, windmillSailsPath } from "./village";

const VW = VILLAGE_WIDTH;
const VH = VILLAGE_HEIGHT;

function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 1 || box.height < 1) return;
      setSize((current) =>
        Math.abs(current.width - box.width) < 1 && Math.abs(current.height - box.height) < 1
          ? current
          : { width: box.width, height: box.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

const rgba = (c: RGB, alpha: number): string =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alpha})`;

/** Mist bands in art units (y down): centre and half-height. */
const MIST_BANDS = [
  { y: VH - 0.24 * 1024, half: 92, strength: 0.55 },
  { y: VH - 0.165 * 1024, half: 70, strength: 0.45 },
  { y: VH - 0.045 * 1024, half: 46, strength: 0.4 },
] as const;

/** The village layers as plain SVG, drawn once; colours come from CSS variables so they can fade. */
const VillageSvg = memo(function VillageSvg() {
  const village = buildVillage();
  const sails = windmillSailsPath(village.windmill, 0.35);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const mist = (index: number) => {
    const band = MIST_BANDS[index];
    if (!band) return null;
    return (
      <rect
        x={-VW}
        y={band.y - band.half}
        width={VW * 3}
        height={band.half * 2}
        fill={`url(#mist${id})`}
        className="static-mist"
        style={{ opacity: `calc(var(--mist) * ${band.strength})` }}
      />
    );
  };
  return (
    <svg
      className="static-village"
      viewBox={`${-VW} 0 ${VW * 3} ${VH}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`mist${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--fog)", stopOpacity: 0 }} />
          <stop offset="0.5" style={{ stopColor: "var(--fog)", stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: "var(--fog)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {LAYER_NAMES.map((name, index) => (
        <g key={name}>
          {index === 1 ? mist(0) : index === 2 ? mist(1) : null}
          {[-VW, 0, VW].map((dx) => (
            <g key={dx} transform={dx === 0 ? undefined : `translate(${dx} 0)`} className={`static-layer static-${name}`}>
              <path d={village.layers[name].path} />
              {name === "mid" ? <path d={sails} /> : null}
              <g className="static-lights">
                {village.layers[name].lights.map((group, i) => (
                  <path key={i} d={group.path} fillRule={group.evenOdd ? "evenodd" : undefined} opacity={group.level} />
                ))}
              </g>
            </g>
          ))}
        </g>
      ))}
      {mist(2)}
    </svg>
  );
});

function Stars({ width, height }: { width: number; height: number }) {
  const stars = useMemo(() => {
    const rand = mulberry32(42);
    return Array.from({ length: 70 }, () => ({
      x: rand() * width,
      y: rand() * height * 0.62,
      r: 0.6 + rand() * 1.3,
      o: 0.4 + rand() * 0.6,
    }));
  }, [width, height]);
  return (
    <svg className="static-stars" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
      ))}
    </svg>
  );
}

/**
 * The background without WebGL: CSS colours, an SVG village and simple sun and
 * moon discs. Used on low-end devices, when effects are off, and while WebGL starts.
 */
export function StaticBackdrop({ scene }: { scene: SceneTarget }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useBoxSize(ref);
  const day = dayForScene(scene);
  const c = sceneColors(day, scene.mode === "normal" ? 1 : 0);
  const unit = sceneUnit(width, height);
  const { sun, moon } = sunAndMoon(day, { width: width / unit, height: height / unit });

  const body = (b: typeof sun, extra: CSSProperties): CSSProperties => ({
    left: width / 2 + (b.x - b.r) * unit,
    bottom: (b.y - b.r) * unit,
    width: b.r * 2 * unit,
    height: b.r * 2 * unit,
    opacity: b.w,
    ...extra,
  });

  const vars = {
    "--zenith": rgbToCss(c.zenith),
    "--horizon": rgbToCss(c.horizon),
    "--far": rgbToCss(c.far),
    "--mid": rgbToCss(c.mid),
    "--near": rgbToCss(c.near),
    "--fog": rgbToCss(c.fog),
    "--window": rgbToCss(c.window),
    "--lights": c.lights.toFixed(3),
    "--stars": c.stars.toFixed(3),
    "--mist": Math.min(1, c.fogAmount).toFixed(3),
    "--vignette": c.vignette.toFixed(3),
    "--unit": `${unit}px`,
  } as CSSProperties;

  return (
    <div ref={ref} className="static-backdrop" style={vars} aria-hidden="true">
      <div className="static-sky">
        <div className="static-zenith" />
      </div>
      <Stars width={Math.round(width)} height={Math.round(height)} />
      <div
        className="static-sun"
        style={body(sun, { background: rgbToCss(c.sun), boxShadow: `0 0 ${unit * 0.12}px ${unit * 0.04}px ${rgba(c.sun, 0.55)}` })}
      />
      <div className="static-moon" style={body(moon, { background: rgbToCss(c.moon), boxShadow: `0 0 ${unit * 0.08}px ${rgba(c.moon, 0.35)}` })}>
        <span
          className="static-moon-shadow"
          style={{ transform: `translate(${c.moonShadow * 50}%, ${c.moonShadow * 9}%)` }}
        />
      </div>
      <VillageSvg />
      <div className="static-vignette" />
    </div>
  );
}
