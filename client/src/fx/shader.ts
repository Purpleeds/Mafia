/**
 * The background's fragment shader (WebGL 1, GLSL ES 1.00). One full-screen
 * triangle draws everything: sky, sun, moon, stars, clouds, the village layers
 * with their window lights, drifting mist between the layers, vignette, film
 * grain and the effect pulses.
 *
 * It composites front to back: once a pixel is covered by a near layer, nothing
 * behind it (more mist, the sky, the stars) is computed.
 *
 * Coordinates: scene units of `uFrame.z` pixels, origin at the bottom centre of
 * the screen, y up (see palette.ts). The village textures span 2 × 0.5 scene units.
 */
import type { Windmill } from "./village";

export interface ShaderFeatures {
  /** Noise octaves for mist and clouds. */
  octaves: number;
  clouds: boolean;
  /** Soft halos around lit windows (needs mipmaps). */
  glow: boolean;
}

export const VERTEX_SHADER = `attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** Uniform names, in the order the renderer looks them up. */
export const UNIFORMS = [
  "uFrame",
  "uZenith",
  "uHorizon",
  "uFarCol",
  "uMidCol",
  "uNearCol",
  "uFogCol",
  "uSunCol",
  "uMoonCol",
  "uWinCol",
  "uSun",
  "uMoon",
  "uParallax",
  "uDrift",
  "uPulse",
  "uRing",
  "uSil",
  "uLit",
] as const;
export type UniformName = (typeof UNIFORMS)[number];

const BODY = /* glsl */ `
uniform vec4 uFrame;    // canvas width, height (px), scene unit (px), time (s)
uniform vec4 uZenith;   // rgb, stars
uniform vec4 uHorizon;  // rgb, window lights
uniform vec4 uFarCol;   // rgb, mist
uniform vec4 uMidCol;   // rgb, daylight
uniform vec4 uNearCol;  // rgb, film grain
uniform vec4 uFogCol;   // rgb, vignette
uniform vec4 uSunCol;   // rgb, cloud cover
uniform vec4 uMoonCol;  // rgb, moon shadow offset (in radii)
uniform vec4 uWinCol;   // rgb, unused
uniform vec4 uSun;      // x, y (scene units), radius, visibility
uniform vec4 uMoon;     // x, y, radius, visibility
uniform vec4 uParallax; // horizontal offsets (scene units): hills, far, mid, near
uniform vec4 uDrift;    // noise offsets: clouds, valley mist, low mist, ground mist
uniform vec4 uPulse;    // rgb, strength
uniform vec4 uRing;     // ring radius, ring strength, shape (0 edges .. 1 centre), sail angle
uniform sampler2D uSil; // silhouettes: r far, g mid, b near
uniform sampler2D uLit; // window lights, same channels

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise that repeats every 256 cells in x, so drifting offsets can wrap.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, 256.0);
  float x1 = mod(i.x + 1.0, 256.0);
  float a = hash12(vec2(x0, i.y));
  float b = hash12(vec2(x1, i.y));
  float c = hash12(vec2(x0, i.y + 1.0));
  float d = hash12(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < OCTAVES; k++) {
    s += a * vnoise(p);
    p = p * 2.0 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return s / (1.0 - 2.0 * a);
}

vec2 layerUV(vec2 q, float offset) {
  return vec2((q.x + offset) * 0.5 + 0.5, 1.0 - q.y * 2.0);
}

float mistBand(vec2 q, float lo, float mid, float hi, float offset, float drift, float scale) {
  float band = smoothstep(lo, mid, q.y) * (1.0 - smoothstep(mid, hi, q.y));
  if (band < 0.002) return 0.0;
  float n = fbm(vec2((q.x + offset) * scale + drift, q.y * scale * 3.0));
  return band * smoothstep(0.32, 0.82, n);
}

float flicker(float level, float t) {
  return 0.9 + 0.1 * sin(t * (2.3 + level * 4.1) + level * 37.0) * sin(t * (0.7 + level * 1.3) + level * 11.0);
}

