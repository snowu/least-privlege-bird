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
  { name, token, seed,                     replays via physics-core
    flapTicks, claimedScore }              if recomputed === claimed:
                                             token-hash verify
                                             max-only write (service role)
```

- Both the browser game and this function import the **same** physics module,
  `src/physics-core.ts` (constants, `mulberry32` PRNG, fixed-timestep step loop,
  input-before-physics ordering). There is no second copy to drift — `game.ts` and
  `submit-score` run identical code. A run is fully reproducible from `{ seed, flapTicks }`.
- The function **ignores `claimedScore` as truth** — it recomputes the score from the
  inputs. The only way to land score N is to submit inputs that genuinely survive N
  pipes. Forging a number is impossible; the number is thrown away and recomputed.
- Writes use the **service-role key** (server-only, never shipped to the browser),
  which bypasses RLS. Combined with the RLS lock (anon cannot write `scores`
  directly), the Edge Function is the *only* path to a write.

## Security model — the four locks

1. **RLS**: `anon` has no INSERT/UPDATE/DELETE on `scores` → can't skip the function.
2. **Server-side code**: the function runs on Supabase, not the browser → attacker
   can't alter its logic (the physics core is shipped to the browser too, but knowing
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
| `functions/submit-score/index.ts` | HTTP handler: validate → replay → token verify → write. Imports `../../../src/physics-core.ts` (bundled & uploaded by the deploy). |
| `src/physics-core.ts` (repo root) | **The** authoritative physics, shared by browser + server. Single source of truth — no mirror to keep in sync. Guarded by `scripts/test-replay.ts` golden replays (run on pre-commit when physics changes). |
| `functions/recover-account/index.ts` | Token-only recovery: hashes a raw token (service role) and returns its account name. Lets `token_hash` stay hidden from anon. |

## Deploy

```bash
npx supabase login
npx supabase link --project-ref yozllinwvvprtguinflm
npx supabase functions deploy submit-score
npx supabase functions deploy recover-account
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into deployed
functions — no manual secret setup needed.

### Hide `token_hash` from anon (least privilege)

The leaderboard read only needs `name` and `score`. Token recovery goes through the
`recover-account` function (service role), so `anon` never needs to read `token_hash`.
Lock the column down — revoke the table-wide SELECT and re-grant only what the
leaderboard reads:

```sql
revoke select on public.scores from anon;
grant  select (name, score) on public.scores to anon;
```

After this, `GET /scores?select=name,token_hash` returns a column-permission error for
anon, while `select=name,score` still works. The recover function is unaffected (it uses
the service role).

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

The browser game and the server replay import the **same** `src/physics-core.ts`, so
parity is structural — there's no second copy to diverge. `scripts/test-replay.ts`
freezes known `{ seed, flapTicks } → score` runs and fails the pre-commit if the core's
behaviour drifts. **If you change game physics, regenerate the goldens deliberately
(`scripts/gen-goldens.ts`) and review the score diff**, then redeploy submit-score so the
server runs the new core.
