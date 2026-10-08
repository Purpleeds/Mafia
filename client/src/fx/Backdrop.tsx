import { useEffect, useRef, useState } from "react";
import { StaticBackdrop } from "./StaticBackdrop";
import { FxEngine } from "./engine";
import { initFx, reportFailure, reportSlow, useFxState, type FxTier, type RenderTier } from "./quality";
import { subscribeFx, useScene, type FxEvent } from "./scene";

/**
 * The full-screen background behind the UI. The static version shows at once;
 * once the device has been probed, the WebGL scene starts and fades in over it.
 * Purely decorative, so it is hidden from screen readers.
 */
export function Backdrop() {
  const fx = useFxState();
  const scene = useScene();
  // The tier whose WebGL scene has finished fading in (the static one can go then).
  const [shownTier, setShownTier] = useState<FxTier | null>(null);

  useEffect(() => {
    // Probe after the first paint so it never holds up the page.
    const timer = window.setTimeout(initFx, 60);
    return () => window.clearTimeout(timer);
  }, []);

  const webgl = fx.tier !== "static";
  const staticVisible = !webgl || shownTier !== fx.tier;

  return (
    <div className="backdrop" aria-hidden="true">
      {staticVisible ? <StaticBackdrop scene={scene} /> : null}
      {webgl ? (
        <WebGLBackdrop
          key={fx.tier}
          tier={fx.tier as RenderTier}
          reducedMotion={fx.reducedMotion}
          allowSlow={fx.preference !== "auto"}
          watchSpeed={fx.preference === "auto"}
          onShown={setShownTier}
        />
      ) : null}
      {staticVisible ? <FlashOverlay /> : null}
    </div>
  );
}

interface WebGLBackdropProps {
  tier: RenderTier;
  reducedMotion: boolean;
  allowSlow: boolean;
  watchSpeed: boolean;
  onShown: (tier: FxTier) => void;
}

function WebGLBackdrop({ tier, reducedMotion, allowSlow, watchSpeed, onShown }: WebGLBackdropProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh canvas per engine: a disposed engine loses its context for good.
    const canvas = document.createElement("canvas");
    canvas.className = "backdrop-canvas";
    host.appendChild(canvas);
    let shownTimer: number | undefined;
    let engine: FxEngine | null = null;
    const fail = (error: unknown) => {
      console.warn("Animated background turned off:", error);
      reportFailure(tier);
    };
    try {
      engine = new FxEngine(canvas, {
        tier,
        reducedMotion,
        allowSlow,
        watchSpeed,
        onReady: () => {
          canvas.classList.add("is-ready");
          shownTimer = window.setTimeout(() => onShown(tier), 950);
        },
        onSlow: () => reportSlow(tier),
        onFailure: fail,
      });
    } catch (error) {
      fail(error);
    }
    return () => {
      window.clearTimeout(shownTimer);
      engine?.dispose();
      canvas.remove();
    };
  }, [tier, reducedMotion, allowSlow, watchSpeed, onShown]);

  return <div ref={hostRef} className="backdrop-gl" />;
}

/** Without WebGL, effect pulses become a CSS flash over the static scene. */
function FlashOverlay() {
  const [flash, setFlash] = useState<{ kind: string; key: number } | null>(null);
  useEffect(
    () =>
      subscribeFx((event: FxEvent) => {
        const kind = event.kind === "save" ? "save" : event.mode === "normal" ? "red" : "puff";
        setFlash({ kind, key: performance.now() });
      }),
    [],
  );
  if (!flash) return null;
  return <div key={flash.key} className={`fx-flash fx-flash-${flash.kind}`} onAnimationEnd={() => setFlash(null)} />;
}
