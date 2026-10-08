import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAudio } from "./audio/engine";
import { loadDevConfig } from "./lib/dev";
import { watchSpeechSettings } from "./narrator/speech";
import { initConnection } from "./state/controller";
import "./styles.css";
import "./game.css";
import "./theme.css";
import "./fx/backdrop.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

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
