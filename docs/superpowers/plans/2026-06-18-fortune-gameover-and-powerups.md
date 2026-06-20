# Fortune at Game-Over & Power-Up System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the game-over AWS error text with fortune messages, and add a data-driven power-up system with 6 AWS-themed collectibles that modify physics deterministically.

**Architecture:** Power-up definitions, spawning, collision, effects, and safe expiry live in `physics-core.ts` (deterministic, shared with server replay). Rendering (sprites, HUD indicators, visual side effects) lives in `game.ts`. Fortune rewiring is a small change in `game.ts` + `showScreen()`. The existing `simulate()` function inherits power-up behavior automatically since it calls `step()`.

**Tech Stack:** TypeScript, esbuild bundler, Canvas 2D rendering, seeded PRNG (mulberry32). Tests via `scripts/test-replay.ts` run through esbuild → node.

## Global Constraints

- `physics-core.ts` must stay pure: no `Math.random`, no DOM, no wall-clock. All randomness via `s.rng()`.
- Power-up spawns and effects must be deterministic — `simulate(seed, flapTicks)` must reproduce identical results.
- Existing golden replay tests (`npm test`) must keep passing after each task (power-ups only trigger after score ≥ 3, and all goldens score ≤ 9 with fixed seeds — but verify).
- `game.ts` imports from `physics-core.ts` — the reverse never happens.
- Server edge function (`supabase/functions/submit-score/index.ts`) imports `simulate()` — no changes needed there.

---

### Task 1: Fortune at Game-Over

**Files:**
- Modify: `src/game.ts:2385-2393` (`showScreen` — remove cowsay from gameover)
- Modify: `src/game.ts:3099-3126` (`showGameOver` — fetch fortune, write to `#go-errcode`)

**Interfaces:**
- Consumes: `fetchFortune()` from `scores.ts` (already imported in game.ts)
- Produces: no new interfaces — internal wiring change only

- [ ] **Step 1: Modify `showScreen` to only show cowsay on menu**

In `src/game.ts`, change the fortune cow condition at line ~2391:

```ts
// Before:
if (name === 'menu' || name === 'gameover') showFortuneCow();

// After:
if (name === 'menu') showFortuneCow();
```

- [ ] **Step 2: Modify `showGameOver` to display a fortune instead of fake AWS error**

Replace the error-code logic in `showGameOver` (lines ~3110-3113). The function is sync today but needs to become async for the fortune fetch. The `GO_ERRORS` array stays as a fallback.

```ts
async function showGameOver(msg) {
  document.getElementById('gameover-msg').textContent = msg;

  // Fortune replaces the fake AWS error — falls back to an error if fetch fails.
  let flavor: string;
  try {
    flavor = await fetchFortune();
  } catch {
    flavor = GO_ERRORS[gs.score % GO_ERRORS.length]
           + ` (req ${(gs.score * 7919 + 1009).toString(16)})`;
  }
  document.getElementById('go-errcode').textContent = flavor;

  overlay.classList.remove('hidden');
  showScreen('gameover');

  const el = document.getElementById('go-score-val');
  const target = gs.score, steps = Math.min(30, target) || 1, t0 = performance.now(), dur = 600;
  el.textContent = '0';
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = String(Math.round(target * p));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}
```

Note: `showGameOver` is already called in async contexts (`endGame` is async). The two callers don't `await` it — that's fine, the fortune fills in asynchronously. If it takes a moment the score count-up animation covers the latency.

- [ ] **Step 3: Verify in browser**

Run `npm run dev`, play a game, die, confirm:
- Game-over screen shows a fortune quote (not an AWS error) in the `#go-errcode` element.
- Menu screen still shows the corner cowsay with ASCII art.
- If Supabase is off, game-over falls back to a `GO_ERRORS` entry.

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

Expected: all golden replay tests pass (this change is render-only, no physics touched).

- [ ] **Step 5: Commit**

```bash
git add src/game.ts
git commit -m "feat: show fortune at game-over, keep cowsay on menu only"
```

---

### Task 2: Power-Up Data Model & Definitions in Physics Core

**Files:**
- Modify: `src/physics-core.ts` — add interfaces, constants, definitions, extend `GameState`

**Interfaces:**
- Consumes: existing `C` constants, `GameState`, `mulberry32` RNG
- Produces:
  - `PowerUpDef` interface (used by Tasks 3, 4, 5)
  - `POWERUP_DEFS: readonly PowerUpDef[]` registry (used by Tasks 3, 4, 5)
  - `PowerUpItem` interface with `{ x: number; y: number; defId: string; collected: boolean }` (used by Tasks 3, 4, 5)
  - `ActiveEffect` interface with `{ defId: string; expiryTick: number }` (used by Tasks 3, 4, 5)
  - Extended `GameState` with `powerUps: PowerUpItem[]` and `activeEffects: ActiveEffect[]` fields
  - `POWERUP_RADIUS` constant (20) exported in `C`
  - Helper `getEffective(s: GameState)` returning `{ gravity, flap, speed, size, invincible, destroysPipes }` (used by Tasks 3, 4)

- [ ] **Step 1: Write the test for power-up definitions and effective multipliers**

Create `scripts/test-powerups.ts`:

