# Leaderboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the high-score screen into a proper leaderboard: avatar icons per row, IAM-privilege-tier badges for the top 3, and a current-player highlight, all driven by a new `avatar` column on `scores`.

**Architecture:** A new `avatar` column on `public.scores` stores the avatar/theme key that earned each player's current high score (nullable, no backfill). The `submit-score` edge function whitelists and stores it alongside `score`. The frontend (`scores.ts` → `game.ts` → `index.html`) reads it back and renders a richer leaderboard row, falling back to the current player's own picked avatar (or the penguin mascot) when `avatar` is `NULL`.

**Tech Stack:** TypeScript (esbuild bundle), Supabase Postgres + Edge Functions (Deno), vanilla DOM/CSS.

**Spec:** `docs/superpowers/specs/2026-06-15-leaderboard-redesign-design.md`

---

### Task 1: Shared avatar key whitelist

**Files:**
- Create: `src/avatars-meta.ts`

- [ ] **Step 1: Write `src/avatars-meta.ts`**

```ts
// ─── AVATAR KEYS ────────────────────────────────────────────────────────────
// The avatar/theme keys players can select (mirrors the non-hidden keys of
// THEMES in game.ts — 'wizard' is excluded, it's hidden/WIP). Shared between
// the browser bundle and the submit-score edge function so both validate
// against the same whitelist, same pattern as physics-core.ts.
export const AVATAR_KEYS = [
  'bird', 'penguin', 'monkey', 'rocket', 'bee', 'dragon', 'airplane', 'robot', 'horse',
] as const;

export type AvatarKey = typeof AVATAR_KEYS[number];
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (this file has no dependents yet).

- [ ] **Step 3: Commit**

```bash
git add src/avatars-meta.ts
git commit -m "Add shared avatar-key whitelist"
```

---

### Task 2: DB migration — `avatar` column on `scores`

**Files:**
- Create: `supabase/migrations/20260616120000_add_avatar_to_scores.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Add a nullable avatar column to scores: tracks which avatar/theme key the
-- player's current high score was achieved with. NULL for pre-existing rows
-- (no backfill — the leaderboard falls back to a default avatar for those).
alter table public.scores add column if not exists avatar text;

-- Leaderboard reads (anon) need the new column too — extends the existing
-- least-privilege grant from (name, score) to (name, score, avatar).
grant select (name, score, avatar) on public.scores to anon;
```

- [ ] **Step 2: Commit the migration file**

```bash
git add supabase/migrations/20260616120000_add_avatar_to_scores.sql
git commit -m "Add migration: avatar column on scores"
```

- [ ] **Step 3: USER ACTION REQUIRED — apply the migration to the live DB**

There's no `db push` access (needs the DB password). Run the SQL from Step 1 in
the Supabase SQL editor for project `yozllinwvvprtguinflm`
(https://supabase.com/dashboard/project/yozllinwvvprtguinflm/sql/new).

Verify it worked:
```sql
select avatar from public.scores limit 1;
```
Expected: runs without error (returns `null` or a value, not a "column does not
exist" error).

**This step must be done before Task 3's deploy** — the updated `submit-score`
function will send an `avatar` field on every write, and PostgREST rejects
writes that reference a column which doesn't exist yet.

---

### Task 3: `submit-score` edge function — accept, validate, store `avatar`

**Files:**
- Modify: `supabase/functions/submit-score/index.ts`

**Prerequisite:** Task 2 Step 3 (migration applied to the live DB) must be done
first, or registering new players will break after deploy.

- [ ] **Step 1: Add the import and extend the payload type**

In `supabase/functions/submit-score/index.ts`, change:

```ts
import { simulate } from "../../../src/physics-core.ts";
```

to:

```ts
import { simulate } from "../../../src/physics-core.ts";
import { AVATAR_KEYS } from "../../../src/avatars-meta.ts";
```

And change:

```ts
  let payload: {
    name?: string; token?: string; seed?: number;
    flapTicks?: number[]; claimedScore?: number;
  };
```

to:

```ts
  let payload: {
    name?: string; token?: string; seed?: number;
    flapTicks?: number[]; claimedScore?: number; avatar?: string;
  };
```

- [ ] **Step 2: Destructure `avatar` and compute the validated value**

Change:

```ts
  const { name, token, seed, flapTicks, claimedScore } = payload;
