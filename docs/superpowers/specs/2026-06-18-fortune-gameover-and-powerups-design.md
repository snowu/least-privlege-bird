# Fortune at Game-Over & Power-Up System

## Overview

Two features for Least Privilege Bird:

1. **Fortune at game-over** — replace the fake AWS error line on the game-over screen with the fortune text; keep the corner cowsay on the menu screen only.
2. **Power-up system** — floating collectibles in the playfield with AWS/IAM-themed effects that are always beneficial but come with comedic side effects. Deterministic and anti-cheat compatible.

---

## Feature 1: Fortune at Game-Over

### Current behavior

- `showScreen('gameover')` triggers `showFortuneCow()`, which fetches a fortune and renders an ASCII cowsay in the corner `<pre>` element (`#fortune-cow`).
- The game-over panel displays a fake AWS error code (`GO_ERRORS[score % 5]`) in `#go-errcode`.
- The cowsay also shows on the menu screen.

### New behavior

- **Game-over screen**: `showGameOver()` writes the fortune text (plain, no ASCII cow) into `#go-errcode`, replacing the fake AWS error. Styled identically — small monospace text under the score.
- **Menu screen**: cowsay remains in the corner as-is, unchanged.
- **showFortuneCow()** only fires when `name === 'menu'`, no longer on `'gameover'`.
- Fortune is fetched fresh on game-over via `fetchFortune()` directly in `showGameOver()`.
- **Fallback**: if the fortune fetch fails, fall back to a random `GO_ERRORS` entry so the line is never blank.

### Files changed

- `src/game.ts`: modify `showScreen()` to only call `showFortuneCow()` for `'menu'`; modify `showGameOver()` to fetch and display fortune in `#go-errcode`.

---

## Feature 2: Power-Up System

### Anti-cheat constraint

`physics-core.ts` is pure, deterministic, and shared between client rendering and server replay (`simulate()`). All power-up spawning, collision, effect application, and expiry **must live in physics-core** so the server can reproduce them from `{ seed, flapTicks }`. Only rendering (visual effects, sprite changes, HUD indicators) lives in `game.ts`.

### Data model

#### Power-up definitions (static registry in physics-core.ts)

```ts
interface PowerUpDef {
  id: string;
  durationTicks: number;
  gravityMul?: number;    // multiplier on C.GRAVITY
  flapMul?: number;       // multiplier on C.FLAP
  speedMul?: number;      // multiplier on pipe scroll speed
  gapMul?: number;        // multiplier on pipe gap at spawn time
  sizeMul?: number;       // multiplier on PLAYER_SIZE for collision
  invincible?: boolean;   // skip collision check
  destroysPipes?: boolean; // pipes touching player are removed
  weight?: number;        // spawn weight (default 1, lower = rarer)
  minSpeedLevel?: number; // earliest speed level this can appear
}
```

#### State additions (in GameState)

```ts
interface PowerUpItem {
  x: number;
  y: number;
  defId: string;
  collected: boolean;
}

interface ActiveEffect {
  defId: string;
  expiryTick: number;
}

// New fields on GameState:
powerUps: PowerUpItem[];
activeEffects: ActiveEffect[];
```

### The six power-ups

| ID | Name | Flavor text | Benefit | Side effect (physics) | Render-only side effect | Duration |
|---|---|---|---|---|---|---|
| `wildcard` | s3:* Wildcard Policy | "You granted full access. To everything." | Invincible | sizeMul: 2.0 (huge) | Flicker warning on expiry | 4s (240 ticks) |
| `autoscaling` | Auto-Scaling Group | "Scaling in response to demand..." | sizeMul: 0.6 (tiny, gaps easy) | flapMul: 1.8 (twitchy) | Flicker warning on expiry | 5s (300 ticks) |
| `cloudfront` | CloudFront Cache | "Serving from edge location..." | speedMul: 0.5 (pipes crawl) | — | Ghost/afterimage trail on bird | 5s (300 ticks) |
| `role-assumption` | IAM Role Assumption | "Assuming cross-account role..." | gapMul: 1.4 (wider gaps) | — | Avatar swaps to random theme | 4s (240 ticks) |
| `elb` | Elastic Load Balancer | "Distributing traffic across zones..." | gravityMul: 0.5 (floaty) | — | Horizontal wobble oscillation | 5s (300 ticks) |
| `star` | Superuser (sudo) | "sudo rm -rf /pipes" | Invincible, speedMul: 1.5, destroysPipes | — | Rainbow cycling tint, screen shake + particle burst on pipe break | 3.5s (210 ticks) |

### Spawning rules

- Uses seeded `s.rng()` for all decisions — deterministic, replayable.
- **First eligible spawn**: after 3–5 pipes have been scored (`s.score >= POWERUP_FIRST_PIPE`, default 3).
- **Trigger**: on each pipe spawn in `step()`, roll `s.rng()` against a spawn chance:
  - Base chance: 15%
  - Increases by 5% per `speedLevel`, capped at 40%
- **Max one uncollected power-up in the field** at a time (avoids clutter).
- **Type selection**: weighted `rng()` roll across eligible power-ups (filtered by `minSpeedLevel`). Star has weight 0.5 and `minSpeedLevel: 2`.
- **Position**: x is placed at a fixed offset ahead of the newly spawned pipe (`pipe.x + POWERUP_AHEAD_PX`, default 180px — roughly halfway to the next pipe at starting speed). y is a seeded `rng()` roll within the safe vertical band: `[60, C.GROUND - 60]`. Position is deterministic from the RNG stream.