```ts
import {
  createState, C, POWERUP_DEFS, getEffective,
  type PowerUpDef, type ActiveEffect,
} from "../src/physics-core.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log(`✗ ${msg}`); }
  else console.log(`✓ ${msg}`);
}

// All 6 power-ups exist
assert(POWERUP_DEFS.length === 6, `expected 6 power-up defs, got ${POWERUP_DEFS.length}`);
const ids = POWERUP_DEFS.map(d => d.id);
for (const id of ['wildcard', 'autoscaling', 'cloudfront', 'role-assumption', 'elb', 'star']) {
  assert(ids.includes(id), `def '${id}' exists`);
}

// getEffective with no active effects returns base values
const s = createState(1);
const base = getEffective(s);
assert(base.gravity === C.GRAVITY, `base gravity = ${C.GRAVITY}`);
assert(base.flap === C.FLAP, `base flap = ${C.FLAP}`);
assert(base.speed === 1, `base speed multiplier = 1`);
assert(base.size === 1, `base size multiplier = 1`);
assert(base.invincible === false, `base not invincible`);
assert(base.destroysPipes === false, `base does not destroy pipes`);

// getEffective with wildcard active returns invincible + 2x size
s.activeEffects.push({ defId: 'wildcard', expiryTick: 9999 });
const w = getEffective(s);
assert(w.invincible === true, `wildcard → invincible`);
assert(w.size === 2.0, `wildcard → size 2.0`);

// Stacking: add ELB on top of wildcard
s.activeEffects.push({ defId: 'elb', expiryTick: 9999 });
const stacked = getEffective(s);
assert(stacked.invincible === true, `stacked still invincible`);
assert(stacked.gravity === C.GRAVITY * 0.5, `stacked gravity halved by ELB`);
assert(stacked.size === 2.0, `stacked size still 2.0 (ELB has no sizeMul)`);

if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
console.log(`\nAll power-up definition tests passed.`);
```

- [ ] **Step 2: Add test script to package.json**

Add to `scripts` in `package.json`:

```json
"test:powerups": "esbuild scripts/test-powerups.ts --bundle --platform=node --format=esm --outfile=dist/test-powerups.mjs && node dist/test-powerups.mjs"
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run test:powerups
```

Expected: FAIL — `POWERUP_DEFS` and `getEffective` don't exist yet.

- [ ] **Step 4: Implement definitions, state extensions, and `getEffective`**

In `src/physics-core.ts`, add after the `C.GROUND = ...` line (around line 41):

```ts
// ── Power-Up System ──────────────────────────────────────────────────────────
C.POWERUP_RADIUS = 20;
C.POWERUP_FIRST_PIPE = 3;
C.POWERUP_BASE_CHANCE = 0.15;
C.POWERUP_CHANCE_PER_LEVEL = 0.05;
C.POWERUP_CHANCE_CAP = 0.40;
C.POWERUP_AHEAD_PX = 180;
C.POWERUP_GRACE_TICKS = 30;

export interface PowerUpDef {
  id: string;
  durationTicks: number;
  gravityMul?: number;
  flapMul?: number;
  speedMul?: number;
  gapMul?: number;
  sizeMul?: number;
  invincible?: boolean;
  destroysPipes?: boolean;
  weight?: number;
  minSpeedLevel?: number;
}

export const POWERUP_DEFS: readonly PowerUpDef[] = [
  { id: 'wildcard',        durationTicks: 240, sizeMul: 2.0, invincible: true },
  { id: 'autoscaling',     durationTicks: 300, sizeMul: 0.6, flapMul: 1.8 },
  { id: 'cloudfront',      durationTicks: 300, speedMul: 0.5 },
  { id: 'role-assumption', durationTicks: 240, gapMul: 1.4 },
  { id: 'elb',             durationTicks: 300, gravityMul: 0.5 },
  { id: 'star',            durationTicks: 210, speedMul: 1.5, invincible: true, destroysPipes: true, weight: 0.5, minSpeedLevel: 2 },
];

export interface PowerUpItem { x: number; y: number; defId: string; collected: boolean; }
export interface ActiveEffect { defId: string; expiryTick: number; }
```

Extend the `GameState` interface:

```ts
export interface GameState {
  player: { y: number; vy: number };
  pipes: Pipe[];
  score: number;
  pipeSpeed: number;
  tick: number;
  lastSpeedUpTick: number | null;
  lastPipeTick: number | null;
  rng: () => number;
  powerUps: PowerUpItem[];
  activeEffects: ActiveEffect[];
}
```

Update `createState` to initialize the new fields:

```ts
export function createState(seed: number): GameState {
  const s: GameState = {
    player: { y: C.H / 2, vy: 0 },
    pipes: [],
    score: 0,
    pipeSpeed: C.PIPE_SPEED,
    tick: 0,
    lastSpeedUpTick: null,
    lastPipeTick: null,
    rng: mulberry32(seed),
    powerUps: [],
    activeEffects: [],
  };
  prefillField(s);
  return s;
}
```

Add the `getEffective` helper:

