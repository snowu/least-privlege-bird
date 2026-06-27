// ─── PHYSICS CORE ───────────────────────────────────────────────────────────
// The single source of truth for gameplay physics. Both the browser game loop
// (src/game.ts) and the authoritative server replay (supabase submit-score)
// drive the SAME pure step function here, so they cannot drift.
//
// A run is fully reproducible from { seed, flapTicks }: fixed-timestep ticks +
// seeded PRNG mean the same inputs always produce the same score, regardless of
// frame rate or machine. The server recomputes the score by replaying inputs,
// so a client cannot forge a number it didn't earn.
//
// CRITICAL: nothing in this file may read wall-clock time, Math.random, or any
// render/DOM state. Determinism is the whole anti-cheat guarantee. Keep it pure.

// ── Constants ────────────────────────────────────────────────────────────────
// Sim-affecting constants live here. Render-only constants (HUD, SPRITE_SCALE,
// CLOUD_COUNT, COUNTDOWN_SEC) also live here for a single source of truth, but
// are never read by step()/simulate() — they're consumed only by the renderer.
export const C: { [k: string]: number } = {
  W: 1400, H: 830,          // canvas dimensions (pipes spawn at x=W)
  HUD: 48,                  // bottom bar height (render-only)
  GRAVITY: 0.5,
  FLAP: -9,
  PIPE_W: 64,
  PIPE_GAP_MIN: 120,        // tightest vertical gap (reached at max speed)
  PIPE_GAP_MAX: 260,        // widest vertical gap (at start)
  PIPE_GAP_STEP: 20,        // gap shrinks by this per speed level
  PIPE_SPEED: 2,            // initial pipe scroll speed (px/frame)
  PIPE_INTERVAL_MAX: 2200,  // ms between pipes at start
  PIPE_INTERVAL_MIN: 800,   // ms between pipes at max difficulty
  PIPE_INTERVAL_STEP: 300,  // interval shrinks by this per speed level
  SPEED_UP_INTERVAL: 5000,  // ms between each speed increase
  SPEED_UP_AMOUNT: 0.5,     // px/frame added each interval
  COUNTDOWN_SEC: 3,         // render-only: seconds counted down before play
  PLAYER_X: 120,
  FIRST_PIPE_X: 700,        // first pipe spawns mid-screen so it arrives ~4.8s in (vs ~10.7s at full width)
  PLAYER_SIZE: 40,          // collision box
  SPRITE_SCALE: 1.5,        // render-only: sprite drawn bigger than the hitbox
  GROUND: 0,                // y of ground = H - HUD (computed below)
  CLOUD_COUNT: 6,           // render-only
};
C.GROUND = C.H - C.HUD;

// ── Power-Up System ──────────────────────────────────────────────────────────
C.POWERUP_RADIUS = 20;
C.POWERUP_FIRST_PIPE = 3;
C.POWERUP_BASE_CHANCE = 0.35;
C.POWERUP_CHANCE_PER_LEVEL = 0.05;
C.POWERUP_CHANCE_CAP = 0.60;
C.POWERUP_AHEAD_PX = 180;
C.POWERUP_GRACE_TICKS = 30;

export const TICK_MS = 1000 / 60;                          // fixed physics step
export const SPEED_UP_TICKS = C.SPEED_UP_INTERVAL / TICK_MS; // ticks between speed bumps

// ── PRNG ──────────────────────────────────────────────────────────────────────
// mulberry32 — tiny deterministic PRNG. Same seed → same sequence.
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Power-Up Definitions ────────────────────────────────────────────────────
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
  { id: 'autoscaling',     durationTicks: 300, sizeMul: 0.6, flapMul: 1.3 },
  { id: 'cloudfront',      durationTicks: 300, speedMul: 0.5 },
  { id: 'role-assumption', durationTicks: 240, gapMul: 1.4 },
  { id: 'elb',             durationTicks: 300, gravityMul: 0.5 },
  { id: 'star',            durationTicks: 210, speedMul: 1.5, invincible: true, destroysPipes: true, weight: 0.5, minSpeedLevel: 2 },
];

// ── State ───────────────────────────────────────────────────────────────────
export interface Pipe { x: number; topH: number; gap: number; scored: boolean; }
export interface PowerUpItem { x: number; y: number; defId: string; collected: boolean; }
export interface ActiveEffect { defId: string; expiryTick: number; }

// The full gameplay state. The renderer reads y/vy/pipes/score/pipeSpeed to draw,
// but never mutates them — only step() does.
export interface GameState {
  player: { y: number; vy: number };
  pipes: Pipe[];
  score: number;
  pipeSpeed: number;
  tick: number;
  lastSpeedUpTick: number | null;  // null until the first active tick
  lastPipeTick: number | null;
  rng: () => number;
  powerUps: PowerUpItem[];
  activeEffects: ActiveEffect[];
}

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
  prefillField(s);   // pipes exist from construction so they render during the countdown
  return s;
}

// Pre-fill the field so the stream is already on-screen (rendered during countdown and
// arriving ~6s sooner): pipes at their natural spacing, nearest at FIRST_PIPE_X out to
// the right edge. Phases lastPipeTick so the first edge spawn keeps the rhythm (no seam).
// Draws rng once per pipe in order — identical on client + server (determinism intact).
function prefillField(s: GameState): void {
  const intervalTicks = currentInterval(s) / TICK_MS;
  const spacing = s.pipeSpeed * intervalTicks;           // px between pipes at start
  const xs: number[] = [];
  for (let x = C.FIRST_PIPE_X; x <= C.W; x += spacing) xs.push(x);
  for (const x of xs) spawnPipe(s, x);                   // nearest → farthest (left→right)
  const xr = xs[xs.length - 1];
  s.lastPipeTick = -Math.round((C.W - xr) / s.pipeSpeed); // virtual: spawned before tick 0
}

