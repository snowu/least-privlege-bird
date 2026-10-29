// ─── MULTIPLAYER (Supabase Realtime) ──────────────────────────────────────────
// A room is a Realtime channel: presence = who is in the lobby, broadcast = round
// start + bird snapshots + hexes. No tables, no edge functions — the channel IS the
// room, and it evaporates when the last player leaves.
//
// Rounds are RACES over a fixed distance. Everyone flies the SAME seed (power-up
// rng split off, see createState) with race pacing (RACE_OPTS: start fast, capped
// ramp). Crashing doesn't knock you out — you answer an AWS question and respawn
// where you crashed, so a crash costs wall-clock time. Coins in the gaps boost you
// forward (overtaking by skill); hex orbs give you a curse to throw at the racer
// just ahead, and a crash it causes within HEX_CREDIT_MS is credited to you.
//
// Remote birds are dead-reckoned: each client sends a snapshot of the birds it owns
// (itself + any bots it hosts) on every flap plus a slow heartbeat, batched into one
// message per 50ms, and receivers extrapolate gravity + distance in between.
//
// Multiplayer runs never touch the leaderboard: the server replay doesn't know
// about race options, respawns or hexes, so it would (correctly) reject them.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './scores.ts';
import {
  C, TICK_MS, SPEED_UP_TICKS, defOf, createState, mulberry32,
  type GameState, type Pipe, type StateOpts,
} from './physics-core.ts';
import { AVATAR_KEYS } from './avatars-meta.ts';

export type BirdState = 'fly' | 'quiz' | 'fin' | 'gone';

export interface Peer {
  id: string; name: string; avatar: string; joinedAt: number; wins: number;
  bot?: boolean; owner?: string;
}

// One racer in the current round — remote humans, remote bots, my bots and me.
// Birds I own are updated locally every tick; the rest come off the wire.
export interface Bird {
  id: string; name: string; avatar: string; bot: boolean; owner: string;
  y: number; vy: number; g: number; size: number;  // last snapshot (post-step state)
  score: number;
  dist: number;            // px of course flown = race position
  sp: number;              // current scroll speed (px/tick), for extrapolating dist
  at: number;              // performance.now() the snapshot was taken/received
  st: BirdState;
  finishMs: number;        // race time (crash/quiz time included) once st === 'fin'
  takedowns: number;       // crashes caused by this bird's hexes this round
  dispY: number;           // smoothed render y (render-only)
}

export interface RoundResult {
  id: string; name: string; avatar: string; bot: boolean;
  finished: boolean; finishMs: number; progress: number; score: number; takedowns: number;
}

export interface Handlers {
  onLobby(): void;                                      // presence/round status changed
  onStart(seed: number): void;                          // a round I'm in is starting
  onRoundEnd(results: RoundResult[]): void;             // race over
  onHex(from: Bird, to: Bird, kind: string): void;      // someone hexed someone (any pair)
  onTakedown(from: Bird, to: Bird, kind: string): void; // …and it made them crash
}

// Race pacing: start where single-player is ~15s in, cap the ramp, put the first
// pipe close — and widen the gaps so "fast" doesn't mean "quiz marathon".
export const RACE_OPTS = { splitPowerUpRng: true, startLevel: 3, maxSpeedLevel: 6, firstPipeX: 480, gapMul: 1.25 } satisfies StateOpts;
// Nominal length = seconds a clean, boost-free run takes. Coins make it shorter.
export const RACE_LENGTHS = { sprint: 30, standard: 45, marathon: 75 };
export const HEX_KINDS = ['yank', 'throttled', 'bloat', 'failover', 'outage', 'mfa'];
export const MAX_HEX_CHARGES = 2;
export const ITEM_GRAB_PX = 34;     // how close to the gap centre you must pass to grab its item

