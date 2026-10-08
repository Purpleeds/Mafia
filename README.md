# Mafia

Online multiplayer Mafia / Werewolf with an automatic narrator. TypeScript monorepo:

- `shared/` – the Socket.IO event contract (`events.ts`) and game vocabulary/view types (`game.ts`), compiled to `dist/` as `@mafia/shared`
- `server/` – Node + Express + Socket.IO; also serves the built client
  - `game/` – the pure rules engine: `applyAction(state, action, { now, rng })` → new state; `getGameView(state, playerId)` → what one player may know
  - `rooms/` – `RoomService` (runs the engine per room, timers, chat, clean-up) over a `RoomStore` interface (`MemoryRoomStore` today)
  - `socket/` – event handlers, payload validation, rate limiting, reconnect handling
- `client/` – Vite + React
  - `art/` – all the artwork, drawn in code as SVG: role cards, icons, the logo and the players' characters
  - `fx/` – the animated background (raw WebGL fragment shader) and its static fallback

The server is the single source of truth. Each player is sent only their own view of the game (`game:state`) through a private
Socket.IO room, so hidden information (other players' roles, night choices, detective results, Mafia chat) never reaches a browser
that shouldn't have it.

## Run locally

```bash
npm install
npm run dev      # server on :3000, Vite dev server on :5173 (open this one)
npm test         # engine, room service and socket integration tests, then the client's art and effects tests
```

Production-style, on one port:

```bash
npm install
npm run build
npm start        # http://localhost:3000
```

## Screens (client)

Home (create or join; the code box jumps into the room as soon as it finds one) → Lobby (big code, link, QR code, Safe/Normal badge,
host settings) → Role reveal (tap-to-flip 3D card; it hides again when the page loses focus) → Night → Morning news (typewriter
narrator) → Day (player grid, chat, countdown) → Voting (tap to vote, live counts) → Vote results → Game over (roles, timeline,
Play Again). "How to play" and the role guide are pages (`/how-to-play`, `/role-guide`) and a help dialog inside the game.
The mode badge, room code and connection status are in the top bar on every in-game screen.

At night every player sees the same screen: players with a night power use it for real, everyone else gets a look-alike grid that
sends nothing to the server, so a glance at someone's phone tells you nothing about their role. The host can hide *who* voted for
whom (counts stay visible) with the "Show who voted for whom" setting.

## Look and feel

All art is original and made in code: no image files, no icon fonts, no emoji.

- **Background** (`client/src/fx`): one full-screen WebGL 1 fragment shader draws a cartoon village in a valley: sky, sun and
  moon crossing the sky, twinkling stars, drifting clouds, mist between the hills, the village and the meadow (noise), window
  lights that come on at night, a turning windmill, vignette and film grain. The village's three depth layers are SVG paths
  generated in `village.ts`; for WebGL they're drawn once into two textures (one colour channel per layer) so the mist can sit
  between them and the layers shift for parallax.
- **Day and night follow the game**: lobby afternoon, dusk at the role reveal, midnight at night, dawn for the morning news, a
  sunset for the vote results. Changes animate the sun or moon across the sky (`timeOfDay.ts`). Safe Mode is bright storybook;
  Normal Mode is darker and noir, with a crescent moon, heavier mist, more grain and a stronger vignette (`palette.ts`).
- **Moments**: an elimination is a soft puff of smoke with the player's card floating away (Safe) or a red pulse and shock ring
  (Normal); a Doctor's save is a soft green glow in both modes. The background joins in through `emitFx`. The host can turn
  off save announcements ("Announce the Doctor's saves"); the morning news never says who was saved, only the Doctor learns that.
- **Performance**: Auto picks a tier from a quick probe (WebGL and high-precision support, software rendering, Data Saver, GPU,
  memory, phone or computer): *high* (all effects, ≤ 2.2 MP per frame), *standard* (no clouds, ≤ 1 MP; phones), *lite*
  (simpler mist, no glow, smaller textures, ≤ 0.45 MP) or *static* (a CSS + SVG picture, no WebGL). It renders about 30 fps
  when the scene is calm and 60 during transitions, stops completely while the tab is hidden, and steps down a tier (remembered
  on the device) if frames come in slow. Reduced-motion users get the scene redrawn only when the phase changes. Players can pick
  Auto / Full / Lite / Off under Display in the help dialog or on the How to play page; `?fx=full|lite|off` forces one for a
  page load (handy for testing). `window.__mafiaFx` shows the current tier and frame rate.
- **Cards and animation**: role cards are SVG (each role has its own icon, colour and border ornaments) with a 3D flip; votes
  drop onto player cards; eliminated players fade; the game-over roles flip in. Fonts: Fraunces (titles; rounder in Safe
  Mode via its SOFT axis) and Nunito (UI), from Google Fonts.

## Rooms and joining

- Room codes are 4 uppercase letters without look-alikes (no O, I, L, 0 or 1), checked for collisions and rude words.
  Hosts may pick a custom code of 4–8 letters/numbers instead (rude and reserved words are refused).
- Every room has a join link, `https://<site>/ABCD`, which opens straight on the nickname screen; the lobby shows it as a QR code.
- Nicknames: unique in the room, up to 16 characters, letters/numbers/spaces/basic punctuation, no rude words. Plus an avatar:
  a colour and a seed (8 letters/digits) that always draws the same little character (face, hair, hat, extras).
- Optional room password (stored as a salted scrypt hash). The host can set or remove it in the lobby.
- People joining after the game has started become spectators: they watch, can chat with eliminated players, and become players
  at the next game.
- Reconnecting: the session token from create/join is kept in localStorage; after a refresh or a locked phone the client sends
  `room:resume` and is back in the same seat with the same role. A dropped player shows as "reconnecting" for 60 s before being
  marked away. Lobby players (and spectators) who stay away 2 more minutes are removed.
- Host controls: start, settings (including Safe/Normal mode), kick, hand over hosting, password. If the host goes away, hosting
  passes to the next player in join order.
- Rooms with nobody connected are deleted after 10 minutes; lobbies nobody touches for 30 minutes, games after 3 hours.

## Socket events

All client → server events are `(payload, ack)`; the ack receives `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
Your identity always comes from the session the socket joined with, never from the payload.

| Client → server | Payload | Notes |
| --- | --- | --- |
| `room:create` | `{ name, avatar, customCode?, password? }` | returns `SessionInfo`; you are the host |
| `room:peek` | `{ roomCode }` | what the join screen needs: password?, lobby or in game, player count |
| `room:join` | `{ roomCode, name, avatar, password? }` | a player in the lobby, a spectator once the game has started |
| `room:resume` | `{ roomCode, sessionToken }` | rejoin after a refresh or reconnect |
| `room:leave` | `{}` | removes you from the lobby; mid-game it counts as a disconnect |
| `player:updateProfile` | `{ name?, avatar? }` | lobby only |
| `host:updateSettings` | `SettingsPatch` | host only, lobby only |
| `host:start` / `host:restart` | `{}` | host only |
| `host:kick` / `host:transfer` | `{ playerId }` | host only |
| `host:setPassword` | `{ password }` | `null` removes it |
| `game:ackRole` | `{}` | "I've seen my role" |
| `game:nightAction` | `{ targetId, secondTargetId? }` | Mafia/Doctor/Detective/Bodyguard/Cupid |
| `game:vote` | `{ targetId }` | a player id or `"skip"` |
| `chat:send` | `{ channel, text }` | `public`, `mafia` (living Mafia, at night) or `graveyard` (eliminated players and spectators) |
| `time:sync` | `{ clientSentAt }` | returns `{ clientSentAt, serverNow }` |

| Server → client | Payload |
| --- | --- |
| `server:hello` | `{ serverNow }` on connect |
| `game:state` | `{ version, serverNow, room: { code, hasPassword }, view }`; sent only when something you can see changed |
| `chat:message` / `chat:history` | one message / the history you're allowed to see |
| `room:removed` | `{ reason: left | kicked | dropped | room_closed, message }` |
| `session:replaced` | the same session was opened in another tab; this socket is closed |
| `server:error` | the error for an event sent without an ack |

`version` counts only the updates sent to your seat; reset what you hold when you get a new `SessionInfo`.
Countdowns: `view.phaseEndsAt - serverNow` is the time left when the update was sent; count down from there with
`performance.now()`. The client clock is never used.

If the server refuses a connection (`connect_error` with message `RATE_LIMITED`), Socket.IO stops retrying; the client waits a
few seconds and calls `socket.connect()` again.

## Render

Single Web Service, runtime `node`:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

The server reads `PORT`. Behind Render's proxy it reads the client IP from `X-Forwarded-For` (`TRUST_PROXY_HOPS`, default 1 when
`RENDER=true`). Rooms live in memory, so a deploy or restart ends running games. Logs are one line per event
(`INFO room.created room=ABCD ...`).