```

to:

```ts
  const { name, token, seed, flapTicks, claimedScore, avatar } = payload;

  // Cosmetic field — never affects the replay/score path. Unknown/missing
  // values are dropped silently rather than rejecting the whole request.
  const validAvatar = typeof avatar === "string" && (AVATAR_KEYS as readonly string[]).includes(avatar)
    ? avatar
    : undefined;
```

(Place this right after the existing destructuring line, before the "Input
validation" block.)

- [ ] **Step 3: Include `avatar` on the new-player insert**

Change:

```ts
  if (rows.length === 0) {
    // New player — register the row.
    const ins = await db(`/scores`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name, token_hash: h, score }),
    });
    if (!ins.ok) return json({ error: "db insert failed" }, 502);
    return json({ ok: true, score });
  }
```

to:

```ts
  if (rows.length === 0) {
    // New player — register the row.
    const ins = await db(`/scores`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name, token_hash: h, score, ...(validAvatar ? { avatar: validAvatar } : {}) }),
    });
    if (!ins.ok) return json({ error: "db insert failed" }, 502);
    return json({ ok: true, score });
  }
```

- [ ] **Step 4: Include `avatar` on the high-score update**

Change:

```ts
  const existing = rows[0];
  if (existing.token_hash !== h) return json({ error: "token mismatch" }, 403);
  if (score > existing.score) {
    const upd = await db(`/scores?name=eq.${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ score }),
    });
    if (!upd.ok) return json({ error: "db update failed" }, 502);
  }
  return json({ ok: true, score });
```

to:

```ts
  const existing = rows[0];
  if (existing.token_hash !== h) return json({ error: "token mismatch" }, 403);
  if (score > existing.score) {
    const upd = await db(`/scores?name=eq.${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ score, ...(validAvatar ? { avatar: validAvatar } : {}) }),
    });
    if (!upd.ok) return json({ error: "db update failed" }, 502);
  }
  return json({ ok: true, score });
```

Note: `avatar` is only written when `score > existing.score` — it tracks the
run that earned the current high score, not the player's latest pick (per
spec section 3).

- [ ] **Step 5: Deploy the function**

Run: `npx supabase functions deploy submit-score`
Expected: deploy succeeds (CLI prints a success message with the function URL).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/submit-score/index.ts
git commit -m "submit-score: accept and store validated avatar key"
```

---

### Task 4: `src/scores.ts` — load/save `avatar`

**Files:**
- Modify: `src/scores.ts:64-69` (`sbLoadScores`)
- Modify: `src/scores.ts:163-176` (`sbSubmitScore`)
- Modify: `src/scores.ts:236-248` (`ensurePlayerToken`)
- Modify: `src/scores.ts:250-273` (`loadScores`, `saveScore`)

- [ ] **Step 1: Add a local-avatar helper**

In `src/scores.ts`, right after the `_saveLocal` function (around line 18),
add:

```ts
// The player's currently-picked avatar/theme key (set by selectAvatar in
// game.ts). Sent with every score submission so the leaderboard can show
// which avatar earned the high score. Defaults to 'penguin' if unset.
function _currentAvatar() {
  try { return localStorage.getItem('lpb_avatar') || 'penguin'; } catch { return 'penguin'; }
}
```

- [ ] **Step 2: `sbLoadScores` selects `avatar`**

Change:

```ts
async function sbLoadScores() {
  if (!_sb) return null;
  // score=gt.0 hides registered-but-never-played accounts (created at score 0).
  const res = await _sbFetch('/scores?select=name,score&score=gt.0&order=score.desc');
  return res.json(); // [{ name, score }, ...]
}
```

to:

```ts
async function sbLoadScores() {
  if (!_sb) return null;
  // score=gt.0 hides registered-but-never-played accounts (created at score 0).
  const res = await _sbFetch('/scores?select=name,score,avatar&score=gt.0&order=score.desc');
  return res.json(); // [{ name, score, avatar }, ...]
}
```

- [ ] **Step 3: `sbSubmitScore` takes and sends `avatar`**

Change:

```ts
async function sbSubmitScore(name, token, score, replay?) {
  if (!_sb) return;
  const { seed, flapTicks } = replay || { seed: 0, flapTicks: [] };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, token, seed, flapTicks, claimedScore: score }),
  });
  if (!res.ok) throw new Error(await res.text());
}
```

to:

