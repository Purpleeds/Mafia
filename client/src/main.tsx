import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAudio } from "./audio/engine";
import { initA11y } from "./lib/a11y";
import { loadDevConfig } from "./lib/dev";
import { watchSpeechSettings } from "./narrator/speech";
import { initConnection } from "./state/controller";
import "./styles.css";
import "./game.css";
import "./theme.css";
import "./fx/backdrop.css";
import "./features.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Text size and reduce motion apply before anything is drawn.
initA11y();

async function start(): Promise<void> {
  // Ask the server whether this is a development run (it decides where seats are remembered) before anything reads them.
  await loadDevConfig();
  initConnection();
  // Sound starts on the first tap (browsers insist), and the narrator's voice follows the settings.
  initAudio();
  watchSpeechSettings();
  createRoot(root as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();

// The service worker only serves an offline page (see public/sw.js). Not in the Vite dev server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
