import { useEffect } from "react";
import type { ContentMode } from "@mafia/shared";
import { Background } from "./components/Background";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { ReplacedOverlay } from "./components/ReplacedOverlay";
import { Toasts } from "./components/Toasts";
import { canonicalizeLocation, parseRoute, usePathname } from "./lib/router";
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

  const mode = useAppState((s): ContentMode => {
    const game = s.game;
    return roomCode && game && game.payload.room.code === roomCode ? game.payload.view.settings.contentMode : "safe";
  });

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  return (
    <>
      <Background mode={mode} />
      <ConnectionBanner />
      <main className="app-main">{roomCode ? <RoomRoute key={roomCode} code={roomCode} /> : <HomeScreen />}</main>
      <Toasts />
      <ReplacedOverlay />
    </>
  );
}
