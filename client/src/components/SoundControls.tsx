import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../art/icons";
import { audio } from "../audio/engine";
import { setAudioSettings, useAudioSettings } from "../audio/settings";
import { speechSupported } from "../narrator/speech";

/**
 * Volume, mute and the other sound choices. Remembered on this device. Used
 * in a pop-over from the speaker button and, inline, in the Display settings.
 */
export function SoundPanel({ idPrefix }: { idPrefix: string }) {
  const settings = useAudioSettings();
  const percent = Math.round(settings.volume * 100);
  const silent = settings.muted || settings.volume === 0;

  return (
    <div className="sound-panel stack">
      <div className="sound-row">
        <button
          type="button"
          className={`btn${settings.muted ? "" : " btn-primary"} sound-mute`}
          aria-pressed={settings.muted}
          data-sound="none"
          onClick={() => setAudioSettings({ muted: !settings.muted })}
        >
          <Icon name={silent ? "volumeOff" : "volume"} />
          {settings.muted ? "Unmute" : "Mute"}
        </button>
        <span className="field-hint sound-state" role="status">
          {settings.muted ? "Sound is off" : `Volume ${percent}%`}
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-volume`}>Volume</label>
        <input
          id={`${idPrefix}-volume`}
          type="range"
          className="slider"
          min={0}
          max={100}
          step={1}
          value={percent}
          aria-valuetext={`${percent} percent`}
          onChange={(e) => {
            const volume = Number(e.target.value) / 100;
            setAudioSettings({ volume, muted: volume === 0 ? settings.muted : false });
          }}
          onPointerUp={() => audio.play("click")}
          onKeyUp={() => audio.play("click")}
        />
      </div>

      <label htmlFor={`${idPrefix}-ambience`} className="switch-row">
        <span className="switch-text">
          <span>Background sounds</span>
          <span className="field-hint">Birds and wind by day, crickets and owls at night.</span>
        </span>
        <input
          id={`${idPrefix}-ambience`}
          type="checkbox"
          role="switch"
          className="switch"
          checked={settings.ambience}
          onChange={(e) => setAudioSettings({ ambience: e.target.checked })}
        />
      </label>

      <label htmlFor={`${idPrefix}-effects`} className="switch-row">
        <span className="switch-text">
          <span>Sound effects</span>
          <span className="field-hint">Clicks, votes, the countdown and the music at the end of the game.</span>
        </span>
        <input
          id={`${idPrefix}-effects`}
          type="checkbox"
          role="switch"
          className="switch"
          checked={settings.effects}
          onChange={(e) => setAudioSettings({ effects: e.target.checked })}
        />
      </label>

      {speechSupported() ? (
        <label htmlFor={`${idPrefix}-voice`} className="switch-row">
          <span className="switch-text">
            <span>Read the narration aloud</span>
            <span className="field-hint">Uses your device's own voice. Off by default.</span>
          </span>
          <input
            id={`${idPrefix}-voice`}
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.voice}
            onChange={(e) => setAudioSettings({ voice: e.target.checked })}
          />
        </label>
      ) : null}
    </div>
  );
}

/** The speaker button: shows whether sound is on and opens the sound panel. */
export function SoundButton({ className }: { className?: string }) {
  const settings = useAudioSettings();
  const [open, setOpen] = useState(false);
  /** How far from the button's left edge the panel starts, once it has been fitted to the screen. */
  const [panelLeft, setPanelLeft] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const silent = settings.muted || settings.volume === 0;

  // The panel lines up with the button's right edge, but never runs off either side of the screen,
  // whatever else shares the row with the button (the help button, the room code...).
  useLayoutEffect(() => {
    if (!open) {
      setPanelLeft(null);
      return;
    }
    const fit = () => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      const margin = 8;
      const screenWidth = document.documentElement.clientWidth;
      const rootBox = root.getBoundingClientRect();
      const width = panel.offsetWidth;
      const left = Math.min(Math.max(rootBox.right - width, margin), Math.max(margin, screenWidth - margin - width));
      setPanelLeft(Math.round(left - rootBox.left));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`sound-button${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="btn btn-small btn-icon-square"
        aria-label={silent ? "Sound is off. Open sound settings" : "Sound settings"}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={silent ? "volumeOff" : "volume"} size={20} />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="sound-popover card"
          role="dialog"
          aria-label="Sound settings"
          style={panelLeft === null ? undefined : { left: panelLeft, right: "auto" }}
        >
          <SoundPanel idPrefix={`${panelId}-pop`} />
        </div>
      ) : null}
    </div>
  );
}