vec3 withWindows(vec3 base, float lit, float lights, float t) {
  float w = clamp(lit * lights * 1.35, 0.0, 1.0);
  return mix(base, uWinCol.rgb * flicker(lit, t) * 1.1, w);
}

// The windmill's four sails, turning around its hub (art units, 1/1024 scene unit).
float sails(vec2 uvMid, float px) {
  vec2 art = vec2(uvMid.x * 2048.0, uvMid.y * 512.0);
  float dx = art.x - MILL_X;
  dx -= 2048.0 * floor(dx / 2048.0 + 0.5);
  vec2 d = vec2(dx, MILL_Y - art.y);
  float r = length(d);
  if (r > MILL_R + 3.0) return 0.0;
  float aa = 1024.0 * px;
  float a = mod(atan(d.y, d.x) - uRing.w + 0.7853982, 1.5707963) - 0.7853982;
  vec2 b = r * vec2(cos(a), sin(a));
  float tip = 1.0 - smoothstep(MILL_R - aa, MILL_R, b.x);
  float spar = (1.0 - smoothstep(1.3 - aa * 0.5, 1.3 + aa * 0.5, abs(b.y))) * tip;
  float sail = smoothstep(14.0 - aa, 14.0, b.x) * tip * smoothstep(-aa * 0.5, aa * 0.5, b.y)
    * (1.0 - smoothstep(9.0 - aa * 0.5, 9.0 + aa * 0.5, b.y));
  float hub = 1.0 - smoothstep(4.0 - aa, 4.0 + aa, r);
  return max(max(spar, sail), hub);
}

float smallStars(vec2 q, float t, float px) {
  vec2 g = q * 34.0;
  vec2 id = floor(g);
  float h = hash12(id + 31.7);
  vec2 off = vec2(hash12(id + 3.1), hash12(id + 7.9)) - 0.5;
  float d = length(fract(g) - 0.5 - off * 0.7) / 34.0;
  float size = max(mix(0.0011, 0.0026, hash12(id + 5.3)), 0.8 * px);
  float tw = 0.6 + 0.4 * sin(t * mix(0.8, 2.6, h) + h * 61.0);
  return step(0.5, h) * tw * smoothstep(size + px, size - px * 0.5, d);
}

float brightStars(vec2 q, float t, float px) {
  vec2 g = q * 9.0;
  vec2 id = floor(g);
  float h = hash12(id + 91.3);
  if (h < 0.62) return 0.0;
  vec2 off = vec2(hash12(id + 13.1), hash12(id + 27.9)) - 0.5;
  vec2 d = (fract(g) - 0.5 - off * 0.6) / 9.0;
  float r = length(d);
  float size = max(0.0032, 1.2 * px);
  float core = smoothstep(size + px, size - px * 0.5, r);
  vec2 ad = abs(d);
  float glint = exp(-ad.x * 1100.0 - ad.y * 140.0) + exp(-ad.y * 1100.0 - ad.x * 140.0);
  float tw = 0.55 + 0.45 * sin(t * (0.6 + h * 1.8) + h * 40.0);
  return (core + glint * 0.55 + exp(-r * 260.0) * 0.25) * tw;
}

