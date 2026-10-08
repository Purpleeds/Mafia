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

## Socket events

All client → server events are `(payload, ack)`; the ack receives `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
Your identity always comes from the session the socket joined with, never from the payload.

| Client → server | Payload | Notes |
| --- | --- | --- |
| `room:create` | `{ name }` | returns `{ roomCode, playerId, sessionToken }`; you are the host |
| `room:join` | `{ roomCode, name }` | lobby only |
| `room:resume` | `{ roomCode, sessionToken }` | rejoin after a refresh; store the token in localStorage |
| `room:leave` | `{}` | removes you from the lobby; mid-game it counts as a disconnect |
| `lobby:updateSettings` | `SettingsPatch` | host only |
| `game:start` / `game:restart` | `{}` | host only |
| `game:ackRole` | `{}` | "I've seen my role" |
| `game:nightAction` | `{ targetId, secondTargetId? }` | Mafia/Doctor/Detective/Bodyguard/Cupid |
| `game:vote` | `{ targetId }` | a player id or `"skip"` |
| `chat:send` | `{ channel, text }` | `public`, `mafia` (living Mafia, at night) or `graveyard` (eliminated players) |
| `time:sync` | `{ clientSentAt }` | returns `{ clientSentAt, serverNow }` |

| Server → client | Payload |
| --- | --- |
| `server:hello` | `{ serverNow }` on connect |
| `game:state` | `{ version, serverNow, view }`: your personalised `GameView`; ignore versions older than the one you have |
| `chat:message` / `chat:history` | one message / the history you're allowed to see (sent when you join or resume) |
| `room:removed` | you left, were dropped from the lobby, or the room closed |
| `session:replaced` | the same session was opened in another tab; this socket is closed |
| `server:error` | the error for an event sent without an ack |

Countdowns: `view.phaseEndsAt - serverNow` is the time left when the update was sent; count down from there with the local
monotonic clock. The client clock is never used.

## Render

Single Web Service, runtime `node`:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

The server reads `PORT`. Behind Render's proxy it reads the client IP from `X-Forwarded-For` (`TRUST_PROXY_HOPS`, default 1 when
`RENDER=true`). Rooms live in memory, so a deploy or restart ends running games. Logs are one line per event
(`INFO room.created room=ABCD ...`).