```ts
export function getEffective(s: GameState): {
  gravity: number; flap: number; speed: number; size: number;
  invincible: boolean; destroysPipes: boolean;
} {
  let gravity = C.GRAVITY, flap = C.FLAP, speed = 1, size = 1;
  let invincible = false, destroysPipes = false;
  for (const e of s.activeEffects) {
    const d = POWERUP_DEFS.find(p => p.id === e.defId);
    if (!d) continue;
    if (d.gravityMul)    gravity *= d.gravityMul;
    if (d.flapMul)       flap *= d.flapMul;
    if (d.speedMul)      speed *= d.speedMul;
    if (d.sizeMul)       size *= d.sizeMul;
    if (d.invincible)    invincible = true;
    if (d.destroysPipes) destroysPipes = true;
  }
  return { gravity, flap, speed, size, invincible, destroysPipes };
}
```

Note: `speed` and `size` return as multipliers (1 = no change). `gravity` and `flap` return as absolute values (already multiplied against `C.GRAVITY` / `C.FLAP`).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:powerups && npm test
```

Expected: both pass. Golden replays still pass because `createState` initializes empty `powerUps`/`activeEffects` — the step function hasn't changed yet.

- [ ] **Step 6: Commit**

```bash
git add src/physics-core.ts scripts/test-powerups.ts package.json
git commit -m "feat: power-up data model, definitions, and getEffective helper"
```

---

### Task 3: Power-Up Spawning, Collection, and Effect Application in `step()`

**Files:**
- Modify: `src/physics-core.ts` — update `step()` to spawn power-ups, detect collection, apply effects, handle expiry + safe expiry

**Interfaces:**
- Consumes: `PowerUpDef`, `POWERUP_DEFS`, `PowerUpItem`, `ActiveEffect`, `getEffective()`, `C.POWERUP_*` constants (all from Task 2)
- Produces:
  - Extended `StepResult`: `{ scored: boolean; dead: boolean; collected?: string; destroyedPipes?: number; expiredEffects?: string[] }`
  - `currentGap(s)` now applies `gapMul` from active effects at spawn time
  - `step()` now spawns, collects, applies, and expires power-ups deterministically

- [ ] **Step 1: Write the test for spawning and collection**

Append to `scripts/test-powerups.ts` (before the final summary):

```ts
// ── Spawning and collection tests ──
// (Add step, simulate, and StepResult to the existing import at the top of this file)

// Power-ups should not spawn before POWERUP_FIRST_PIPE scored pipes
const s2 = createState(42);
// Run ticks without flapping until death — bird falls fast, but check spawning
let sawPowerUp = false;
for (let i = 0; i < 600 && !sawPowerUp; i++) {
  step(s2, i % 35 === 0); // flap periodically to stay alive-ish
  if (s2.powerUps.length > 0 && s2.score < C.POWERUP_FIRST_PIPE) {
    sawPowerUp = true;
  }
}
assert(!sawPowerUp, `no power-ups spawn before score reaches POWERUP_FIRST_PIPE`);

// With enough play, a power-up should eventually spawn (seed 42, flapping to stay alive)
const s3 = createState(42);
let collected: string | undefined;
let spawnedAny = false;
for (let t = 0; t < 3000; t++) {
  // Flap every 30 ticks to roughly hover
  const result = step(s3, t % 30 === 0);
  if (s3.powerUps.length > 0) spawnedAny = true;
  if (result.collected) collected = result.collected;
  if (result.dead) break;
}
assert(spawnedAny, `power-up spawned during extended play (seed=42)`);

// Determinism: same seed+inputs must produce same power-up sequence
const run1 = createState(7);
const run2 = createState(7);
const inputs = Array.from({ length: 2000 }, (_, i) => i % 28 === 0);
for (let t = 0; t < inputs.length; t++) {
  step(run1, inputs[t]);
  step(run2, inputs[t]);
}
const pu1 = JSON.stringify(run1.powerUps);
const pu2 = JSON.stringify(run2.powerUps);
assert(pu1 === pu2, `power-up state deterministic across identical runs`);
const ae1 = JSON.stringify(run1.activeEffects);
const ae2 = JSON.stringify(run2.activeEffects);
assert(ae1 === ae2, `active effects deterministic across identical runs`);