```ts
async function sbSubmitScore(name, token, score, replay?, avatar?) {
  if (!_sb) return;
  const { seed, flapTicks } = replay || { seed: 0, flapTicks: [] };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, token, seed, flapTicks, claimedScore: score, avatar }),
  });
  if (!res.ok) throw new Error(await res.text());
}
```

- [ ] **Step 4: `ensurePlayerToken` sends the current avatar on registration**

Change:

```ts
  const tok = generateToken();
  setLocalToken(name, tok);
  try { await sbSubmitScore(name, tok, 0); }
  catch (e) { console.warn('Supabase register failed', e); }
```

to:

```ts
  const tok = generateToken();
  setLocalToken(name, tok);
  try { await sbSubmitScore(name, tok, 0, undefined, _currentAvatar()); }
  catch (e) { console.warn('Supabase register failed', e); }
```

- [ ] **Step 5: `loadScores` returns rows (not a name→score map)**

Change:

```ts
// Load all scores: Supabase if configured, else localStorage fallback
export async function loadScores() {
  if (_sb) {
    try {
      const rows = await sbLoadScores();
      // return as { name: score } map for compatibility
      return Object.fromEntries(rows.map(r => [r.name, r.score]));
    } catch (e) { console.warn('Supabase load failed, using local', e); }
  }
  // No Supabase → no authoritative scores. localStorage holds tokens only.
  return {};
}
```

to:

```ts
// Load all scores: Supabase if configured, else empty. Returns rows as
// [{ name, score, avatar }], pre-sorted by score descending (the DB query
// orders them). avatar may be null for pre-existing rows.
export async function loadScores() {
  if (_sb) {
    try {
      return await sbLoadScores();
    } catch (e) { console.warn('Supabase load failed, using local', e); }
  }
  // No Supabase → no authoritative scores.
  return [];
}
```

- [ ] **Step 6: `saveScore` sends the current avatar**

Change:

```ts
export async function saveScore(name, score, replay) {
  if (!_sb) return; // _sb already encodes LIVE_DB — no separate localhost check needed
  const tok = getLocalToken(name);
  if (!tok) return;
  try { await sbSubmitScore(name, tok, score, replay); }
  catch (e) { console.warn('Supabase submit failed', e); }
}
```

to:

```ts
export async function saveScore(name, score, replay) {
  if (!_sb) return; // _sb already encodes LIVE_DB — no separate localhost check needed
  const tok = getLocalToken(name);
  if (!tok) return;
  try { await sbSubmitScore(name, tok, score, replay, _currentAvatar()); }
  catch (e) { console.warn('Supabase submit failed', e); }
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (`loadScores`'s return type changed from object to
array — its only consumer is updated in Task 5.)

- [ ] **Step 8: Commit**

```bash
git add src/scores.ts
git commit -m "scores.ts: load/save avatar alongside name+score"
```

---

### Task 5: `src/game.ts` — leaderboard rendering

**Files:**
- Modify: `src/game.ts:1-12` (imports)
- Modify: `src/game.ts:3238-3253` (`btn-scores` click handler)

- [ ] **Step 1: Import `AVATAR_KEYS`**

Change:

```ts
import {
  C, TICK_MS, createState, step, speedLevel, type GameState,
} from './physics-core.ts';
import {
  fetchBest, saveScore, loadScores, ensurePlayerToken, fetchFortune,
  showRecoverModal, _loadLocal,
} from './scores.ts';
```

to:

```ts
import {
  C, TICK_MS, createState, step, speedLevel, type GameState,
} from './physics-core.ts';
import { AVATAR_KEYS } from './avatars-meta.ts';
import {
  fetchBest, saveScore, loadScores, ensurePlayerToken, fetchFortune,
  showRecoverModal, _loadLocal,
} from './scores.ts';
```

- [ ] **Step 2: Replace the `btn-scores` click handler**

Change:

```ts
document.getElementById('btn-scores').addEventListener('click', async () => {
  const scores = await loadScores();
  const list = document.getElementById('scores-list');
  list.innerHTML = '';
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    list.innerHTML = '<li>No scores yet.</li>';
  } else {
    sorted.forEach(([name, sc]) => {
      const li = document.createElement('li');
      li.textContent = `${name}: ${sc}`;
      list.appendChild(li);
    });
  }
  showScreen('scores');
});
```

to:

```ts
// Rank 1-3 get an IAM "privilege tier" badge instead of a plain rank number —
// the leaderboard's running gag on the game's access-control satire.
const RANK_BADGES = [
  { cls: 'tier-admin',    label: 'AdministratorAccess' },
  { cls: 'tier-power',    label: 'PowerUserAccess' },
  { cls: 'tier-readonly', label: 'ReadOnlyAccess' },
];

