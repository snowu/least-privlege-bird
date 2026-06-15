# Leaderboard redesign: avatar icons + IAM privilege-tier badges

## Why

The high-score screen (`#scores-panel`) is currently a bare `<ol>` of
`"name: score"` lines in a small (max-height 220px) box — flagged as "scuffed"
in `ideas.md`. This redesign gives it room to breathe, shows each player's
mascot avatar, and dresses up the top 3 with on-brand IAM-satire badges.

## Changes

### 1. DB: `avatar` column on `scores`
New migration `supabase/migrations/<timestamp>_add_avatar_to_scores.sql`:

```sql
alter table public.scores add column if not exists avatar text;
grant select (name, score, avatar) on public.scores to anon;
```

Nullable, no backfill — existing rows stay `NULL`. The anon grant needs
extending to include `avatar` (currently scoped to `name, score` per the
README's least-privilege grant).

**Applying it**: I'll generate the migration file via
`npx supabase migration new add_avatar_to_scores`, but since `db push`
needs the DB password, you'll run the SQL above in the Supabase SQL editor
(same pattern as the existing RLS/grant changes documented in
`supabase/README.md`).

### 2. Shared avatar key list
New `src/avatars-meta.ts`:

```ts
export const AVATAR_KEYS = [
  'bird','penguin','monkey','rocket','bee','dragon','wizard','airplane','robot','horse',
] as const;
```

Imported by `src/game.ts` (THEMES keys already match this list — game.ts can
derive from it or just reference it for the picker) and by
`supabase/functions/submit-score/index.ts` for whitelist validation. Mirrors
how `physics-core.ts` is already shared between browser and edge function.

### 3. `submit-score` edge function
- Accept optional `avatar?: string` in the request body.
- If `avatar` is present and in `AVATAR_KEYS`, include it in the insert/update
  payload; otherwise omit it (don't fail the request — cosmetic field only,
  never affects the replay/score path).
- New player insert: `{ name, token_hash: h, score, avatar }` (avatar may be
  undefined → column stays NULL).
- Existing player: `avatar` should always reflect the *latest* submission,
  independent of whether the score improved. Current logic only `PATCH`es
  when `score > existing.score`; add a second branch so a non-improving
  submission still `PATCH`es `{ avatar }` alone (when `avatar` is present and
  valid) — score is left untouched in that case.

### 4. `src/scores.ts`
- `sbLoadScores`: `select=name,score,avatar&score=gt.0&order=score.desc`.
- `loadScores()`: return shape changes from `{ [name]: score }` to
  `{ name: string; score: number; avatar: string | null }[]`. Single
  consumer (`btn-scores` click handler in `game.ts`) — update it in the same
  change.
- `saveScore(name, score, replay)`: also read `localStorage.lpb_avatar` and
  pass it as `avatar` in the `sbSubmitScore` body.
- `ensurePlayerToken`'s registration call (score 0) also sends the current
  `lpb_avatar` so brand-new accounts get an avatar from row one.

### 5. Leaderboard UI (`index.html` + `game.ts` render logic)

**Layout**: `#scores-panel` grows from its current small box into a proper
leaderboard — wider (e.g. `min-width: 420px`, scales down on mobile per
existing `body.is-mobile` patterns), taller `max-height` (e.g. `60vh`),
internal scroll for the row list below a fixed header. Still centered in
`#overlay` — no overlay restructure.

**Row structure** — replace the `<ol><li>` with a `<div class="score-row">`
per entry:
```
[avatar img]  [rank/badge]  [name]  [score]
```
- Avatar img: `assets/<gfxStyle>/<key>.svg`, 28-32px, `image-rendering`
  switched per pixel/round exactly like `.avatar-opt img` already does.
- Avatar key resolution: `row.avatar` if set and in `AVATAR_KEYS` → else, if
  `row.name === currentPlayer`, `localStorage.lpb_avatar` → else `'penguin'`.

**Top-3 badges** (replace rank number for ranks 1-3), pure CSS/text/emoji,
no new image assets:
- #1 — gold pill, "AdministratorAccess"
- #2 — silver pill, "PowerUserAccess"
- #3 — bronze pill, "ReadOnlyAccess"
- Rank 4+ — plain `#N`.

**Current player highlight**: if `row.name === currentPlayer`, add a
highlight class (border/background tint), reusing the `.avatar-opt.selected`
gold-accent treatment for visual consistency.

**Styling**: all new CSS uses existing `--radius` / `--font-display` /
`--text-shadow` vars so it follows the pixel/round toggle automatically, same
as the rest of `#overlay`.

## Out of scope
- No per-score-snapshot avatar history — `avatar` is a single per-player
  column reflecting their latest submission, not tied to which run earned
  the high score.
- No retroactive backfill for existing rows (explicit decision — old rows
  show the fallback avatar).
- No changes to `physics-core.ts`, replay validation, or `npm test` goldens —
  `avatar` never enters the simulation.
- Row count stays uncapped with scroll (matches current behavior).