const HEX_CREDIT_MS = 3500;    // a crash this soon after a hex counts as a takedown
const SEND_EVERY_MS = 50;      // batch window for outgoing snapshots
const HEARTBEAT_MS = 400;      // re-sync each owned bird at least this often
const STALE_MS = 4000;         // no word for this long → treat as disconnected
const FINISH_GRACE_MS = 30000; // race closes this long after the first finisher
const HARD_CAP_MS = 180000;    // …or this long past the nominal race length
const MAX_BOTS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — read aloud on a call
const BOT_NAMES = [
  'Clippy', 'Kevin from Billing', 'NAT Gateway', 'Lambda Cold Start', 'Terraform Plan',
  'Root Account', 'Chaos Monkey', 'us-east-1', 'Jeff (bot)', 'Intern #47',
  'Legacy Monolith', 'YAML Engineer', 'On-call Pager', 'CloudWatch Alarm', 'Sev-2',
];

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let handlers: Handlers | null = null;
let checkTimer = 0, sendTimer = 0, trackTimer = 0;
const dirty = new Set<string>();      // owned birds that flapped since the last send
const lastSent = new Map<string, number>();
const lastHexed = new Map<string, { from: string; kind: string; at: number }>(); // target → last hex

const me = { id: crypto.randomUUID(), name: '', avatar: 'penguin', joinedAt: 0, wins: 0 };
// Bots this client hosts. They ride in my presence meta so everyone lists them.
export const myBots: Array<{ id: string; name: string; avatar: string; wins: number; skill: number }> = [];

export const room = {
  code: '',
  peers: [] as Peer[],          // humans by join time (first = host), each followed by its bots
  round: 0,
  roundLive: false,
  seed: 0,
  raceSec: RACE_LENGTHS.standard,
  finishDist: 1,
  raceStartAt: 0,               // performance.now() when the countdown hits GO
  firstFinishAt: 0,
  participants: [] as string[],
  birds: new Map<string, Bird>(),
  lastResults: [] as RoundResult[],
};

export const myId = () => me.id;
export const inRoom = () => !!channel;
export const inRound = () => room.roundLive && room.participants.includes(me.id);
export const owns = (id: string) => id === me.id || myBots.some(b => b.id === id);
export function isHost() { return humans().length > 0 && humans()[0].id === me.id; }
const humans = () => room.peers.filter(p => !p.bot);

export function newRoomCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export async function joinRoom(code: string, name: string, avatar: string, h: Handlers): Promise<void> {
  if (channel) await leaveRoom();
  handlers = h;
  me.name = name; me.avatar = avatar; me.joinedAt = Date.now(); me.wins = 0;
  myBots.length = 0;
  room.code = code; room.peers = []; room.round = 0; room.roundLive = false;
  room.participants = []; room.birds = new Map(); room.lastResults = [];

  // realtime-js throttles sends to 10/s by default; we batch to ≤20/s per client.
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 30 } } });
  const ch = client.channel(`lpb-room-${code}`, {
    config: { broadcast: { self: false }, presence: { key: me.id } },
  });
  ch.on('presence', { event: 'sync' }, onPresence)
    .on('broadcast', { event: 'start' }, ({ payload }) => onStart(payload))
    .on('broadcast', { event: 'snaps' }, ({ payload }) => onSnaps(payload))
    .on('broadcast', { event: 'hex' },   ({ payload }) => onHex(payload));

  await new Promise<void>((resolve, reject) => {
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
    });
  });
  channel = ch;
  await publishPresence();
  checkTimer = window.setInterval(checkRound, 500);
  sendTimer = window.setInterval(flushSnaps, SEND_EVERY_MS);
}

export async function leaveRoom(): Promise<void> {
  clearInterval(checkTimer);
  clearInterval(sendTimer);
  clearTimeout(trackTimer);
  const ch = channel;
  channel = null; handlers = null;
  room.code = ''; room.roundLive = false; room.peers = [];
  myBots.length = 0;
  if (ch && client) await client.removeChannel(ch);
}