// Which avatar icon a leaderboard row shows: the avatar the score was
// achieved with; for the current player's own (pre-existing, avatar=null) row,
// their currently-picked avatar; otherwise the penguin mascot.
function resolveAvatarKey(row) {
  if (row.avatar && (AVATAR_KEYS as readonly string[]).includes(row.avatar)) return row.avatar;
  if (row.name === currentPlayer) {
    const saved = localStorage.getItem('lpb_avatar');
    if (saved && (AVATAR_KEYS as readonly string[]).includes(saved)) return saved;
  }
  return 'penguin';
}

// Build one leaderboard row. Built with DOM methods (not innerHTML) because
// `row.name` is untrusted player input.
function renderScoreRow(row, i) {
  const rank = i + 1;
  const theme = THEMES[resolveAvatarKey(row)] || THEMES.penguin;
  const div = document.createElement('div');
  div.className = 'score-row' + (row.name === currentPlayer ? ' current-player' : '');

  const img = document.createElement('img');
  img.className = 'score-avatar';
  img.src = theme.img.src;
  img.alt = theme.label;
  div.appendChild(img);

  const rankEl = document.createElement('span');
  const badge = RANK_BADGES[rank - 1];
  if (badge) {
    rankEl.className = `score-badge ${badge.cls}`;
    rankEl.textContent = badge.label;
  } else {
    rankEl.className = 'score-rank';
    rankEl.textContent = `#${rank}`;
  }
  div.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'score-name';
  nameEl.textContent = row.name;
  div.appendChild(nameEl);

  const valEl = document.createElement('span');
  valEl.className = 'score-value';
  valEl.textContent = String(row.score);
  div.appendChild(valEl);

  return div;
}

