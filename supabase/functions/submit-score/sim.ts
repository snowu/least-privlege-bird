// Authoritative game simulation — MUST stay in lockstep with game.js physics.
// A run is fully reproducible from { seed, flapTicks }; the server recomputes the
// score by replaying inputs, so a client cannot forge a number it didn't earn.

// Constants mirror game.js `C` (GROUND = H - HUD).
export const C = {
  W: 910, H: 730, HUD: 48,
  GRAVITY: 0.5, FLAP: -9,
  PIPE_W: 64,
  PIPE_GAP_MIN: 120, PIPE_GAP_MAX: 260, PIPE_GAP_STEP: 20,
  PIPE_SPEED: 2,
  PIPE_INTERVAL_MAX: 2200, PIPE_INTERVAL_MIN: 800, PIPE_INTERVAL_STEP: 300,
  SPEED_UP_INTERVAL: 5000, SPEED_UP_AMOUNT: 0.5,
  PLAYER_X: 120, PLAYER_SIZE: 40,
  GROUND: 730 - 48,
};

const TICK_MS = 1000 / 60;
const SPEED_UP_TICKS = C.SPEED_UP_INTERVAL / TICK_MS; // 300

// mulberry32 — identical to game.js. Same seed → same sequence.
function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_TICKS = 200000; // ~55min at 60Hz — runaway guard

// Replay a run from seed + the ticks on which the player flapped.
// Returns the true score and the tick the player died on.
export function simulate(seed: number, flapTicks: number[]): { score: number; deathTick: number } {
  const flaps = new Set(flapTicks);
  const player = { y: C.H / 2, vy: 0 };
  let pipes: { x: number; topH: number; gap: number; scored: boolean }[] = [];
  let score = 0;
  let pipeSpeed = C.PIPE_SPEED;
  let tick = 0;
  let lastSpeedUpTick: number | null = null;
  let lastPipeTick: number | null = null;
  const rng = mulberry32(seed);

  const speedLevel = () => Math.round((pipeSpeed - C.PIPE_SPEED) / C.SPEED_UP_AMOUNT);
  const currentGap = () => Math.max(C.PIPE_GAP_MIN, C.PIPE_GAP_MAX - speedLevel() * C.PIPE_GAP_STEP);
  const currentInterval = () => Math.max(C.PIPE_INTERVAL_MIN, C.PIPE_INTERVAL_MAX - speedLevel() * C.PIPE_INTERVAL_STEP);
  const spawnPipe = () => {
    const gap = currentGap();
    const minTop = 60;
    const maxTop = C.GROUND - gap - 60;
    const topH = minTop + rng() * (maxTop - minTop);
    pipes.push({ x: C.W, topH, gap, scored: false });
    lastPipeTick = tick;
  };
  const collides = () => {
    const r = C.PLAYER_SIZE / 2 - 4;
    const px = C.PLAYER_X, py = player.y;
    if (py - r <= 0 || py + r >= C.GROUND) return true;
    for (const p of pipes) {
      if (px + r > p.x && px - r < p.x + C.PIPE_W) {
        if (py - r < p.topH || py + r > p.topH + p.gap) return true;
      }
    }
    return false;
  };

  for (; tick < MAX_TICKS;) {
    // INPUT before physics — mirrors event-driven flap landing before stepPhysics.
    if (flaps.has(tick)) player.vy = C.FLAP;

    // stepPhysics
    if (lastSpeedUpTick === null) { lastSpeedUpTick = tick; lastPipeTick = tick; spawnPipe(); }
    if (tick - lastSpeedUpTick >= SPEED_UP_TICKS) { pipeSpeed += C.SPEED_UP_AMOUNT; lastSpeedUpTick = tick; }
    if ((tick - (lastPipeTick as number)) * TICK_MS >= currentInterval()) spawnPipe();
    for (const p of pipes) {
      p.x -= pipeSpeed;
      if (!p.scored && p.x + C.PIPE_W < C.PLAYER_X) { score++; p.scored = true; }
    }
    pipes = pipes.filter(p => p.x + C.PIPE_W > 0);
    player.vy += C.GRAVITY;
    player.y += player.vy;
    tick++;
    if (collides()) return { score, deathTick: tick };
  }
  return { score, deathTick: tick };
}