vec3 skyColor(vec2 q, float px, float t) {
  float top = uFrame.y / uFrame.z;
  float g = clamp((q.y - 0.12) / max(top - 0.12, 0.2), 0.0, 1.0);
  vec3 col = mix(uHorizon.rgb, uZenith.rgb, smoothstep(0.0, 1.0, pow(g, 0.75)));
  float night = 1.0 - uMidCol.w;

  vec2 dm = q - uMoon.xy;
  float md = length(dm);
  float moonDisc = smoothstep(uMoon.z + px, uMoon.z - px, md) * uMoon.w;

  float starAmount = uZenith.w * smoothstep(0.06, 0.4, g);
  if (starAmount > 0.01) {
    float s = smallStars(q, t, px) + brightStars(q, t, px);
    // The moon outshines the stars around it.
    s *= 1.0 - (1.0 - smoothstep(uMoon.z * 1.1, uMoon.z * 3.5, md)) * uMoon.w;
    col += vec3(1.0, 0.96, 0.88) * s * starAmount;
  }

  // Sun: a broad warm glow and a soft disc.
  vec2 ds = q - uSun.xy;
  float sd = length(ds);
  col += uSunCol.rgb * uSun.w * (0.3 * exp(-sd * 3.0) + 0.45 * exp(-sd * 14.0));
  float sunDisc = smoothstep(uSun.z + px, uSun.z - px, sd);
  col = mix(col, uSunCol.rgb * 1.08 + 0.04, sunDisc * uSun.w);

  // Moon: glow, mottled face and a shadow for its phase.
  col += uMoonCol.rgb * uMoon.w * night * 0.2 * exp(-md * 6.5);
  vec2 shadowAt = vec2(uMoonCol.w, 0.18 * uMoonCol.w) * uMoon.z;
  float shadow = smoothstep(uMoon.z * 0.97 + px, uMoon.z * 0.97 - px, length(dm - shadowAt));
  float crater = vnoise(dm / uMoon.z * 2.6 + 3.0);
  vec3 face = uMoonCol.rgb * (0.94 - 0.18 * crater);
  vec3 dark = col * 0.82 + uMoonCol.rgb * 0.035;
  col = mix(col, mix(face, dark, shadow), moonDisc);

#if CLOUDS
  float band = smoothstep(0.38, 0.6, g) * (1.0 - smoothstep(0.92, 1.05, g));
  if (band > 0.0) {
    float n = fbm(vec2(q.x * 1.3 + uDrift.x, q.y * 3.4));
    float cover = uSunCol.w;
    float c = smoothstep(0.64 - cover * 0.22, 0.76 - cover * 0.2, n) * band;
    vec3 litCloud = mix(vec3(1.0), uHorizon.rgb, 0.35);
    // At night the clouds are thinner and catch the moonlight.
    vec3 nightCloud = uFogCol.rgb * 0.45 + uZenith.rgb * 0.35 + uMoonCol.rgb * uMoon.w * 0.3 * exp(-md * 3.5);
    col = mix(col, mix(nightCloud, litCloud, uMidCol.w), c * mix(0.5, 0.8, uMidCol.w));
  }
#endif
  return col;
}