document.getElementById('btn-scores').addEventListener('click', async () => {
  const scores = await loadScores(); // [{ name, score, avatar }], pre-sorted desc
  const list = document.getElementById('scores-list');
  list.innerHTML = '';
  list.classList.toggle('round-gfx', gfxStyle === 'round');
  if (!scores.length) {
    list.innerHTML = '<p class="scores-empty">No scores yet.</p>';
  } else {
    scores.forEach((row, i) => list.appendChild(renderScoreRow(row, i)));
  }
  showScreen('scores');
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/game.ts
git commit -m "game.ts: render leaderboard rows with avatars + rank badges"
```

---

### Task 6: `index.html` — leaderboard markup + styles

**Files:**
- Modify: `index.html:74-81` (`#scores-panel` CSS)
- Modify: `index.html:353-357` (scores screen markup)

- [ ] **Step 1: Replace the `#scores-panel` CSS block**

Change:

```css
    #scores-panel {
      background: rgba(0,0,0,.75); border-radius: 12px;
      padding: 16px 28px; max-height: 220px; overflow-y: auto;
      font-size: 0.95rem; min-width: 220px;
    }
    #scores-panel h2 { margin-bottom: 8px; text-align: center; }
    #scores-panel ol { padding-left: 20px; }
    #scores-panel li { padding: 2px 0; }
```

to:

```css
    #scores-panel {
      background: rgba(0,0,0,.75); border-radius: var(--radius);
      padding: 16px 24px; max-height: 560px; min-width: 320px; max-width: 520px;
      width: 100%; font-size: 0.95rem;
      display: flex; flex-direction: column; gap: 8px;
    }
    #scores-panel h2 { text-align: center; margin: 0; flex: 0 0 auto; }
    .scores-list {
      display: flex; flex-direction: column; gap: 4px;
      overflow-y: auto; flex: 1 1 auto; min-height: 0;
    }
    .scores-empty { text-align: center; padding: 12px 0; color: #aaa; }

    .score-row {
      display: grid; grid-template-columns: 32px auto 1fr auto;
      align-items: center; gap: 10px;
      padding: 6px 10px; border-radius: var(--radius);
      background: rgba(255,255,255,0.04);
      border: 2px solid transparent;
    }
    .score-row.current-player {
      border-color: #ffd600; background: rgba(255,214,0,0.12);
    }
    .score-avatar { width: 28px; height: 28px; image-rendering: pixelated; }
    .scores-list.round-gfx .score-avatar { image-rendering: auto; }
    .score-rank {
      font-family: var(--font-display); font-size: 0.7rem; color: #aaa; text-align: right;
    }
    .score-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score-value {
      font-family: var(--font-display); font-size: 0.85rem; color: #76ff03; text-align: right;
      text-shadow: 2px 2px 0 #0a2a00; /* matches .go-score-num */
    }
    .score-badge {
      font-family: var(--font-display); font-size: 0.5rem; letter-spacing: 0.5px;
      padding: 4px 6px; border-radius: var(--radius); text-align: center;
      white-space: nowrap; color: #1a1a1a;
    }
    .tier-admin    { background: #ffd600; } /* gold */
    .tier-power    { background: #c0c8d0; } /* silver */
    .tier-readonly { background: #cd8a3c; } /* bronze */

    body.is-mobile #scores-panel {
      max-width: min(420px, calc(100vw - 32px)); max-height: 420px; padding: 12px 14px;
    }
    body.is-mobile .score-badge { font-size: 0.4rem; padding: 3px 4px; }
    body.is-mobile .score-avatar { width: 22px; height: 22px; }
```

- [ ] **Step 2: Replace the scores list element**

Change:

```html
    <div id="scores-screen" class="hidden">
      <div id="scores-panel">
        <h2>🏆 High Scores</h2>
        <ol id="scores-list"></ol>
      </div>
      <button id="btn-back">Back</button>
    </div>
```

to:

```html
    <div id="scores-screen" class="hidden">
      <div id="scores-panel">
        <h2>🏆 High Scores</h2>
        <div id="scores-list" class="scores-list"></div>
      </div>
      <button id="btn-back">Back</button>
    </div>
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "index.html: leaderboard layout, avatar/badge/highlight styles"
```

---

### Task 7: End-to-end verification

**Prerequisite:** Task 2 Step 3 (DB migration applied) must be done.

- [ ] **Step 1: Run the golden replay tests (confirm no physics regression)**

Run: `npm test`
Expected: all golden replay tests pass (avatar never touches `physics-core.ts`,
so this should be unaffected — this step just confirms nothing else broke).

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: serves on `http://localhost:8003`.

- [ ] **Step 3: Enable live DB and play a round**

In the browser devtools console at `http://localhost:8003`:
```js
localStorage.lpb_live = '1'
```
Reload, pick a name + an avatar (e.g. Robot), play a round, and let it end
(die on a pipe). This calls `saveScore` → `submit-score`, writing `avatar`
alongside `score`.

- [ ] **Step 4: Check the leaderboard**

From the menu, click "🏆 High Scores". Verify:
- The panel is visibly larger than before, with a scrollable row list.
- Your row shows the Robot avatar icon you just played with.
- If your score is in the top 3, it shows the gold/silver/bronze
  `AdministratorAccess` / `PowerUserAccess` / `ReadOnlyAccess` badge instead
  of a `#N` rank.
- Your row has the gold highlight border (current-player).
- Any pre-existing rows (avatar `NULL` in the DB from before this change)
  show the penguin mascot icon, not a broken image.

- [ ] **Step 5: Check pixel/round style toggle**

Toggle the art-style checkbox (bottom-left). Reopen High Scores. Verify the
avatar icons switch between pixelated and smooth rendering (matching
`.avatar-opt` behavior elsewhere).

- [ ] **Step 6: Check on a narrow viewport**

Open devtools responsive mode at e.g. 375×667. Reopen High Scores. Verify the
panel fits on screen without horizontal overflow and rows remain readable.

---

### Task 8: Update the idea backlog

**Files:**
- Modify: `ideas.md`

- [ ] **Step 1: Mark the high-score styling item done**

Change:

```markdown
- ❌ Also, high score page is scuffed. Make it look nicer, colored trophy icons near top 3, etc. etc. Lots of space to extend and highlight winners; style should follow pixel/round.
  *(Still a bare `<ol>` rendering "name: score", no styling.)*
```

to:

```markdown
- ✅ Also, high score page is scuffed. Make it look nicer, colored trophy icons near top 3, etc. etc. Lots of space to extend and highlight winners; style should follow pixel/round.
  *(Redesigned: avatar icons per row, gold/silver/bronze IAM-tier badges for top 3, current-player highlight, pixel/round-aware.)*
```

- [ ] **Step 2: Commit**

```bash
git add ideas.md
git commit -m "ideas.md: mark leaderboard redesign done"
```