### Collision detection

In `step()`, after pipe updates, check each uncollected power-up:

```
if player hitbox overlaps power-up position (circular, POWERUP_RADIUS = 20px):
  mark collected = true
  push ActiveEffect { defId, expiryTick: s.tick + def.durationTicks }
```

`step()` returns additional info so the renderer can trigger pickup visuals:

```ts
// Extended StepResult:
interface StepResult {
  scored: boolean;
  dead: boolean;
  collected?: string;          // defId of power-up just collected
  destroyedPipes?: number;     // count of pipes destroyed this tick (star)
  expiredEffects?: string[];   // defIds of effects that just expired
}
```

### Effect application

At the top of `step()`, before physics calculations, compute effective values by iterating `activeEffects`:

```
effectiveGravity = C.GRAVITY × Π(all active gravityMul)
effectiveFlap    = C.FLAP    × Π(all active flapMul)
effectiveSpeed   = pipeSpeed × Π(all active speedMul)
effectiveSize    = PLAYER_SIZE × Π(all active sizeMul)
invincible       = any active effect has invincible === true
destroysPipes    = any active effect has destroysPipes === true
```

Use `effectiveGravity` and `effectiveFlap` for player physics. Use `effectiveSpeed` for pipe movement. Use `effectiveSize` for collision radius. Use `invincible` to skip `collides()`. Gap multiplier (`gapMul`) applies at pipe spawn time (not retroactively).

**Pipe destruction (star)**: if `destroysPipes` is true and the player overlaps a pipe, mark that pipe `destroyed: true`, filter it from collision and scoring. Returned in `StepResult.destroyedPipes` for render effects.

**Stacking**: effects stack freely by multiplying their modifiers. Two gravity effects multiply together. Multiple invincibility sources are OR'd.

### Safe expiry

When an effect with `invincible` or `sizeMul` expires:

1. Compute what the new collision state would be (with the effect removed).
2. If `collides(s)` would return true with the restored hitbox, extend the effect by a grace window of 30 ticks (0.5s).
3. Re-check on each tick during the grace window. Effect fully expires as soon as the player is clear.
4. The grace extension is deterministic (computed in `step()`), so the server replays it identically.

### Expiry flicker warning

Last 90 ticks (~1.5s) of any effect with `sizeMul` or `invincible`: the renderer alternates the sprite between affected and normal scale every 6 frames. This is render-only — physics stays in the affected state until actual expiry tick. Applied to: Wildcard, Auto-Scaling, Star.

### Rendering (game.ts)

#### Power-up items in the field

- Drawn as small floating icons with a gentle sine-wave bob (amplitude ~4px, period ~1s).
- Each power-up type has a distinct color and simple geometric icon or pixel symbol.
- Subtle glow/pulse effect to attract attention.

#### Active effect HUD

- Small icon + countdown timer bar near the score area, one per active effect.
- Stacked vertically. Timer bar drains left-to-right as the effect approaches expiry.
- Flicker warning (icon blinks) during the last 1.5s for size/invincibility effects.

#### Per-effect visual side effects

| Effect | Render treatment |
|---|---|
| Wildcard | Sprite scale smoothly inflates to 2x on pickup. Flicker between 2x and 1x during expiry warning. |
| Auto-Scaling | Sprite scale smoothly shrinks to 0.6x. Flicker between 0.6x and 1x during expiry warning. |
| CloudFront | Trail of 4-5 afterimages at previous positions, fading in opacity. Slight stutter in flap animation (skip every 3rd frame). |
| Role Assumption | Avatar sprite/theme swaps to a random different theme on pickup. Reverts on expiry. |
| ELB | Bird draw position oscillates horizontally: `x + sin(tick * 0.15) * 8`. Purely visual — physics x is unchanged. |
| Star | Rainbow hue-rotate cycling on sprite (full spectrum over ~0.5s). On pipe destruction: particle burst (fragments falling with gravity) + brief screen shake (2-3 frames). Flicker between rainbow and normal during expiry warning. |

### Server replay compatibility

`simulate()` calls `step()` in a loop. Since power-up spawning, collection, effects, and safe expiry all happen inside `step()` using seeded RNG and deterministic tick logic, the server replay produces identical results. No changes needed to `simulate()` — it inherits power-up behavior automatically.

The extended `StepResult` fields (`collected`, `destroyedPipes`, `expiredEffects`) are ignored by the server — it only reads `score` and `dead`.

### Files changed

- `src/physics-core.ts`: power-up definitions registry, `PowerUpItem`/`ActiveEffect` interfaces, new fields on `GameState`, spawn logic in `step()`, collision detection, effect application, safe expiry, pipe destruction.
- `src/game.ts`: power-up item rendering, pickup animations, active effect HUD, per-effect visual side effects (flicker, afterimages, wobble, rainbow, screen shake, particle bursts).

### Extensibility

Adding a new power-up requires:
1. Add a `PowerUpDef` entry to the registry (physics-core.ts).
2. Add a render case for its visual side effect (game.ts).
3. Optionally add a new physics modifier field if the existing ones don't cover it.

No structural changes needed — the system iterates the registry and active effects generically.