// Presence updates are debounced: mashing "add bot" shouldn't re-announce us five
// times in a second (each re-track briefly churns everyone's presence state).
function track() {
  clearTimeout(trackTimer);
  trackTimer = window.setTimeout(publishPresence, 200);
}
function publishPresence() {
  return channel?.track({
    id: me.id, name: me.name, avatar: me.avatar, joinedAt: me.joinedAt, wins: me.wins,
    bots: myBots.map(({ id, name, avatar, wins }) => ({ id, name, avatar, wins })),
  });
}

export function setAvatar(avatar: string) {
  me.avatar = avatar;
  if (channel) track();
}

// ── Host: bots + rounds ───────────────────────────────────────────────────────
export function addBot() {
  if (!channel || !isHost() || myBots.length >= MAX_BOTS) return;
  const taken = new Set([...room.peers, ...myBots].map(p => p.name)); // presence lags clicks
  const name = BOT_NAMES.find(n => !taken.has(n)) ?? `Bot ${myBots.length + 1}`;
  const avatar = AVATAR_KEYS[Math.floor(Math.random() * AVATAR_KEYS.length)];
  // Skill spread so a lobby of bots has a pack: some crash constantly, some rarely.
  const skill = 0.35 + Math.random() * 0.6;
  myBots.push({ id: `bot-${crypto.randomUUID()}`, name, avatar, wins: 0, skill });
  track();
}

export function removeBot() {
  if (!channel || room.roundLive) return;
  myBots.pop();
  track();
}

export function startRound(raceSec: number) {
  if (!channel || !isHost() || room.roundLive) return;
  const payload = {
    round: room.round + 1,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    ids: room.peers.map(p => p.id),
    raceSec,
  };
  channel.send({ type: 'broadcast', event: 'start', payload });
  onStart(payload); // broadcast.self is off — apply it locally too
}

// ── Course ────────────────────────────────────────────────────────────────────
export const raceState = (seed: number) => createState(seed, RACE_OPTS);

// Distance a clean, boost-free run covers in `sec` seconds under RACE_OPTS pacing
// (mirrors step()'s ramp: +SPEED_UP_AMOUNT every SPEED_UP_TICKS, up to the cap).
export function courseLength(sec: number): number {
  let speed = C.PIPE_SPEED + RACE_OPTS.startLevel * C.SPEED_UP_AMOUNT;
  const top = C.PIPE_SPEED + RACE_OPTS.maxSpeedLevel * C.SPEED_UP_AMOUNT;
  let dist = 0;
  for (let t = 0; t < sec * 60; t++) {
    if (t > 0 && t % Math.round(SPEED_UP_TICKS) === 0 && speed < top) speed += C.SPEED_UP_AMOUNT;
    dist += speed;
  }
  return dist;
}

// What floats in pipe n's gap: deterministic from the round seed + spawn index,
// so every racer sees the same coins/orbs on the same pipes.
export function itemFor(n: number): 'coin' | 'orb' | null {
  if (n < 1) return null;
  const r = mulberry32((room.seed ^ Math.imul(n, 0x9E3779B1)) >>> 0)();
  return r < 0.45 ? 'coin' : r < 0.62 ? 'orb' : null;
}

// Call after each step: as a pipe's centre passes the bird, grab its item if the
// bird threads the gap close to centre. Coins boost on the spot; orbs are returned
// for the caller to bank as a hex charge. `seen` remembers pipes already judged.
export function passItems(s: GameState, seen: WeakSet<Pipe>): 'coin' | 'orb' | null {
  let got: 'coin' | 'orb' | null = null;
  for (const p of s.pipes) {
    if (seen.has(p) || p.x + C.PIPE_W / 2 > C.PLAYER_X) continue;
    seen.add(p);
    const item = itemFor(p.n);
    if (!item || Math.abs(s.player.y - (p.topH + p.gap / 2)) > ITEM_GRAB_PX) continue;
    if (item === 'coin') {
      const boost = s.activeEffects.find(e => e.defId === 'boost');
      const until = s.tick + defOf('boost')!.durationTicks;
      if (boost) boost.expiryTick = until; else s.activeEffects.push({ defId: 'boost', expiryTick: until });
    }
    got = item;
  }
  return got;
}

