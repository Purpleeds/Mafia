import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { AVATAR_ACCEPT, AVATAR_SIZE, avatarFileProblem, sniffImageType } from "@mafia/shared";
import { Icon } from "../art/icons";
import { MAX_ZOOM, MIN_ZOOM, clampCrop, initialCrop, sourceSquare, zoomAround, type CropState, type Size } from "../lib/crop";
import { ErrorText } from "./ErrorText";

const VIEWPORT = 240;

interface Loaded {
  url: string;
  image: HTMLImageElement;
  size: Size;
}

/** Checks a chosen file from its first bytes (not its name), then loads it. Returns a problem in words, or the picture. */
async function loadPicture(file: File): Promise<{ ok: true; loaded: Loaded } | { ok: false; message: string }> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const problem = avatarFileProblem(sniffImageType(head), file.size);
  if (problem) return { ok: false, message: problem };
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    return { ok: false, message: "That picture couldn't be read. Try another one." };
  }
  if (image.naturalWidth < 16 || image.naturalHeight < 16) {
    URL.revokeObjectURL(url);
    return { ok: false, message: "That picture is too small. Pick a bigger one." };
  }
  return { ok: true, loaded: { url, image, size: { width: image.naturalWidth, height: image.naturalHeight } } };
}

/** Draws the chosen square at 128x128. WebP where the browser can make it, PNG otherwise. */
function renderSquare(loaded: Loaded, crop: CropState): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const { x, y, size } = sourceSquare(loaded.size, VIEWPORT, crop);
  ctx.drawImage(loaded.image, x, y, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const webp = canvas.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

interface PhotoCropDialogProps {
  onDone: (dataUrl: string) => void;
  onClose: () => void;
}

/** Pick a PNG, JPG or WebP picture, then drag and zoom to choose the square that becomes your avatar. */
export function PhotoCropDialog({ onDone, onClose }: PhotoCropDialogProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; start: CropState } | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButton.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (loaded) URL.revokeObjectURL(loaded.url);
  }, [loaded]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await loadPicture(file);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLoaded(result.loaded);
    setCrop(initialCrop(result.loaded.size, VIEWPORT));
  };

  const update = (next: CropState) => {
    if (loaded) setCrop(clampCrop(loaded.size, VIEWPORT, next));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: crop };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    update({ ...d.start, offsetX: d.start.offsetX + e.clientX - d.x, offsetY: d.start.offsetY + e.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!loaded) return;
    const box = e.currentTarget.getBoundingClientRect();
    const at = e.clientX - box.left;
    setCrop(zoomAround(loaded.size, VIEWPORT, crop, crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), at));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!loaded) return;
    const step = e.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      update({ ...crop, offsetX: crop.offsetX + move[0], offsetY: crop.offsetY + move[1] });
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setCrop(zoomAround(loaded.size, VIEWPORT, crop, crop.zoom + 0.2));
    } else if (e.key === "-") {
      e.preventDefault();
      setCrop(zoomAround(loaded.size, VIEWPORT, crop, crop.zoom - 0.2));
    }
  };

  const save = () => {
    if (!loaded) return;
    const dataUrl = renderSquare(loaded, crop);
    if (!dataUrl) {
      setError("Your browser couldn't make the picture. Try another browser.");
      return;
    }
    onDone(dataUrl);
  };

  const scale = loaded ? (VIEWPORT / Math.min(loaded.size.width, loaded.size.height)) * crop.zoom : 1;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet photo-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <h2 id="photo-title" className="card-title">
            Your picture
          </h2>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {loaded ? (
          <div className="stack photo-crop">
            <div
              className="crop-viewport"
              style={{ width: VIEWPORT, height: VIEWPORT }}
              role="application"
              aria-label="Picture position. Drag, or use the arrow keys to move it and plus or minus to zoom."
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              onKeyDown={onKeyDown}
            >
              <img
                src={loaded.url}
                alt=""
                draggable={false}
                className="crop-image"
                style={{
                  width: loaded.size.width * scale,
                  height: loaded.size.height * scale,
                  transform: `translate(${crop.offsetX}px, ${crop.offsetY}px)`,
                }}
              />
              <span className="crop-ring" aria-hidden="true" />
            </div>
            <div className="field crop-zoom">
              <label htmlFor="photo-zoom">
                <Icon name="zoomIn" size={16} /> Zoom
              </label>
              <input
                id="photo-zoom"
                type="range"
                className="slider"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={crop.zoom}
                aria-valuetext={`${Math.round(crop.zoom * 100)} percent`}
                onChange={(e) => setCrop(zoomAround(loaded.size, VIEWPORT, crop, Number(e.target.value)))}
              />
            </div>
            <p className="field-hint">Drag to move it. Only the circle shows. It is shrunk to 128 by 128 pixels.</p>
            <div className="button-row">
              <button ref={firstButton} type="button" className="btn btn-primary" onClick={save}>
                <Icon name="check" />
                Use this picture
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()}>
                Pick another
              </button>
            </div>
          </div>
        ) : (
          <div className="stack center-block">
            <p className="field-hint">PNG, JPG or WebP, up to 2 MB. No GIFs or SVGs.</p>
            <button
              ref={firstButton}
              type="button"
              className="btn btn-primary btn-block"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Icon name="image" />
              {busy ? "Opening…" : "Choose a picture"}
            </button>
          </div>
        )}
        <ErrorText error={error} />
        <p className="field-hint">
          Your picture is checked and re-made by the server, and is only shown to people in your room. It is never
          saved on the server: it goes when you leave or the room closes.
        </p>
      </div>
    </div>
  );
}
