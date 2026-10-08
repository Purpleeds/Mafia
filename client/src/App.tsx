import { useEffect } from "react";
import type { ContentMode, Phase, Winner } from "@mafia/shared";
import { WakingScreen } from "./components/WakingScreen";
import { DebugPanel } from "./components/DevTools";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { ReplacedOverlay } from "./components/ReplacedOverlay";
import { Toasts } from "./components/Toasts";
import { Backdrop } from "./fx/Backdrop";
import { setScene } from "./fx/scene";
import { canonicalizeLocation, parseRoute, usePathname } from "./lib/router";
import { HowToPlayScreen, RoleGuideScreen } from "./screens/HelpScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { RoomRoute } from "./screens/RoomRoute";
import { openRoom } from "./state/controller";
import { useAppState } from "./state/store";

export function App() {
  const pathname = usePathname();
  const route = parseRoute(pathname);
  const roomCode = route.name === "room" ? route.code : null;

  useEffect(() => {
    canonicalizeLocation();
  }, [pathname]);

  useEffect(() => {
    if (roomCode) openRoom(roomCode);
  }, [roomCode]);

  const view = useAppState((s) => (roomCode && s.game && s.game.payload.room.code === roomCode ? s.game.payload.view : null));
  const mode: ContentMode = view?.settings.contentMode ?? "safe";
  const phase: Phase | null = view?.phase ?? null;
  const winner: Winner | null = view?.winner ?? null;

  // The stylesheet and the background both follow the room's mode and phase.
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    setScene({ mode, phase, winner });
  }, [mode, phase, winner]);

  return (
    <>
      <Backdrop />
      <ConnectionBanner />
      <main className="app-main">
        {roomCode ? (
          <RoomRoute key={roomCode} code={roomCode} />
        ) : route.name === "how-to-play" ? (
          <HowToPlayScreen />
        ) : route.name === "role-guide" ? (
          <RoleGuideScreen />
        ) : (
          <HomeScreen />
        )}
      </main>
      <WakingScreen />
      <DebugPanel />
      <Toasts />
      <ReplacedOverlay />
    </>
  );
}
