# Mafia

Online multiplayer Mafia / Werewolf with an automatic narrator. TypeScript monorepo:

- `shared/` – the Socket.IO event contract (`events.ts`) and game vocabulary/view types (`game.ts`), compiled to `dist/` as `@mafia/shared`
- `server/` – Node + Express + Socket.IO; also serves the built client
  - `game/` – the pure rules engine: `applyAction(state, action, { now, rng })` → new state; `getGameView(state, playerId)` → what one player may know
  - `rooms/` – `RoomService` (runs the engine per room, timers, chat, clean-up) over a `RoomStore` interface (`MemoryRoomStore` today)
  - `socket/` – event handlers, payload validation, rate limiting, reconnect handling
- `client/` – Vite + React

The server is the single source of truth. Each player is sent only their own view of the game (`game:state`) through a private
Socket.IO room, so hidden information (other players' roles, night choices, detective results, Mafia chat) never reaches a browser
that shouldn't have it.

## Run locally

```bash
npm install
npm run dev      # server on :3000, Vite dev server on :5173 (open this one)
npm test         # engine, room service and socket integration tests
```

Production-style, on one port:

```bash
npm install
npm run build
npm start        # http://localhost:3000
```

## Rooms and joining

- Room codes are 4 uppercase letters without look-alikes (no O, I, L, 0 or 1), checked for collisions and rude words.
  Hosts may pick a custom code of 4–8 letters/numbers instead (rude and reserved words are refused).
- Every room has a join link, `https://<site>/ABCD`, which opens straight on the nickname screen; the lobby shows it as a QR code.
- Nicknames: unique in the room, up to 16 characters, letters/numbers/spaces/basic punctuation, no rude words. Plus an avatar colour and icon.
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
