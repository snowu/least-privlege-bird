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

// ── State ───────────────────────────────────────────────────────────────────
export interface Pipe { x: number; topH: number; gap: number; scored: boolean; }

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
  return Math.max(C.PIPE_GAP_MIN, C.PIPE_GAP_MAX - speedLevel(s) * C.PIPE_GAP_STEP);
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

function collides(s: GameState): boolean {
  const r = C.PLAYER_SIZE / 2 - 4;
  const px = C.PLAYER_X, py = s.player.y;
  if (py - r <= 0 || py + r >= C.GROUND) return true;
  for (const p of s.pipes) {
    if (px + r > p.x && px - r < p.x + C.PIPE_W) {
      if (py - r < p.topH || py + r > p.topH + p.gap) return true;
    }
  }
  return false;
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
export interface StepResult { scored: boolean; dead: boolean; }

export function step(s: GameState, flapped: boolean): StepResult {
  // INPUT before physics — mirrors event-driven flap landing before stepPhysics.
  if (flapped) s.player.vy = C.FLAP;

  // Start the speed-ramp clock on the first active tick. The pipe field is already
  // pre-filled at construction (see prefillField), so nothing to spawn here.
  if (s.lastSpeedUpTick === null) s.lastSpeedUpTick = s.tick;

  // Speed ramp (every SPEED_UP_TICKS ticks).
  if (s.tick - s.lastSpeedUpTick >= SPEED_UP_TICKS) {
    s.pipeSpeed += C.SPEED_UP_AMOUNT;
    s.lastSpeedUpTick = s.tick;
  }

  // Spawn pipes (interval in ms → ticks).
  if ((s.tick - (s.lastPipeTick as number)) * TICK_MS >= currentInterval(s)) spawnPipe(s);

  // Update pipes + scoring.
  let scored = false;
  for (const p of s.pipes) {
    p.x -= s.pipeSpeed;
    if (!p.scored && p.x + C.PIPE_W < C.PLAYER_X) { s.score++; p.scored = true; scored = true; }
  }
  s.pipes = s.pipes.filter(p => p.x + C.PIPE_W > 0);

  // Update player physics.
  s.player.vy += C.GRAVITY;
  s.player.y += s.player.vy;

  s.tick++;
  return { scored, dead: collides(s) };
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