// Existing golden replays must still pass
const goldenSeeds = [1, 7, 42, 1000, 31337];
const goldenScores = [3, 5, 8, 2, 9];
const goldenFlaps = [
  [8,43,78,113,148,183,218,253,288,318,333,348,373,408,460,494],
  [0,15,30,45,80,115,150,185,220,255,290,327,362,397,457,491,526,541,571,606,629,664,699],
  [5,40,75,110,145,180,215,250,285,318,347,382,417,466,500,529,560,595,629,644,659,689,736,771,798,825,860,908,942],
  [18,53,88,123,158,193,228,263,298,335,370,405],
  [13,48,83,118,153,188,223,258,293,318,333,359,394,442,477,512,555,590,625,640,673,708,723,738,753,786,829,864,917,952,996,1030,1048],
];
for (let i = 0; i < goldenSeeds.length; i++) {
  const { score } = simulate(goldenSeeds[i], goldenFlaps[i]);
  assert(score === goldenScores[i], `golden replay seed=${goldenSeeds[i]} expected=${goldenScores[i]} got=${score}`);
}
```

- [ ] **Step 2: Run test to verify new assertions fail**

```bash
npm run test:powerups
```

Expected: definition tests pass, spawning/collection tests fail (step doesn't spawn yet).

- [ ] **Step 3: Implement power-up spawning in `step()`**

In `src/physics-core.ts`, add a `spawnPowerUp` helper near `spawnPipe`:

```ts
function spawnPowerUp(s: GameState, pipeX: number): void {
  const eligible = POWERUP_DEFS.filter(d => !d.minSpeedLevel || speedLevel(s) >= d.minSpeedLevel);
  if (eligible.length === 0) return;

  // Weighted random selection
  const totalWeight = eligible.reduce((sum, d) => sum + (d.weight ?? 1), 0);
  let roll = s.rng() * totalWeight;
  let chosen = eligible[0];
  for (const d of eligible) {
    roll -= d.weight ?? 1;
    if (roll <= 0) { chosen = d; break; }
  }

  const y = 60 + s.rng() * (C.GROUND - 120);
  s.powerUps.push({ x: pipeX + C.POWERUP_AHEAD_PX, y, defId: chosen.id, collected: false });
}
```

- [ ] **Step 4: Implement collection, effect application, expiry, and safe expiry in `step()`**

Modify the `step()` function. The full updated function:

```ts
export function step(s: GameState, flapped: boolean): StepResult {
  // ── Expire effects (before input, so getEffective reflects current state) ──
  const expiredEffects: string[] = [];
  s.activeEffects = s.activeEffects.filter(e => {
    if (s.tick < e.expiryTick) return true;
    // Safe expiry: if this effect has invincible or sizeMul, check if removing
    // it would cause instant death. If so, extend by grace window.
    const def = POWERUP_DEFS.find(d => d.id === e.defId);
    if (def && (def.invincible || def.sizeMul)) {
      // Temporarily compute what collision would look like without this effect
      const testEffects = s.activeEffects.filter(ae => ae !== e);
      let testSize = C.PLAYER_SIZE / 2 - 4;
      for (const te of testEffects) {
        const td = POWERUP_DEFS.find(d => d.id === te.defId);
        if (td?.sizeMul) testSize = (C.PLAYER_SIZE * td.sizeMul) / 2 - 4;
      }
      // Check if player would collide with restored size
      const py = s.player.y;
      let wouldCollide = py - testSize <= 0 || py + testSize >= C.GROUND;
      if (!wouldCollide) {
        for (const p of s.pipes) {
          if (C.PLAYER_X + testSize > p.x && C.PLAYER_X - testSize < p.x + C.PIPE_W) {
            if (py - testSize < p.topH || py + testSize > p.topH + p.gap) {
              wouldCollide = true;
              break;
            }
          }
        }
      }
      if (wouldCollide) {
        e.expiryTick = s.tick + C.POWERUP_GRACE_TICKS;
        return true; // keep it alive
      }
    }
    expiredEffects.push(e.defId);
    return false;
  });

  const eff = getEffective(s);

  // INPUT — before physics, matching original ordering (flap sets vy, then gravity adds)
  if (flapped) s.player.vy = eff.flap;

  if (s.lastSpeedUpTick === null) s.lastSpeedUpTick = s.tick;

  // Speed ramp
  if (s.tick - s.lastSpeedUpTick >= SPEED_UP_TICKS) {
    s.pipeSpeed += C.SPEED_UP_AMOUNT;
    s.lastSpeedUpTick = s.tick;
  }

  // Spawn pipes + maybe power-ups
  if ((s.tick - (s.lastPipeTick as number)) * TICK_MS >= currentInterval(s)) {
    spawnPipe(s);
    // Power-up spawn check
    if (s.score >= C.POWERUP_FIRST_PIPE
        && s.powerUps.every(p => p.collected)
    ) {
      const chance = Math.min(
        C.POWERUP_CHANCE_CAP,
        C.POWERUP_BASE_CHANCE + speedLevel(s) * C.POWERUP_CHANCE_PER_LEVEL,
      );
      if (s.rng() < chance) spawnPowerUp(s, s.pipes[s.pipes.length - 1].x);
    }
  }

  // Update pipes + scoring (with effective speed)
  let scored = false;
  const effectiveSpeed = s.pipeSpeed * eff.speed;
  let destroyedPipes = 0;
  for (const p of s.pipes) {
    p.x -= effectiveSpeed;
    if (!p.scored && p.x + C.PIPE_W < C.PLAYER_X) { s.score++; p.scored = true; scored = true; }
  }

  // Move uncollected power-ups with pipe speed
  for (const pu of s.powerUps) {
    if (!pu.collected) pu.x -= effectiveSpeed;
  }

  // Pipe destruction (star)
  if (eff.destroysPipes) {
    const r = C.PLAYER_SIZE / 2 - 4;
    for (const p of s.pipes) {
      if (C.PLAYER_X + r > p.x && C.PLAYER_X - r < p.x + C.PIPE_W) {
        destroyedPipes++;
      }
    }
    s.pipes = s.pipes.filter(p => {
      if (C.PLAYER_X + (C.PLAYER_SIZE / 2 - 4) > p.x && C.PLAYER_X - (C.PLAYER_SIZE / 2 - 4) < p.x + C.PIPE_W) return false;
      return true;
    });
  }

  s.pipes = s.pipes.filter(p => p.x + C.PIPE_W > 0);
  s.powerUps = s.powerUps.filter(pu => pu.collected || pu.x + C.POWERUP_RADIUS > 0);

  // Power-up collection
  let collected: string | undefined;
  const pr = C.POWERUP_RADIUS;
  const playerR = C.PLAYER_SIZE / 2 - 4;
  for (const pu of s.powerUps) {
    if (pu.collected) continue;
    const dx = C.PLAYER_X - pu.x, dy = s.player.y - pu.y;
    if (dx * dx + dy * dy < (playerR + pr) * (playerR + pr)) {
      pu.collected = true;
      collected = pu.defId;
      const def = POWERUP_DEFS.find(d => d.id === pu.defId)!;
      s.activeEffects.push({ defId: pu.defId, expiryTick: s.tick + def.durationTicks });
    }
  }

  // Update player physics with effective values
  s.player.vy += eff.gravity;
  s.player.y += s.player.vy;

  s.tick++;

  // Collision (skip if invincible)
  const dead = eff.invincible ? false : collides(s);

  return { scored, dead, collected, destroyedPipes: destroyedPipes || undefined, expiredEffects: expiredEffects.length ? expiredEffects : undefined };
}
```

Update the `StepResult` interface:

```ts
export interface StepResult {
  scored: boolean;
  dead: boolean;
  collected?: string;
  destroyedPipes?: number;
  expiredEffects?: string[];
}
```

- [ ] **Step 5: Update `collides()` to use effective size**

The `collides` function currently hardcodes `C.PLAYER_SIZE / 2 - 4`. It needs to accept the effective size multiplier. Change its signature:

```ts
function collides(s: GameState): boolean {
  const eff = getEffective(s);
  const r = (C.PLAYER_SIZE * eff.size) / 2 - 4;
  const px = C.PLAYER_X, py = s.player.y;
  if (py - r <= 0 || py + r >= C.GROUND) return true;
  for (const p of s.pipes) {
    if (px + r > p.x && px - r < p.x + C.PIPE_W) {
      if (py - r < p.topH || py + r > p.topH + p.gap) return true;
    }
  }
  return false;
}
```

- [ ] **Step 6: Update `currentGap` to apply `gapMul` from active effects**

The `currentGap` function needs access to `GameState` to check active effects. It already receives `s`:

```ts
export function currentGap(s: GameState): number {
  const baseGap = Math.max(C.PIPE_GAP_MIN, C.PIPE_GAP_MAX - speedLevel(s) * C.PIPE_GAP_STEP);
  let gapMul = 1;
  for (const e of s.activeEffects) {
    const d = POWERUP_DEFS.find(p => p.id === e.defId);
    if (d?.gapMul) gapMul *= d.gapMul;
  }
  return baseGap * gapMul;
}
```

- [ ] **Step 7: Run all tests**

```bash
npm run test:powerups && npm test
```

Expected: all pass. The golden replays must still produce the same scores — power-ups only spawn after score ≥ 3, and the RNG calls for power-up checks happen AFTER the pipe spawn RNG call, so the pipe sequence is unchanged when no power-ups are eligible. **Verify this carefully** — if goldens break, it means the RNG stream diverged. The fix is to ensure the power-up spawn check's `rng()` calls only happen when `s.score >= POWERUP_FIRST_PIPE`, so the RNG stream is identical for low-scoring runs.

**Critical RNG ordering concern:** The spawn check calls `s.rng()` for the chance roll AND potentially for type selection and y-position. For golden replays with scores < `POWERUP_FIRST_PIPE` (3), these calls never happen, so the stream is untouched. For seed=42 (score=8) and seed=31337 (score=9), power-up spawn rolls WILL consume RNG values after score ≥ 3, potentially altering subsequent pipe positions and breaking the golden. **This is expected** — goldens must be regenerated after adding power-ups. The golden test in `test-powerups.ts` (Step 1) validates the pre-power-up golden values; once `step()` changes, those replays now include power-up RNG draws and may produce different death points/scores.

**Resolution:** After implementing, run `npm test` to check if goldens break. If they do (likely for seeds 42 and 31337), regenerate goldens using `scripts/gen-goldens` and update `scripts/test-replay.ts`. The new goldens lock in the physics-with-power-ups behavior.

- [ ] **Step 8: Regenerate golden replays if needed**

If `npm test` fails for high-scoring seeds:

```bash
# Check which goldens broke
npm test