float hillsHeight(float x) {
  return 0.33 + 0.032 * sin(x * 4.3 + 1.3) + 0.018 * sin(x * 9.7 + 0.4) + 0.008 * sin(x * 21.0 + 2.2);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float S = uFrame.z;
  float t = uFrame.w;
  vec2 uv = frag / uFrame.xy;
  vec2 q = vec2((frag.x - 0.5 * uFrame.x) / S, frag.y / S);
  float px = 1.0 / S;

  // Every texture read happens up front, outside any branch.
  vec2 uvFar = layerUV(q, uParallax.y);
  vec2 uvMid = layerUV(q, uParallax.z);
  vec2 uvNear = layerUV(q, uParallax.w);
  float cFar = texture2D(uSil, uvFar).r;
  float cMid = texture2D(uSil, uvMid).g;
  float cNear = texture2D(uSil, uvNear).b;
  float lFar = texture2D(uLit, uvFar).r;
  float lMid = texture2D(uLit, uvMid).g;
  float lNear = texture2D(uLit, uvNear).b;
#if GLOW
  float gFar = texture2D(uLit, uvFar, 3.5).r;
  float gMid = texture2D(uLit, uvMid, 3.5).g;
  float gNear = texture2D(uLit, uvNear, 3.5).b;
#endif

  float lights = uHorizon.w;
  float mist = uFarCol.w;
  vec3 col = vec3(0.0);
  float T = 1.0; // how much of what lies behind still shows through

  if (q.y < 0.52) {
    float shade = 0.9 + 0.1 * smoothstep(0.0, 0.3, q.y);

    // Ground mist, in front of everything.
    float m = min(0.85, mistBand(q, 0.0, 0.04, 0.13, uParallax.w * 1.3, uDrift.w, 3.0) * mist * 0.5);
    col += T * m * uFogCol.rgb;
    T *= 1.0 - m;

    // The meadow.
#if GLOW
    col += T * uWinCol.rgb * gNear * lights * 1.6;
#endif
    col += T * cNear * withWindows(uNearCol.rgb * shade, lNear, lights, t);
    T *= 1.0 - cNear;

    if (T > 0.004) {
      m = min(0.85, mistBand(q, 0.11, 0.165, 0.26, uParallax.z * 1.2, uDrift.z, 2.6) * mist * 0.55);
      col += T * m * uFogCol.rgb;
      T *= 1.0 - m;

      // The village, with the windmill's sails turning.
      cMid = max(cMid, sails(uvMid, px));
#if GLOW
      col += T * uWinCol.rgb * gMid * lights * 1.6;
#endif
      col += T * cMid * withWindows(uMidCol.rgb * shade, lMid, lights, t);
      T *= 1.0 - cMid;
    }

    if (T > 0.004) {
      m = min(0.85, mistBand(q, 0.16, 0.235, 0.36, uParallax.y, uDrift.y, 2.2) * mist * 0.6);
      col += T * m * uFogCol.rgb;
      T *= 1.0 - m;

      // The far ridge.
#if GLOW
      col += T * uWinCol.rgb * gFar * lights * 1.9;
#endif
      col += T * cFar * withWindows(uFarCol.rgb, lFar, lights, t);
      T *= 1.0 - cFar;
    }

    if (T > 0.004) {
      // Distant hills, hazy with the horizon's colour.
      float hh = hillsHeight(q.x + uParallax.x);
      float cHills = smoothstep(hh + px, hh - px, q.y);
      col += T * cHills * mix(uFarCol.rgb, uHorizon.rgb, 0.42);
      T *= 1.0 - cHills;
    }
  }

  if (T > 0.004) col += T * skyColor(q, px, t);

  // Vignette and film grain.
  vec2 vc = uv - 0.5;
  col *= 1.0 - uFogCol.w * smoothstep(0.25, 0.85, length(vc * vec2(1.1, 1.35)));
  col += (hash12(frag + fract(t * 7.13) * 431.0) - 0.5) * uNearCol.w;

  // Effect pulses: a red flush from the edges, or a soft glow from the centre.
  if (uPulse.w > 0.002 || uRing.y > 0.002) {
    float aspect = uFrame.x / uFrame.y;
    float pd = length(vc * vec2(aspect, 1.0)) / (0.5 * length(vec2(aspect, 1.0)));
    float w = uPulse.w * mix(smoothstep(0.1, 1.0, pd), 1.0 - smoothstep(0.0, 0.9, pd), uRing.z);
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, uPulse.rgb * (0.3 + 0.9 * l), w * (1.0 - uRing.z) * 0.8);
    col += uPulse.rgb * w * uRing.z * 0.5;
    float ringD = (pd - uRing.x) * 7.0;
    col += uPulse.rgb * uRing.y * exp(-ringD * ringD) * 0.45;
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export function fragmentShader(features: ShaderFeatures, windmill: Windmill): string {
  return `precision highp float;
#define OCTAVES ${Math.max(1, Math.round(features.octaves))}
#define CLOUDS ${features.clouds ? 1 : 0}
#define GLOW ${features.glow ? 1 : 0}
#define MILL_X ${windmill.x.toFixed(1)}
#define MILL_Y ${windmill.y.toFixed(1)}
#define MILL_R ${windmill.radius.toFixed(1)}
${BODY}`;
}
