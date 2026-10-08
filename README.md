# Mafia

Online multiplayer Mafia / Werewolf with an automatic narrator. TypeScript monorepo:

- `shared/` – event names and data shapes used by both sides (`@mafia/shared`, compiled to `dist/`)
- `server/` – Node + Express + Socket.IO; also serves the built client
- `client/` – Vite + React

The server is the single source of truth: it never sends hidden information (such as other players' roles) to a client that shouldn't see it.

## Run locally

```bash
npm install
npm run dev      # server on :3000, Vite dev server on :5173 (open this one)
```

Production-style, on one port:

```bash
npm install
npm run build
npm start        # http://localhost:3000
```

## Render

Single Web Service, runtime `node`:

- Build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check path: `/healthz`

The server reads `PORT` from the environment.
