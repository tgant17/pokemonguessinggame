# Who's that Pokémon?

Pokémon Guessing Game is a fast-paced party quiz built with Next.js. Each round shows a hidden sprite; players must pick the correct Pokémon before the 8-second timer runs out. You can run solo, or enable the multi-team mode (Red, Blue, Yellow, Green) to pass the device around and keep a running score.

## Features

- Loads Pokémon names from a local cache (`public/pokemon-list.json`) so autocomplete works offline.
- Prefetches all sprites for the round up front, preventing mid-round loading hitches.
- Silhouette effect while guessing, then reveals the sprite after your answer.
- Adjustable game length (5/10/25 rounds) and persistent per-team scoreboards.
- Mobile-friendly UI with dynamic theming based on the active team.

## Getting started

```bash
cd pokemonguessinggame
npm install
npm run fetch:pokemon   # refresh the cached name list (optional but recommended)
npm run dev
```

Open http://localhost:3000 in your browser. Edit files under `src/app/` and the page will hot reload.

## Deployment (Vercel)

1. Make sure `public/pokemon-list.json` is up to date (`npm run fetch:pokemon`).
2. Push the project to GitHub/GitLab.
3. In Vercel:
   - Import the repo.
   - Set **Root Directory** to `pokemonguessinggame`.
   - Build Command: `npm run fetch:pokemon && npm run build`.
   - Output Directory: `.next`.
4. Deploy.



## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run fetch:pokemon` | Refresh cached Pokémon list |
