<div align="center">

<img src="assets/logo.svg" alt="Least Privilege Bird" width="120" height="120" />

# Least Privilege Bird

![Permissions](https://img.shields.io/badge/permissions-insufficient-red)
![Auth](https://img.shields.io/badge/auth-7%20factors-blueviolet)
![IAM Policy](https://img.shields.io/badge/IAM%20policy-explicit%20DENY-critical)
![Build](https://img.shields.io/badge/build-it%20works%20on%20my%20machine-yellow)
![Coverage](https://img.shields.io/badge/test%20coverage-vibes-ff69b4)
![Compliance](https://img.shields.io/badge/SOC%202-trust%20me%20bro-success)
![Latency](https://img.shields.io/badge/p99%20latency-a%20vibe-blue)
![Tickets](https://img.shields.io/badge/jira%20tickets-closed%20wontfix-lightgrey)
![Captcha](https://img.shields.io/badge/captcha-are%20you%20a%20robot%3F-orange)
![Uptime](https://img.shields.io/badge/uptime-when%20github%20feels%20like%20it-9cf)
![STS Token](https://img.shields.io/badge/STS%20token-expired-red)
![Blast Radius](https://img.shields.io/badge/blast%20radius-acceptable-brightgreen)

Flappy Bird, wrapped in AWS IAM bureaucracy. Before you may flap, you must survive
fake SSO, an IAM policy-evaluation review, educational captchas (real AWS knowledge
checks), and STS token generation. The friction *is* the feature.

Built for an AWS workshop, now a (cursed) internal fun tool. Vanilla JS, no build step.

### [▶ PLAY NOW](https://snowu.github.io/least-privlege-bird/)

![UI](img/ui.png)

</div>

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

## Your account token

There are no passwords. When you first claim a name, the game generates a **secret token**
and shows it to you once — that token *is* your account. It's saved in your browser's
localStorage and proves you own the name when you submit a score.

**Save it somewhere.** You'll need it if your localStorage gets wiped (clearing browser
data, incognito) or you want to play under the same name on another machine.

To restore: hit **"🔑 Recover account with token"** on the home screen and paste it. Your
browser is bound to that name again and your high scores carry over. Lose the token with
no copy saved and the name is effectively locked — pick a new one.
