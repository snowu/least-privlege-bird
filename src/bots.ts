// ─── BOTS (AI racers) ─────────────────────────────────────────────────────────
// Bots are hosted by the room host's browser: each runs its own copy of the round's
// sim (same seed, same course) on a wall-clock fixed-timestep loop, and its state
// goes out through the same snapshot pipe as a human's, so every client sees them
// as ordinary racers. Nothing about them is trusted or validated — they're for fun
// and for testing rooms without a dozen volunteers.
//
// The brain is deliberately imperfect: it aims for the next gap's centre (where the
// coins float) plus a per-pipe error that shrinks with skill, reacts with a
// skill-dependent lag, and occasionally zones out — so it bonks like a human would.
import { C, TICK_MS, step, type GameState, type Pipe } from './physics-core.ts';
import * as MP from './multiplayer.ts';

interface BotRun {
  id: string; skill: number;
  s: GameState;
  seen: WeakSet<Pipe>;               // pipes whose coin has been judged (MP.passItems)
  done: boolean;                     // crossed the line
  lastFlapTick: number;
  aimPipe: unknown; aimErr: number;  // per-pipe aiming error, rerolled each new pipe
  zoneOutUntil: number;              // tick until which the bot just… doesn't flap
}

let runs: BotRun[] = [];
let timer = 0;
let acc = 0, last = 0;

export function start(seed: number) {
  stop();
  runs = MP.myBots
    .filter(b => MP.room.participants.includes(b.id))
    .map(b => ({
      id: b.id, skill: b.skill,
      s: MP.raceState(seed), seen: new WeakSet(),
      done: false, lastFlapTick: -99,
      aimPipe: null, aimErr: 0, zoneOutUntil: 0,
    }));
  if (!runs.length) return;
  acc = 0; last = performance.now();
  // setInterval, not rAF: bots keep racing while the host is on the finish screen
  // (rAF only runs while the game loop does).
  timer = window.setInterval(frame, 16);
}

export function stop() {
  clearInterval(timer);
  timer = 0;
  runs = [];
}

function frame() {
  const now = performance.now();
  if (now < MP.room.raceStartAt) { last = now; return; }
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= TICK_MS) {
    for (const r of runs) tick(r, now);
    acc -= TICK_MS;
  }
}

function tick(r: BotRun, now: number) {
  if (r.done) return;
  const flapped = decide(r);
  const bonked = step(r.s, flapped).dead;
  if (bonked) { MP.bonk(r.s); MP.noteBonk(r.id); }
  MP.passItems(r.s, r.seen, r.id);
  if (r.s.dist >= MP.room.finishDist) {
    r.done = true;
    MP.updateOwned(r.id, r.s, 'fin', true, now - MP.room.raceStartAt);
    return;
  }
  MP.updateOwned(r.id, r.s, 'fly', flapped || bonked);
}

function decide(r: BotRun): boolean {
  const s = r.s;
  if (s.tick < r.zoneOutUntil) return false;
  if (Math.random() < (1 - r.skill) * 0.0025) { r.zoneOutUntil = s.tick + 25; return false; }

  const r0 = C.PLAYER_SIZE / 2;
  const pipe = s.pipes.find(p => p.x + C.PIPE_W > C.PLAYER_X - r0);
  if (pipe !== r.aimPipe) {
    r.aimPipe = pipe;
    r.aimErr = pipe ? (Math.random() - 0.5) * pipe.gap * (1 - r.skill) * 0.9 : 0;
  }
  const target = pipe ? pipe.topH + pipe.gap * 0.55 + r.aimErr : C.GROUND / 2;

  const lag = 6 + Math.round((1 - r.skill) * 10);
  if (s.player.y < target || s.player.vy < 0 || s.tick - r.lastFlapTick < lag) return false;
  r.lastFlapTick = s.tick;
  return true;
}
