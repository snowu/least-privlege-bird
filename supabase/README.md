# Supabase backend — anti-cheat score validation

The leaderboard is **server-authoritative**. The browser cannot be trusted (it's the
attacker's machine), so the score a client claims is never stored as-is. Instead the
client sends the *inputs* of the run, and an Edge Function re-simulates the game on
Supabase's servers and stores only a score it independently reproduces.

## How it works

```
BROWSER (untrusted)                      SUPABASE (trusted)
  game.js records { seed, flapTicks }      submit-score/index.ts
  on death → POST  ──────────────────────► validates input
  { name, token, seed,                     replays via sim.ts
    flapTicks, claimedScore }              if recomputed === claimed:
                                             token-hash verify
                                             max-only write (service role)
```

- `sim.ts` is a **byte-for-byte mirror** of the physics in `game.js` (same constants,
  same `mulberry32` PRNG, same fixed-timestep step loop, same input-before-physics
  ordering). A run is fully reproducible from `{ seed, flapTicks }`.
- The function **ignores `claimedScore` as truth** — it recomputes the score from the
  inputs. The only way to land score N is to submit inputs that genuinely survive N
  pipes. Forging a number is impossible; the number is thrown away and recomputed.
- Writes use the **service-role key** (server-only, never shipped to the browser),
  which bypasses RLS. Combined with the RLS lock (anon cannot write `scores`
  directly), the Edge Function is the *only* path to a write.

## Security model — the four locks

1. **RLS**: `anon` has no INSERT/UPDATE/DELETE on `scores` → can't skip the function.
2. **Server-side code**: the function runs on Supabase, not the browser → attacker
   can't alter its logic (reading the client's `sim.ts` copy doesn't help — knowing
   the rules ≠ being able to fake inputs).
3. **Replay**: claimed score is recomputed from inputs → a forged number is rejected.
4. **Service-role secrecy**: the write key lives only in the function's env → an
   attacker can't impersonate the function.

Remaining caveat: a bot that programmatically plays well produces *valid* inputs — that
is "being good at the game," not forging, and defending against it (behavioral
heuristics) is out of scope for this project.

## Files

| File | Purpose |
|------|---------|
| `config.toml` | Project ref + `submit-score` declared with `verify_jwt = false` (the game calls it with the publishable anon key; the function does its own auth). |
| `functions/submit-score/index.ts` | HTTP handler: validate → replay → token verify → write. |
| `functions/submit-score/sim.ts` | Authoritative physics. **Keep in lockstep with `game.js`** — any change to constants/physics/PRNG must be mirrored here or honest runs will be rejected. |

## Deploy

```bash
npx supabase login
npx supabase link --project-ref yozllinwvvprtguinflm
npx supabase functions deploy submit-score
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into deployed
functions — no manual secret setup needed.

### After deploying: drop the legacy RPC

The old `submit_score` RPC trusted the client's score number and is now an unused
**bypass** (it writes via `SECURITY DEFINER`, skipping both RLS and the replay check).
Remove it so the Edge Function is the sole write path:

```sql
drop function if exists public.submit_score(text, text, integer);
```

## Local development

Edge Functions need [Deno]; the Supabase CLI bundles a local runtime.

```bash
npx supabase functions serve submit-score   # serves at http://localhost:54321/functions/v1/submit-score
```

In the game, enable real DB calls locally (kept off by default so a laptop never
pollutes prod) — in the devtools console:

```js
localStorage.lpb_live = '1'   // reload → real Supabase reads/writes
delete localStorage.lpb_live  // back to offline-local
```

`DEV_MODE` (skip captcha/SSO friction) and `LIVE_DB` (talk to Supabase) are independent,
so you can test gameplay and auth/save logic separately.

## Plan

Edge Functions are included in the **free tier** (500K invocations/month, 2s wall-clock
limit per call). A replay runs in milliseconds, so this fits comfortably.

## Parity guarantee

`sim.ts` was verified to produce identical scores to `game.js` across multiple seeds,
and to reject forged scores, tampered inputs, and malformed payloads. **If you ever
change game physics, re-verify parity** — divergence silently rejects legitimate runs.
