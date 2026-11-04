# Who's that Pokémon?

Pokémon Guessing Game is a fast-paced party quiz built with Next.js. Each round shows a hidden sprite; players must pick the correct Pokémon before the timer runs out (8 seconds by default, selectable before each game). Play solo, or open an online room and play with friends on your own phones.

## Features

- Loads Pokémon names from a local cache (`public/pokemon-list.json`) so autocomplete works offline.
- Prefetches all sprites for the round up front, preventing mid-round loading hitches.
- Silhouette effect while guessing, then reveals the sprite after your answer.
- Adjustable game length (5/10/25 rounds), selectable timer (5/8/10/15 seconds).
- Hard mode: two silhouettes stacked on top of each other, pick both Pokémon from 6 options (10-second clock by default).
- Super Hard mode: three stacked silhouettes, pick all three from 8 options (15-second clock by default).
- Speed scoring: the clock is split into quarters. A correct answer in the first quarter earns 4 points, then 3, 2, and 1 in the final quarter. Wrong answers and time-outs score 0 and never take points away.
- In Hard and Super Hard, naming only some of the stacked Pokémon earns partial points.
- Mobile-friendly UI.
- Online multiplayer: create a room, share the link or 4-letter code, and everyone plays on their own phone at the same time with a live scoreboard.

## Getting started

```bash
cd pokemonguessinggame
npm install
npm run fetch:pokemon   # refresh the cached name list (optional but recommended)
npm run dev
```

Open http://localhost:3000 in your browser. Edit files under `src/` and the page will hot reload.

### Multiplayer in development

Multiplayer rooms run on a small Cloudflare Worker (`party/room.ts`). In a second terminal:

```bash
npm run dev:party       # wrangler dev on port 8787, no Cloudflare account needed
```

Then use **Create a room** on the home page. In development the site looks for the room server on port 8787 of whatever host served the page, so phones on the same Wi-Fi can join via your computer's IP address (for example http://192.168.1.20:3000/room/ABCD, with `npm run dev -- -H 0.0.0.0`).

## How multiplayer works

- Each room code gets its own Durable Object, a single server instance that runs the game for everyone in it.
- The host's browser picks the Pokémon (as in solo play) and sends the rounds to the server. From then on the server runs the clock and scores every answer with the same engine (`src/lib/engine.ts`) solo play uses, so all players see the same Pokémon and the same countdown.
- Each round's clock starts once everyone's sprites have loaded (or after 4 seconds). Answers stay hidden until everyone still connected has answered or time runs out, so a player who leaves doesn't hold up the round.
- Players are remembered by an id in the browser's local storage, so refreshing the page keeps your seat, score and any answer you'd locked in. People who join mid-game watch (and see each reveal) until the next game.
- The first player to join hosts and picks the settings. If they're away, the next connected player can start; between games the host can hand hosting to someone else with **Make host**.
- Players who have left are dropped from the list when the next game starts (or when the room is full and someone new joins). A room that everyone has left is wiped after 5 minutes.
- Rooms hold up to 12 players.

## Deployment (Vercel)

1. Make sure `public/pokemon-list.json` is up to date (`npm run fetch:pokemon`).
2. Push the project to GitHub/GitLab.
3. In Vercel:
   - Import the repo.
   - Set **Root Directory** to `pokemonguessinggame`.
   - Build Command: `npm run fetch:pokemon && npm run build`.
   - Output Directory: `.next`.
4. Deploy.

### Multiplayer server (Cloudflare)

The room server runs on Cloudflare Workers, which works on the free plan.

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. From this folder, run `npx wrangler login`, then `npm run deploy:party`. Wrangler prints the Worker's address, e.g. `https://pokemonguessinggame-rooms.<your-subdomain>.workers.dev`.
3. In Vercel, add the environment variable `NEXT_PUBLIC_PARTY_HOST` with that host (without `https://`), e.g. `pokemonguessinggame-rooms.<your-subdomain>.workers.dev`, then redeploy.

Until `NEXT_PUBLIC_PARTY_HOST` is set, production builds hide the multiplayer buttons and solo play works as before.


## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run fetch:pokemon` | Refresh cached Pokémon list |
| `npm run dev:party` | Run the multiplayer room server locally (port 8787) |
| `npm run deploy:party` | Deploy the room server to Cloudflare |
| `npm test` | Unit tests for the game rules, engine and rooms |
| `npm run typecheck` | Type-check the site and the room server |