// ── Owned birds → wire ────────────────────────────────────────────────────────
// Call every sim tick (and on state changes) for each bird this client owns.
// `urgent` (a flap or a state change) gets it into the next 50ms batch; otherwise
// it rides the heartbeat.
export function updateOwned(id: string, s: GameState, st: BirdState, urgent = false, finishMs = 0) {
  const b = room.birds.get(id);
  if (!b || !room.roundLive || b.st === 'fin' || b.st === 'gone') return;
  let g = C.GRAVITY, size = 1, speed = 1;
  for (const e of s.activeEffects) {
    const d = defOf(e.defId);
    if (d?.gravityMul) g *= d.gravityMul;
    if (d?.sizeMul) size *= d.sizeMul;
    if (d?.speedMul) speed *= d.speedMul;
  }
  const crashed = st === 'quiz' && b.st === 'fly';
  Object.assign(b, {
    y: s.player.y, vy: s.player.vy, g, size, score: s.score,
    dist: s.dist, sp: s.pipeSpeed * speed, st, finishMs, at: performance.now(),
  });
  if (st === 'fin' && !room.firstFinishAt) room.firstFinishAt = performance.now();
  if (crashed) creditCrash(b);
  if (urgent) dirty.add(id);
  if (st === 'fin') checkRound();
}

function flushSnaps() {
  if (!channel || !room.roundLive) return;
  const now = performance.now();
  const out = [];
  for (const id of [me.id, ...myBots.map(b => b.id)]) {
    const b = room.birds.get(id);
    if (!b || b.st === 'gone') continue;
    if (!dirty.has(id) && now - (lastSent.get(id) ?? 0) < HEARTBEAT_MS) continue;
    dirty.delete(id);
    lastSent.set(id, now);
    out.push({ id, st: b.st, y: b.y, vy: b.vy, g: b.g, size: b.size, score: b.score, d: b.dist, sp: b.sp, fm: b.finishMs });
  }
  if (out.length) channel.send({ type: 'broadcast', event: 'snaps', payload: { round: room.round, birds: out } });
}

// Throw a hex (from me or one of my bots) at another racer. Everyone gets it for
// the kill feed; only the target's owner applies it.
export function sendHex(from: string, to: string, kind: string) {
  if (!channel || !room.roundLive) return;
  const payload = { round: room.round, from, to, kind };
  channel.send({ type: 'broadcast', event: 'hex', payload });
  onHex(payload);
}

// ── Wire → state ──────────────────────────────────────────────────────────────
function onPresence() {
  if (!channel) return;
  const state = channel.presenceState() as Record<string, any[]>;
  const metas = Object.values(state)
    .map(m => m[0])
    .filter(p => p && p.id)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  room.peers = metas.flatMap(p => [
    { id: p.id, name: p.name, avatar: p.avatar, joinedAt: p.joinedAt, wins: p.wins },
    ...(p.bots ?? []).map(b => ({ ...b, joinedAt: p.joinedAt, bot: true, owner: p.id })),
  ]);
  for (const p of room.peers) {
    const b = room.birds.get(p.id);
    if (b) { b.name = p.name; b.avatar = p.avatar; }
  }
  checkRound();
  handlers?.onLobby();
}

