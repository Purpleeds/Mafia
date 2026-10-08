import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAudio } from "./audio/engine";
import { watchSpeechSettings } from "./narrator/speech";
import { initConnection } from "./state/controller";
import "./styles.css";
import "./game.css";
import "./theme.css";
import "./fx/backdrop.css";

initConnection();
// Sound starts on the first tap (browsers insist), and the narrator's voice follows the settings.
initAudio();
watchSpeechSettings();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