# Regenerate — the gen-goldens script hover-plays each seed and records new fixtures
# (see scripts/gen-goldens for details)
```

Update `scripts/test-replay.ts` with the new golden values. The test-powerups.ts golden checks (Step 1) should also be updated to match.

- [ ] **Step 9: Commit**

```bash
git add src/physics-core.ts scripts/test-powerups.ts scripts/test-replay.ts package.json
git commit -m "feat: power-up spawning, collection, effects, and safe expiry in physics core"
```

---

### Task 4: Power-Up Rendering — Items, HUD, and Visual Effects in `game.ts`

**Files:**
- Modify: `src/game.ts` — import new types, draw power-up items, draw active effect HUD, implement per-effect visual side effects, update `stepOnce` to handle extended `StepResult`

**Interfaces:**
- Consumes:
  - From physics-core (Task 2+3): `PowerUpItem`, `ActiveEffect`, `POWERUP_DEFS`, `getEffective`, `C.POWERUP_RADIUS`, extended `StepResult` with `collected`, `destroyedPipes`, `expiredEffects`
  - `GameState.powerUps` and `GameState.activeEffects` arrays
- Produces: render-only functions, no interfaces consumed by other tasks

- [ ] **Step 1: Update imports from physics-core**

In `src/game.ts` line ~6, extend the import:

```ts
import {
  C, TICK_MS, createState, step, speedLevel, currentGap,
  POWERUP_DEFS, getEffective,
  type GameState, type StepResult, type PowerUpItem, type ActiveEffect,
} from './physics-core.ts';
```

- [ ] **Step 2: Add render state for power-up effects**

Near the existing render state vars (around line ~2558):

```ts
// ── Power-up render state (purely visual, never feeds replay) ──
let puCollectedFlash = '';       // defId of last collected power-up (for pickup flash)
let puCollectedAt = -1e9;        // timestamp of last pickup
let puDestroyedPipes: Array<{ x: number; topH: number; gap: number; tick: number }> = [];
let puRoleSwapTheme: any = null; // random theme for role-assumption visual
let puScreenShake = 0;           // remaining screen-shake frames
```

- [ ] **Step 3: Update `stepOnce` to handle extended StepResult**

```ts
function stepOnce() {
  const flapped = pendingFlap;
  if (flapped) { flapTicks.push(gs.tick); pendingFlap = false; }
  const result: StepResult = step(gs, flapped);
  if (result.scored) AudioFX.score();

  // Power-up pickup
  if (result.collected) {
    puCollectedFlash = result.collected;
    puCollectedAt = performance.now();
    // Role Assumption: pick a random display theme (render-only)
    if (result.collected === 'role-assumption') {
      const keys = Object.keys(THEMES).filter(k => THEMES[k] !== currentTheme);
      puRoleSwapTheme = THEMES[keys[Math.floor(Math.random() * keys.length)]];
    }
  }

  // Pipe destruction visual
  if (result.destroyedPipes && result.destroyedPipes > 0) {
    puScreenShake = 4;
    // Capture destroyed pipe positions for particle burst
    // (pipes were removed from gs.pipes by step(), but we can infer player-adjacent position)
    puDestroyedPipes.push({ x: C.PLAYER_X, topH: gs.player.y - 50, gap: 100, tick: gs.tick });
  }

  // Effect expiry — clear role-swap theme if role-assumption expired
  if (result.expiredEffects?.includes('role-assumption')) {
    puRoleSwapTheme = null;
  }

  return result.dead;
}
```

- [ ] **Step 4: Draw power-up items in the game loop**

Add a `drawPowerUps()` function:

```ts
function drawPowerUps() {
  const now = performance.now();
  for (const pu of gs.powerUps) {
    if (pu.collected) continue;
    const def = POWERUP_DEFS.find(d => d.id === pu.defId);
    if (!def) continue;

    // Gentle bob animation
    const bobY = pu.y + Math.sin(gs.tick * 0.08) * 4;
    const r = C.POWERUP_RADIUS;

    ctx.save();
    ctx.translate(pu.x, bobY);

    // Glow pulse
    const pulse = 0.3 + 0.15 * Math.sin(gs.tick * 0.12);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = puColor(pu.defId);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();

    // Core circle
    ctx.globalAlpha = 1;
    ctx.fillStyle = puColor(pu.defId);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // Icon (simple text symbol)
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${r}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(puIcon(pu.defId), 0, 1);

    ctx.restore();
  }
}