function onStart(p: { round: number; seed: number; ids: string[]; raceSec: number }) {
  if (p.round <= room.round && room.roundLive) return; // duplicate/stale
  room.round = p.round;
  room.roundLive = true;
  room.seed = p.seed;
  room.raceSec = p.raceSec;
  room.finishDist = courseLength(p.raceSec);
  room.participants = p.ids;
  room.birds = new Map();
  room.firstFinishAt = 0;
  dirty.clear();
  lastSent.clear();
  lastHexed.clear();
  // Snapshots don't flow during the countdown — start the staleness clock after it.
  room.raceStartAt = performance.now() + C.COUNTDOWN_SEC * 1000;
  for (const id of p.ids) {
    const peer = room.peers.find(x => x.id === id);
    room.birds.set(id, {
      id, name: peer?.name ?? '???', avatar: peer?.avatar ?? 'penguin',
      bot: !!peer?.bot, owner: peer?.owner ?? id,
      y: C.H / 2, vy: 0, g: 0, size: 1, score: 0, dist: 0, sp: 0, at: room.raceStartAt,
      st: 'fly', finishMs: 0, takedowns: 0, dispY: C.H / 2,
    });
  }
  if (p.ids.includes(me.id)) handlers?.onStart(p.seed);
  handlers?.onLobby();
}

function onSnaps(p: { round: number; birds: Array<{ id: string; st: BirdState; y: number; vy: number; g: number; size: number; score: number; d: number; sp: number; fm: number }> }) {
  if (p.round !== room.round) return;
  const now = performance.now();
  for (const s of p.birds) {
    if (owns(s.id)) continue;
    const b = room.birds.get(s.id);
    if (!b || b.st === 'fin' || b.st === 'gone') continue;
    const crashed = s.st === 'quiz' && b.st === 'fly';
    Object.assign(b, { y: s.y, vy: s.vy, g: s.g, size: s.size, score: s.score, dist: s.d, sp: s.sp, st: s.st, finishMs: s.fm, at: now });
    if (s.st === 'fin' && !room.firstFinishAt) room.firstFinishAt = now;
    if (crashed) creditCrash(b);
  }
  checkRound();
}

function onHex(p: { round: number; from: string; to: string; kind: string }) {
  if (p.round !== room.round || !room.roundLive) return;
  const from = room.birds.get(p.from), to = room.birds.get(p.to);
  if (!from || !to || to.st !== 'fly') return;
  lastHexed.set(to.id, { from: from.id, kind: p.kind, at: performance.now() });
  handlers?.onHex(from, to, p.kind);
}

// A bird just crashed: if a hex hit it moments ago, that's the thrower's takedown.
// Every client runs this on the same events, so tallies agree (modulo latency).
function creditCrash(victim: Bird) {
  const h = lastHexed.get(victim.id);
  if (!h || performance.now() - h.at > HEX_CREDIT_MS) return;
  lastHexed.delete(victim.id);
  const from = room.birds.get(h.from);
  if (!from) return;
  from.takedowns++;
  handlers?.onTakedown(from, victim, h.kind);
}

// Drops racers who left or went silent, and closes the race once nobody's racing,
// FINISH_GRACE_MS after the winner, or at the hard cap.
function checkRound() {
  if (!room.roundLive) return;
  const now = performance.now();
  const present = new Set(room.peers.map(p => p.id));
  for (const b of room.birds.values()) {
    if (b.st === 'fin' || b.st === 'gone' || owns(b.id)) continue;
    if (!present.has(b.id) || now - b.at > STALE_MS) b.st = 'gone';
  }
  const racing = [...room.birds.values()].some(b => b.st === 'fly' || b.st === 'quiz');
  const graceOver = room.firstFinishAt && now - room.firstFinishAt > FINISH_GRACE_MS;
  const capped = now - room.raceStartAt > room.raceSec * 1000 + HARD_CAP_MS;
  if (racing && !graceOver && !capped) return;

  room.roundLive = false;
  room.lastResults = standings(now).map(b => ({
    id: b.id, name: b.name, avatar: b.avatar, bot: b.bot, finished: b.st === 'fin',
    finishMs: b.finishMs, progress: progress(b, now), score: b.score, takedowns: b.takedowns,
  }));
  // Everyone computes the same winner from (nearly) the same results; each client
  // bumps only the tallies it owns and republishes them via presence.
  const w = room.lastResults[0];
  if (w && (w.finished || w.progress > 0)) {
    if (w.id === me.id) me.wins++;
    const bot = myBots.find(b => b.id === w.id);
    if (bot) bot.wins++;
    if (owns(w.id)) track();
  }
  handlers?.onRoundEnd(room.lastResults);
  handlers?.onLobby();
}

