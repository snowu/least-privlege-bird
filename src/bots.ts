// ─── BOTS (AI racers) ─────────────────────────────────────────────────────────
// Bots are hosted by the room host's browser: each runs its own copy of the round's
// sim (same seed, same course) on a wall-clock fixed-timestep loop, and its state
// goes out through the same snapshot pipe as a human's, so every client sees them
// as ordinary racers. Nothing about them is trusted or validated — they're for fun
// and for testing rooms without a dozen volunteers.
//
// The brain is deliberately imperfect: it aims for the next gap's centre (where the
// coins and orbs float) plus a per-pipe error that shrinks with skill, reacts with
// a skill-dependent lag, and occasionally zones out. Crashes go to a fake quiz:
// "reading" time, then a right answer with probability ≈ skill, or a lockout and
// another go. Orbs it grabs get thrown at the racer ahead after a short "aim".
import { C, TICK_MS, step, type GameState, type Pipe } from './physics-core.ts';
import * as MP from './multiplayer.ts';

interface BotRun {
  id: string; skill: number;
  s: GameState;
  seen: WeakSet<Pipe>;               // pipes whose item has been judged (MP.passItems)
  phase: 'fly' | 'quiz' | 'fin';
  quizUntil: number;
  lastFlapTick: number;
  aimPipe: unknown; aimErr: number;  // per-pipe aiming error, rerolled each new pipe
  zoneOutUntil: number;              // tick until which the bot just… doesn't flap
  charges: number; throwAt: number;  // banked hex orbs, and when it'll throw the next
  nextHeckleAt: number;              // finished bots heckle on a cooldown instead
  dizzyUntil: number; blindUntil: number; mfaUntil: number; mfaEaten: boolean;
}

const DIZZY_WOBBLE_PX = 90;
const HECKLE_CD_MS = 4000;
let runs: BotRun[] = [];
let timer = 0;
let acc = 0, last = 0;

export const owns = (id: string) => runs.some(r => r.id === id);

export function start(seed: number) {
  stop();
  runs = MP.myBots
    .filter(b => MP.room.participants.includes(b.id))
    .map(b => ({
      id: b.id, skill: b.skill,
      s: MP.raceState(seed), seen: new WeakSet(),
      phase: 'fly', quizUntil: 0, lastFlapTick: -99,
      aimPipe: null, aimErr: 0, zoneOutUntil: 0,
      charges: 0, throwAt: 0, nextHeckleAt: 0,
      dizzyUntil: 0, blindUntil: 0, mfaUntil: 0, mfaEaten: false,
    }));
  if (!runs.length) return;
  acc = 0; last = performance.now();
  // setInterval, not rAF: bots keep racing while the host is on a quiz card or
  // the finish screen (rAF only runs while the game loop does).
  timer = window.setInterval(frame, 16);
}

export function stop() {
  clearInterval(timer);
  timer = 0;
  runs = [];
}

export function hex(id: string, kind: string) {
  const r = runs.find(x => x.id === id);
  if (!r || r.phase !== 'fly') return;
  const now = performance.now();
  MP.applySimHex(r.s, kind);
  // Render-only hexes become brain damage instead.
  if (kind === 'failover') r.dizzyUntil = now + 4000;
  if (kind === 'outage') r.blindUntil = now + 3500;
  if (kind === 'mfa') { r.mfaUntil = now + 4000; r.mfaEaten = false; }
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
  for (const r of runs) {
    if (r.phase === 'quiz' && now >= r.quizUntil) answerQuiz(r, now);
    maybeHex(r, now);
  }
}

function tick(r: BotRun, now: number) {
  if (r.phase !== 'fly') return;
  const flapped = decide(r, now);
  const res = step(r.s, flapped);
  if (res.dead) {
    r.phase = 'quiz';
    r.quizUntil = now + readingTime(r);
    MP.updateOwned(r.id, r.s, 'quiz', true);
    return;
  }
  if (MP.passItems(r.s, r.seen) === 'orb' && r.charges < MP.MAX_HEX_CHARGES) {
    r.charges++;
    r.throwAt = now + 800 + Math.random() * 2500;
  }
  if (r.s.dist >= MP.room.finishDist) {
    r.phase = 'fin';
    MP.updateOwned(r.id, r.s, 'fin', true, now - MP.room.raceStartAt);
    return;
  }
  MP.updateOwned(r.id, r.s, 'fly', flapped);
}

function decide(r: BotRun, now: number): boolean {
  const s = r.s;
  if (s.tick < r.zoneOutUntil) return false;
  if (Math.random() < (1 - r.skill) * 0.0025) { r.zoneOutUntil = s.tick + 25; return false; }

  // Target: next uncleared gap. Blind bots (outage) can only see pipes up close.
  const r0 = C.PLAYER_SIZE / 2;
  let pipe = s.pipes.find(p => p.x + C.PIPE_W > C.PLAYER_X - r0);
  if (pipe && now < r.blindUntil && pipe.x - C.PLAYER_X > 140) pipe = undefined;
  if (pipe !== r.aimPipe) {
    r.aimPipe = pipe;
    r.aimErr = pipe ? (Math.random() - 0.5) * pipe.gap * (1 - r.skill) * 0.9 : 0;
  }
  let target = pipe ? pipe.topH + pipe.gap * 0.55 + r.aimErr : C.GROUND / 2;
  if (now < r.dizzyUntil) target += Math.sin(now / 180) * DIZZY_WOBBLE_PX;

  const lag = 6 + Math.round((1 - r.skill) * 10);
  if (s.player.y < target || s.player.vy < 0 || s.tick - r.lastFlapTick < lag) return false;
  if (now < r.mfaUntil && (r.mfaEaten = !r.mfaEaten)) return false;
  r.lastFlapTick = s.tick;
  return true;
}

// Time spent "reading" the question: good bots skim, bad ones agonise.
function readingTime(r: BotRun) { return 1500 + Math.random() * 2000 + (1 - r.skill) * 2500; }

function answerQuiz(r: BotRun, now: number) {
  if (Math.random() < 0.4 + r.skill * 0.55) {
    MP.respawn(r.s);
    r.phase = 'fly';
    r.lastFlapTick = r.s.tick - 99;
    MP.updateOwned(r.id, r.s, 'fly', true);
  } else {
    r.quizUntil = now + 2000 + readingTime(r); // lockout + the next question
  }
}

// Racing bots throw banked orbs at whoever's just ahead; finished bots heckle the
// leader on a cooldown (they're competing for Chaos Monkey now).
function maybeHex(r: BotRun, now: number) {
  const kind = () => MP.HEX_KINDS[Math.floor(Math.random() * MP.HEX_KINDS.length)];
  if (r.phase === 'fly' && r.charges > 0 && now >= r.throwAt) {
    const target = MP.racerAhead(r.id, now);
    if (!target) return;
    r.charges--;
    r.throwAt = now + 1500 + Math.random() * 2000;
    MP.sendHex(r.id, target, kind());
  } else if (r.phase === 'fin' && now >= r.nextHeckleAt) {
    const leader = MP.standings(now).find(b => b.st === 'fly');
    if (!leader) return;
    r.nextHeckleAt = now + HECKLE_CD_MS + Math.random() * 3000;
    MP.sendHex(r.id, leader.id, kind());
  }
}