// ── Difficulty ramp ───────────────────────────────────────────────────────────
// Exported: the renderer shows speedLevel+1 as the "Spd" HUD readout.
export function speedLevel(s: GameState): number {
  return Math.round((s.pipeSpeed - C.PIPE_SPEED) / C.SPEED_UP_AMOUNT);
}
export function currentGap(s: GameState): number {
  const baseGap = Math.max(C.PIPE_GAP_MIN, C.PIPE_GAP_MAX - speedLevel(s) * C.PIPE_GAP_STEP);
  let gapMul = 1;
  for (const e of s.activeEffects) {
    const d = POWERUP_DEFS.find(p => p.id === e.defId);
    if (d?.gapMul) gapMul *= d.gapMul;
  }
  return baseGap * gapMul;
}
function currentInterval(s: GameState): number {
  return Math.max(C.PIPE_INTERVAL_MIN, C.PIPE_INTERVAL_MAX - speedLevel(s) * C.PIPE_INTERVAL_STEP);
}

function spawnPipe(s: GameState, x: number = C.W): void {
  const gap = currentGap(s);
  const minTop = 60;
  const maxTop = C.GROUND - gap - 60;
  const topH = minTop + s.rng() * (maxTop - minTop); // seeded → reproducible
  s.pipes.push({ x, topH, gap, scored: false });
  s.lastPipeTick = s.tick;
}

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

  const pipe = s.pipes[s.pipes.length - 1];
  const gapCenter = pipe.topH + pipe.gap / 2;
  const offset = (s.rng() - 0.5) * 60;
  const y = Math.max(60, Math.min(C.GROUND - 60, gapCenter + offset));
  s.powerUps.push({ x: pipeX + C.POWERUP_AHEAD_PX, y, defId: chosen.id, collected: false });
}

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

// ── Effective multipliers ───────────────────────────────────────────────────
// Compute the effective physics multipliers by stacking all active effects.
// Returns absolute values for gravity/flap (already multiplied), multipliers for speed/size.
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

// ── The one physics tick ──────────────────────────────────────────────────────
// Advance physics exactly one fixed tick. Deterministic: depends only on the
// state's tick count + seeded rng + whether the player flapped this tick — never
// on wall-clock or frame rate.
//
// `flapped` is the input for THIS tick (mirrors event-driven flap landing before
// stepPhysics). Returns whether a pipe was passed this tick (for the score SFX,
// fired by the caller — the core stays side-effect-free) and whether the player
// died. Score is already incremented in state when `scored` is true.
export interface StepResult {
  scored: boolean;
  dead: boolean;
  collected?: string;
  destroyedPipes?: number;
  expiredEffects?: string[];
}

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
      let testSizeMul = 1;
      for (const te of testEffects) {
        const td = POWERUP_DEFS.find(d => d.id === te.defId);
        if (td?.sizeMul) testSizeMul *= td.sizeMul;
      }
      const testSize = (C.PLAYER_SIZE * testSizeMul) / 2 - 4;
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

  // Start the speed-ramp clock on the first active tick. The pipe field is already
  // pre-filled at construction (see prefillField), so nothing to spawn here.
  if (s.lastSpeedUpTick === null) s.lastSpeedUpTick = s.tick;

  // Speed ramp (every SPEED_UP_TICKS ticks).
  if (s.tick - s.lastSpeedUpTick >= SPEED_UP_TICKS) {
    s.pipeSpeed += C.SPEED_UP_AMOUNT;
    s.lastSpeedUpTick = s.tick;
  }

  // Spawn pipes + maybe power-ups (interval in ms → ticks).
  if ((s.tick - (s.lastPipeTick as number)) * TICK_MS >= currentInterval(s)) {
    spawnPipe(s);
    // Power-up spawn check — only after enough pipes scored, and only if no
    // uncollected power-up is already on the field.
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

  // Update pipes + scoring (with effective speed).
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
    const r = (C.PLAYER_SIZE * eff.size) / 2 - 4;
    for (const p of s.pipes) {
      if (C.PLAYER_X + r > p.x && C.PLAYER_X - r < p.x + C.PIPE_W) {
        destroyedPipes++;
      }
    }
    s.pipes = s.pipes.filter(p => {
      if (C.PLAYER_X + r > p.x && C.PLAYER_X - r < p.x + C.PIPE_W) return false;
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

  // Update player physics with effective values.
  s.player.vy += eff.gravity;
  s.player.y += s.player.vy;

  s.tick++;

  // Collision (skip if invincible)
  const dead = eff.invincible ? false : collides(s);

  return { scored, dead, collected, destroyedPipes: destroyedPipes || undefined, expiredEffects: expiredEffects.length ? expiredEffects : undefined };
}

const MAX_TICKS = 200000; // ~55min at 60Hz — runaway guard

// ── Authoritative replay ────────────────────────────────────────────────────
// Replay a run from seed + the ticks on which the player flapped. Returns the
// true score and the tick the player died on. This is what the server trusts.
export function simulate(seed: number, flapTicks: number[]): { score: number; deathTick: number } {
  const flaps = new Set(flapTicks);
  const s = createState(seed);
  while (s.tick < MAX_TICKS) {
    const { dead } = step(s, flaps.has(s.tick));
    if (dead) return { score: s.score, deathTick: s.tick };
  }
  return { score: s.score, deathTick: s.tick };
}