// ── Queries for the renderer ──────────────────────────────────────────────────
// Dead-reckon a bird from its last post-step snapshot: each tick does vy += g then
// y += vy, so after n ticks y = y0 + n·vy0 + g·n(n+1)/2; distance grows by its
// scroll speed. Only flying remote birds move.
export function extrapolate(b: Bird, now: number): { y: number; vy: number; dist: number } {
  if (b.st !== 'fly' || owns(b.id)) return { y: b.y, vy: b.vy, dist: b.dist };
  const n = Math.max(0, (now - b.at) / TICK_MS);
  const floor = C.GROUND - (C.PLAYER_SIZE * b.size) / 2;
  return {
    y: Math.min(floor, b.y + b.vy * n + b.g * n * (n + 1) / 2),
    vy: b.vy + b.g * n,
    dist: b.dist + b.sp * n,
  };
}

export function progress(b: Bird, now: number): number {
  if (b.st === 'fin') return 1;
  return Math.min(0.999, extrapolate(b, now).dist / room.finishDist);
}

// Ranked: finishers by time, then racers by course position, the departed last.
export function standings(now = performance.now()): Bird[] {
  const rank = (b: Bird) => b.st === 'fin' ? 0 : b.st === 'gone' ? 2 : 1;
  return [...room.birds.values()].sort((a, b) =>
    rank(a) - rank(b)
    || (a.st === 'fin' ? a.finishMs - b.finishMs : progress(b, now) - progress(a, now)));
}

export function remoteBirds(): Bird[] {
  return [...room.birds.values()].filter(b => b.id !== me.id);
}

// Hex target for a racer: whoever is just ahead on the course (the one you're
// chasing). The leader has nobody ahead, so they get the one right behind.
export function racerAhead(id: string, now = performance.now()): string | null {
  const self = room.birds.get(id);
  if (!self) return null;
  const mine = progress(self, now);
  const flying = [...room.birds.values()].filter(b => b.st === 'fly' && b.id !== id);
  const ahead = flying.filter(b => progress(b, now) >= mine)
    .sort((a, b) => progress(a, now) - progress(b, now))[0];
  const behind = flying.filter(b => progress(b, now) < mine)
    .sort((a, b) => progress(b, now) - progress(a, now))[0];
  return (ahead ?? behind)?.id ?? null;
}

// ── Shared race mechanics (local player + bots) ───────────────────────────────
// Put a crashed bird back on course: centred in the next gap it hasn't cleared,
// at rest, with a short invincibility window so it isn't instantly re-killed.
export function respawn(s: GameState) {
  const r = C.PLAYER_SIZE / 2;
  const next = s.pipes.find(p => p.x + C.PIPE_W > C.PLAYER_X - r);
  s.player.y = next ? next.topH + next.gap / 2 : C.GROUND / 2;
  s.player.vy = 0;
  s.activeEffects = s.activeEffects.filter(e => e.defId !== 'boost'); // crashing kills momentum
  s.activeEffects.push({ defId: 'respawn', expiryTick: s.tick + defOf('respawn')!.durationTicks });
}

// Sim-side half of a hex (the rest is render/input, owned by game.ts or bots.ts).
export function applySimHex(s: GameState, kind: string) {
  if (kind === 'yank') s.player.vy = 9;
  const defId = kind === 'throttled' ? 'hex-throttled' : kind === 'bloat' ? 'hex-bloat' : null;
  if (defId) s.activeEffects.push({ defId, expiryTick: s.tick + defOf(defId)!.durationTicks });
}
