# Least Privilege Bird

Flappy Bird, wrapped in AWS IAM bureaucracy. Before you may flap, you must survive
fake SSO, an IAM policy-evaluation review, educational captchas (real AWS knowledge
checks), and STS token generation. The friction *is* the feature.

Built for an AWS workshop, now a (cursed) internal fun tool. Vanilla JS, no build step.

![UI](img/ui.png)

## Stack

- **Frontend** — vanilla JS + HTML5 Canvas, deployed on GitHub Pages. No bundler.
- **Backend** — Supabase (Postgres + Edge Functions) for the leaderboard.

## Layout

- `index.html` — entry point, sets the `DEV_MODE` / `LIVE_DB` flags.
- `game.js` — the game: fixed-timestep loop, seeded PRNG, records run inputs.
- `clave.js` — the IAM/SSO/captcha satire layer ("Clave" auth theater).
- `scores.js` — token storage + Supabase calls (leaderboard read, score submit).
- `supabase/` — Edge Function (`submit-score`), authoritative sim, deploy + architecture docs.
- `assets/` — sprites and audio. `img/` — screenshots.

## Leaderboard is server-authoritative

Scores are **never trusted from the client**. On death the browser sends the run's
*inputs* `{seed, flapTicks}`; a Supabase Edge Function re-simulates the game server-side
and stores only a score it independently reproduces. A forged number is rejected.

See [`supabase/ARCHITECTURE.md`](supabase/ARCHITECTURE.md) for the full flow + diagrams,
and [`supabase/README.md`](supabase/README.md) to deploy.

## Local dev

Static files — no build, no deps. Open `index.html` (or serve it however you like).
Two flags in `index.html`: `DEV_MODE` skips the auth/captcha friction, `LIVE_DB` gates
real Supabase calls; both auto-handle localhost vs prod.