function puColor(id: string): string {
  switch (id) {
    case 'wildcard':        return '#f59e0b'; // amber
    case 'autoscaling':     return '#10b981'; // emerald
    case 'cloudfront':      return '#6366f1'; // indigo
    case 'role-assumption': return '#ec4899'; // pink
    case 'elb':             return '#06b6d4'; // cyan
    case 'star':            return '#ef4444'; // red
    default:                return '#888';
  }
}

function puIcon(id: string): string {
  switch (id) {
    case 'wildcard':        return '*';
    case 'autoscaling':     return 'S';
    case 'cloudfront':      return 'C';
    case 'role-assumption': return 'R';
    case 'elb':             return 'E';
    case 'star':            return '!';
    default:                return '?';
  }
}
```

- [ ] **Step 5: Draw active effect HUD**

Add a `drawPowerUpHUD()` function:

```ts
function drawPowerUpHUD() {
  const effects = gs.activeEffects;
  if (effects.length === 0) return;

  const barW = 60, barH = 8, gap = 14, startY = 10, startX = C.W - barW - 45;

  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    const def = POWERUP_DEFS.find(d => d.id === e.defId);
    if (!def) continue;

    const y = startY + i * (barH + gap);
    const remaining = Math.max(0, e.expiryTick - gs.tick);
    const pct = remaining / def.durationTicks;

    // Flicker warning in last 90 ticks for invincible/size effects
    const isWarning = (def.invincible || def.sizeMul) && remaining <= 90;
    if (isWarning && Math.floor(gs.tick / 6) % 2 === 0) continue; // blink off

    // Icon
    ctx.fillStyle = puColor(e.defId);
    ctx.font = `bold 11px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(puIcon(e.defId), startX - 4, y + barH - 1);

    // Bar background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(startX, y, barW, barH);

    // Bar fill
    ctx.fillStyle = puColor(e.defId);
    ctx.fillRect(startX, y, barW * pct, barH);
  }
}
```

- [ ] **Step 6: Implement per-effect visual side effects in `drawPlayer`**

Modify `drawPlayer()` to apply visual effects. The key changes:

```ts
function drawPlayer() {
  const eff = getEffective(gs);
  const now = performance.now();

  // Screen shake (star pipe destruction)
  let shakeX = 0, shakeY = 0;
  if (puScreenShake > 0) {
    shakeX = (Math.random() - 0.5) * 8;
    shakeY = (Math.random() - 0.5) * 8;
    puScreenShake--;
  }

  // Effective sprite scale (size multiplier from power-ups)
  let drawScale = C.SPRITE_SCALE;
  const isFlickering = gs.activeEffects.some(e => {
    const d = POWERUP_DEFS.find(p => p.id === e.defId);
    return (d?.invincible || d?.sizeMul) && (e.expiryTick - gs.tick) <= 90;
  });
  if (isFlickering && Math.floor(gs.tick / 6) % 2 === 0) {
    drawScale = C.SPRITE_SCALE; // flash to normal size
  } else {
    drawScale = C.SPRITE_SCALE * eff.size;
  }

  const s = C.PLAYER_SIZE * drawScale;
  // CloudFront: stutter flap animation (skip every 3rd frame)
  const cfActive = gs.activeEffects.some(e => e.defId === 'cloudfront');
  const flapSuppressed = cfActive && gs.tick % 3 === 0;
  const inFlap = !flapSuppressed && (now - lastFlapAt) < FLAP_FRAME_MS;

  // Role Assumption: swap sprite
  const displayTheme = puRoleSwapTheme || currentTheme;
  const sprite = (inFlap && displayTheme.img2) ? displayTheme.img2 : displayTheme.img;

  // CloudFront: afterimage trail
  if (gs.activeEffects.some(e => e.defId === 'cloudfront')) {
    const trail = [0.1, 0.18, 0.26, 0.34];
    for (let i = 0; i < trail.length; i++) {
      ctx.save();
      ctx.globalAlpha = trail[i];
      const offset = (trail.length - i) * 12;
      ctx.translate(C.PLAYER_X - offset + shakeX, gs.player.y + shakeY);
      ctx.rotate(Math.max(-0.4, Math.min(0.4, gs.player.vy * 0.05)));
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  ctx.save();

  // ELB: horizontal wobble
  let wobbleX = 0;
  if (gs.activeEffects.some(e => e.defId === 'elb')) {
    wobbleX = Math.sin(gs.tick * 0.15) * 8;
  }

  ctx.translate(C.PLAYER_X + wobbleX + shakeX, gs.player.y + shakeY);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, gs.player.vy * 0.05)));

  // Star: rainbow hue-rotate
  if (gs.activeEffects.some(e => e.defId === 'star')) {
    const hue = (gs.tick * 12) % 360;
    ctx.filter = `hue-rotate(${hue}deg) saturate(1.5)`;
  }

  // Mane effect (horse)
  const fxMane = fxActiveForStyle(displayTheme);
  if (fxMane && fxMane.kind === 'mane') drawMane(s, fxMane.color);
  ctx.drawImage(sprite, -s / 2, -s / 2, s, s);

  // Sprite FX (fire, bolt trigger — use displayTheme)
  const fx = fxActiveForStyle(displayTheme);
  const fxOn = fx && (now - fxFiredAt) < fx.durationMs;
  if (fx && fx.sprite && fxOn) {
    const fw = s * fx.scale, fh = fw * 0.5;
    ctx.drawImage(displayTheme.fxImg, s * fx.anchorX, s * fx.anchorY - fh / 2, fw, fh);
  }

  ctx.filter = 'none';
  ctx.restore();

  // Bolt effect (unchanged, but use shakeX/shakeY offset — skip for brevity, it works as-is)
  if (fx && fx.kind === 'bolt' && boltActive) {
    const travelled = (now - fxFiredAt) / 1000 * fx.speed;
    const headX = boltSpawnX + travelled;
    const impactX = beamEndX(boltSpawnX, boltSpawnY);
    if (headX >= impactX) {
      drawBoltImpact(impactX, boltSpawnY, fx);
      boltActive = false;
    } else {
      drawBolt(headX, boltSpawnY, fx);
    }
  }
}
```

- [ ] **Step 7: Draw pipe destruction particles**

Add a `drawPipeDestruction()` function for the star's pipe-breaking effect:

```ts
function drawPipeDestruction() {
  const now = gs.tick;
  puDestroyedPipes = puDestroyedPipes.filter(d => now - d.tick < 30); // ~0.5s
  for (const d of puDestroyedPipes) {
    const age = now - d.tick;
    const t = age / 30; // 0..1
    ctx.save();
    ctx.globalAlpha = 1 - t;
    // Spray fragments outward
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dist = t * 40;
      const fx = d.x + Math.cos(angle) * dist;
      const fy = d.topH + Math.sin(angle) * dist + t * t * 30; // gravity on fragments
      ctx.fillStyle = currentTheme.pipeFill || '#4a7';
      ctx.fillRect(fx - 3, fy - 3, 6, 6);
    }
    ctx.restore();
  }
}
```

- [ ] **Step 8: Wire drawing functions into the game loop**

In the `loop()` function (line ~3042), add the power-up draws after pipes and before HUD:

```ts
function loop(now) {
  ctx.clearRect(0, 0, C.W, C.H);
  drawBackground();
  for (const p of gs.pipes) drawPipe(p.x, p.topH, p.gap);
  drawPowerUps();          // ← NEW: draw collectible items
  drawPipeDestruction();   // ← NEW: star pipe-break particles
  drawPlayer();            // ← already exists (now has visual effects)
  drawHUD();
  drawPowerUpHUD();        // ← NEW: active effect timer bars
  // ... rest unchanged
```

Also reset power-up render state in `initGame()`:

```ts
function initGame(playerName) {
  // ... existing reset ...
  puCollectedFlash = '';
  puCollectedAt = -1e9;
  puDestroyedPipes = [];
  puRoleSwapTheme = null;
  puScreenShake = 0;
}
```

- [ ] **Step 9: Verify in browser**

```bash
npm run dev
```

Play multiple games and verify:
- Power-ups appear as colored circles floating between pipes after score ≥ 3
- Flying through a power-up collects it (circle disappears)
- Wildcard: bird inflates to 2x, can't die, flickers before expiry, safe expiry works
- Auto-Scaling: bird shrinks, flaps are twitchy, flickers before expiry
- CloudFront: pipes slow down, bird leaves afterimage trail
- Role Assumption: avatar swaps to random theme, reverts on expiry
- ELB: floaty gravity, bird wobbles horizontally
- Star (speed level 2+): rainbow tint, pipes destroyed on contact with particle burst + screen shake
- HUD shows timer bars for active effects
- Effects stack when multiple collected
- Game-over still shows fortune text (Task 1)

- [ ] **Step 10: Run all tests**

```bash
npm run test:powerups && npm test
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/game.ts
git commit -m "feat: power-up rendering — items, HUD, visual effects, and pickup feedback"
```

---

### Task 5: Update Existing Tests & Final Polish

**Files:**
- Modify: `scripts/test-powerups.ts` — add edge case tests
- Modify: `scripts/test-replay.ts` — update goldens if needed (from Task 3 Step 8)

**Interfaces:**
- Consumes: all power-up interfaces from Tasks 2-3
- Produces: comprehensive test coverage

- [ ] **Step 1: Add safe-expiry edge case test**

Append to `scripts/test-powerups.ts`:

```ts
// ── Safe expiry test ──
// Wildcard expiry should NOT kill the player if they're inside a pipe
const s4 = createState(42);
// Run until we have some pipes and score enough for a power-up
for (let t = 0; t < 600; t++) step(s4, t % 30 === 0);
// Force a wildcard effect that expires next tick, with player inside a pipe
s4.activeEffects = [{ defId: 'wildcard', expiryTick: s4.tick + 1 }];
// Position player inside a pipe (if any pipes exist near player)
const nearPipe = s4.pipes.find(p => p.x <= C.PLAYER_X + C.PIPE_W && p.x + C.PIPE_W >= C.PLAYER_X);
if (nearPipe) {
  s4.player.y = nearPipe.topH - 10; // inside the top pipe
  const result = step(s4, false);
  assert(!result.dead, `safe expiry: player not killed when wildcard expires inside pipe`);
  assert(s4.activeEffects.length > 0, `safe expiry: effect extended by grace window`);
} else {
  console.log(`⊘ safe expiry: no pipe near player to test (non-critical, geometry-dependent)`);
}
```

- [ ] **Step 2: Add stacking multiplier test**

```ts
// ── Stacking test ──
const s5 = createState(1);
s5.activeEffects = [
  { defId: 'elb', expiryTick: 9999 },       // gravityMul: 0.5
  { defId: 'cloudfront', expiryTick: 9999 }, // speedMul: 0.5
  { defId: 'wildcard', expiryTick: 9999 },   // sizeMul: 2.0, invincible
];
const stacked2 = getEffective(s5);
assert(stacked2.gravity === C.GRAVITY * 0.5, `stacked: gravity = base * 0.5`);
assert(stacked2.speed === 0.5, `stacked: speed = 0.5`);
assert(stacked2.size === 2.0, `stacked: size = 2.0`);
assert(stacked2.invincible === true, `stacked: invincible`);
assert(stacked2.destroysPipes === false, `stacked: no pipe destruction without star`);
```

- [ ] **Step 3: Run full test suite**

```bash
npm run test:powerups && npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-powerups.ts scripts/test-replay.ts
git commit -m "test: edge case coverage for safe expiry and effect stacking"
```
