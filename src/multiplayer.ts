// ─── MULTIPLAYER (Cloudflare relay) ───────────────────────────────────────────
// A room is a socket into the lpb-rooms relay (relay/: one in-memory Durable Object
// per room code): presence = who is in the lobby, broadcast = round start + bird
// snapshots. The relay knows nothing about the game; the room evaporates when the
// last player leaves. (Supabase Realtime's free tier caps a whole project at 100
// msgs/s counting every delivery — a 10-player race needs ~400.)
//
// Rounds are PARTY RACES over a fixed distance: everyone flies the SAME seed (see
// RACE_OPTS) and nobody is ever knocked out. Hitting anything is a BONK — a short
// stumble, then you fly on — so a crash costs a moment, like falling off in a kart
// game. ⚡ coins in the gaps warp you ahead. First to the 🏁 wins.
//
// Remote birds are dead-reckoned: each client sends a snapshot of the birds it owns
// (itself + any bots it hosts) on every flap plus a slow heartbeat, batched into one
// message per 50ms, and receivers extrapolate gravity + distance in between.
//
// Multiplayer runs never touch the leaderboard: the server replay doesn't know
// about race options or bonks, so it would (correctly) reject them.
import {
  C, TICK_MS, SPEED_UP_TICKS, defOf, createState, mulberry32,
  type GameState, type Pipe, type StateOpts,
} from './physics-core.ts';
import { AVATAR_KEYS } from './avatars-meta.ts';

export type BirdState = 'fly' | 'fin' | 'gone';

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
  finishMs: number;        // race time once st === 'fin'
  bonks: number;           // how many times it hit something this round
  dispY: number;           // smoothed render y (render-only)
}

export interface RoundResult {
  id: string; name: string; avatar: string; bot: boolean;
  finished: boolean; finishMs: number; progress: number; score: number; bonks: number;
}

export interface Handlers {
  onLobby(): void;                               // presence/round status changed
  onStart(seed: number): void;                   // a round I'm in is starting
  onFinish(b: Bird, place: number): void;        // someone crossed the line
  onRoundEnd(results: RoundResult[]): void;      // race over
}

// Race tuning — the knobs to turn if races feel too hard/easy. No classic power-ups
// (the only race pickup is the ⚡ warp coin). Pacing: 3.5→4.5 px/tick, at least
// 1.25s between pipes (so faster = further apart), gaps 20% wider than solo, and
// each gap within 190px of the last so the course flows rather than zig-zags;
// first pipe close. Feel: lighter than single-player (less gravity,
// softer flap: same hop height, more hang time), a gentle terminal velocity, and
// soft floor/ceiling while bonked so a stumble can't drop you out of the world.
export const RACE_OPTS = {
  splitPowerUpRng: true, powerUps: false, startLevel: 3, maxSpeedLevel: 5, minIntervalMs: 1250, firstPipeX: 480,
  gapMul: 1.2, maxGapShift: 190,
  gravity: 0.4, flap: -8.2, maxFall: 8, softBounds: true,
} satisfies StateOpts;
// Nominal length = seconds a clean, warp-free run takes. Coins make it shorter.
export const RACE_LENGTHS = { sprint: 20, standard: 30, marathon: 45 };
export const ITEM_GRAB_PX = 34;     // how close to the gap centre you must pass to grab a coin
// Rubber-band warp (anti-snowball, à la kart racers): a coin throws you further the
// further you trail the leader — a nudge at the front, a real catch-up at the back.
export const WARP_MIN_PX = 150;
export const WARP_MAX_PX = 700;
const WARP_PER_PX_BEHIND = 0.6;

const SEND_EVERY_MS = 50;      // batch window for outgoing snapshots
const HEARTBEAT_MS = 400;      // re-sync each owned bird at least this often
const STALE_MS = 4000;         // no word for this long → treat as disconnected
const FINISH_GRACE_MS = 20000; // race closes this long after the first finisher
const HARD_CAP_MS = 120000;    // …or this long past the nominal race length
const MAX_BOTS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — read aloud on a call
const BOT_NAMES = [
  'Clippy', 'Kevin from Billing', 'NAT Gateway', 'Lambda Cold Start', 'Terraform Plan',
  'Root Account', 'Chaos Monkey', 'us-east-1', 'Jeff (bot)', 'Intern #47',
  'Legacy Monolith', 'YAML Engineer', 'On-call Pager', 'CloudWatch Alarm', 'Sev-2',
];

// The deployed relay when served from GitHub Pages; a local `wrangler dev` (in
// relay/) everywhere else.
// (A function, not a constant, so this module also loads in the Node tests.)
const relayUrl = () => location.hostname.endsWith('github.io')
  ? 'wss://lpb-rooms.zancato-t.workers.dev'
  : `ws://${location.hostname || 'localhost'}:8787`;

// Thin relay client: one WebSocket, auto-reconnect (re-sending our presence meta so
// the room relists us), and the same presence/broadcast model the game expects.
class RelayChannel {
  ws: WebSocket | null = null;
  metas: any[] = [];
  private meta: unknown = null;
  private closed = false;

  constructor(
    private code: string,
    private onEvent: (event: string, payload: any) => void,
    private onPresence: () => void,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${relayUrl()}/ws/${this.code}`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        if (this.meta) this.raw({ t: 'track', meta: this.meta });
        resolve();
      };
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === 'presence') { this.metas = m.metas; this.onPresence(); }
        else if (m.t === 'bc') this.onEvent(m.event, m.payload);
      };
      ws.onclose = () => {
        if (!opened) reject(new Error('relay unreachable'));
        else if (!this.closed) this.reconnect();
      };
    });
  }

  private reconnect() {
    setTimeout(() => { if (!this.closed) this.connect().catch(() => this.reconnect()); }, 1000);
  }

  track(meta: unknown) { this.meta = meta; this.raw({ t: 'track', meta }); }
  send(event: string, payload: unknown) { this.raw({ t: 'bc', event, payload }); }
  close() { this.closed = true; this.ws?.close(); }

  private raw(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}

let channel: RelayChannel | null = null;
let handlers: Handlers | null = null;
let checkTimer = 0, sendTimer = 0, trackTimer = 0;
const dirty = new Set<string>();      // owned birds that flapped since the last send
const lastSent = new Map<string, number>();

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

  const ch = new RelayChannel(code, (event, payload) => {
    if (event === 'start') onStart(payload);
    else if (event === 'snaps') onSnaps(payload);
  }, onPresence);
  await ch.connect();
  channel = ch;
  publishPresence();
  checkTimer = window.setInterval(checkRound, 500);
  sendTimer = window.setInterval(flushSnaps, SEND_EVERY_MS);
}

export async function leaveRoom(): Promise<void> {
  clearInterval(checkTimer);
  clearInterval(sendTimer);
  clearTimeout(trackTimer);
  channel?.close();
  channel = null; handlers = null;
  room.code = ''; room.roundLive = false; room.peers = [];
  myBots.length = 0;
}

// Presence updates are debounced: mashing "add bot" shouldn't re-announce us five
// times in a second (each re-track briefly churns everyone's presence state).
function track() {
  clearTimeout(trackTimer);
  trackTimer = window.setTimeout(publishPresence, 200);
}
function publishPresence() {
  channel?.track({
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
  // Skill spread so a lobby of bots has a pack: some bonk constantly, some rarely.
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
  channel.send('start', payload);
  onStart(payload); // the relay doesn't echo to the sender — apply it locally too
}

// ── Course ────────────────────────────────────────────────────────────────────
export const raceState = (seed: number) => createState(seed, RACE_OPTS);

// Distance a clean, warp-free run covers in `sec` seconds under RACE_OPTS pacing
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

// Whether pipe n's gap holds a ⚡ coin: deterministic from the round seed + spawn
// index, so every racer sees the same coins on the same pipes.
export function hasCoin(n: number): boolean {
  if (n < 1) return false;
  return mulberry32((room.seed ^ Math.imul(n, 0x9E3779B1)) >>> 0)() < 0.15;   // ~1 in 7 gaps
}

// Call after each step for bird `id`: as a pipe's centre passes the bird, grab its
// coin (→ rubber-band warp) if the bird threads the gap close to centre. `seen`
// remembers pipes already judged. Returns whether a coin was grabbed.
export function passItems(s: GameState, seen: WeakSet<Pipe>, id: string): boolean {
  let got = false;
  for (const p of s.pipes) {
    if (seen.has(p) || p.x + C.PIPE_W / 2 > C.PLAYER_X) continue;
    seen.add(p);
    if (!hasCoin(p.n) || Math.abs(s.player.y - (p.topH + p.gap / 2)) > ITEM_GRAB_PX) continue;
    warp(s, warpDistance(id, s.dist));
    got = true;
    break;   // the warp just cleared the pipes we were iterating
  }
  return got;
}

// How far a coin throws a bird that has flown `dist`: WARP_MIN_PX plus a share of
// its gap to the leader, capped. The leader (or a solo racer) gets the minimum.
export function warpDistance(id: string, dist: number, now = performance.now()): number {
  let lead = dist;
  for (const b of room.birds.values()) {
    if (b.id === id || b.st === 'gone') continue;
    lead = Math.max(lead, b.st === 'fin' ? room.finishDist : extrapolate(b, now).dist);
  }
  return Math.min(WARP_MAX_PX, WARP_MIN_PX + (lead - dist) * WARP_PER_PX_BEHIND);
}

// Coin grab: jump `px` further along the course and clear the runway — the pipes in
// that stretch vanish. Position, speed and control are untouched, so there's
// nothing to recover from.
export function warp(s: GameState, px: number) {
  const r = C.PLAYER_SIZE / 2;
  s.dist += px;
  s.pipes = s.pipes.filter(p => p.x + C.PIPE_W <= C.PLAYER_X - r || p.x >= C.PLAYER_X + px);
}

// Hit a pipe / the floor / the ceiling: no stopping, just a stumble. The bonk
// effect slows the world and lets you pass through for a moment, plus a little
// hop so a floor hit bounces you back into play.
export function bonk(s: GameState) {
  s.player.vy = -4;
  s.activeEffects.push({ defId: 'bonk', expiryTick: s.tick + defOf('bonk')!.durationTicks });
}

// ── Owned birds → wire ────────────────────────────────────────────────────────
// Call every sim tick (and on state changes) for each bird this client owns.
// `urgent` (a flap, bonk or finish) gets it into the next 50ms batch; otherwise
// it rides the heartbeat.
export function updateOwned(id: string, s: GameState, st: BirdState, urgent = false, finishMs = 0) {
  const b = room.birds.get(id);
  if (!b || !room.roundLive || b.st === 'fin' || b.st === 'gone') return;
  let g = s.gravity, size = 1, speed = 1;
  for (const e of s.activeEffects) {
    const d = defOf(e.defId);
    if (d?.gravityMul) g *= d.gravityMul;
    if (d?.sizeMul) size *= d.sizeMul;
    if (d?.speedMul) speed *= d.speedMul;
  }
  Object.assign(b, {
    y: s.player.y, vy: s.player.vy, g, size, score: s.score,
    dist: s.dist, sp: s.pipeSpeed * speed, st, finishMs, at: performance.now(),
  });
  if (urgent) dirty.add(id);
  if (st === 'fin') finished(b);
}

// One of my birds hit something (counted for the 🤕 award on the results screen).
export function noteBonk(id: string) {
  const b = room.birds.get(id);
  if (b) { b.bonks++; dirty.add(id); }
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
    out.push({ id, st: b.st, y: b.y, vy: b.vy, g: b.g, size: b.size, score: b.score, d: b.dist, sp: b.sp, fm: b.finishMs, bk: b.bonks });
  }
  if (out.length) channel.send('snaps', { round: room.round, birds: out });
}

// ── Wire → state ──────────────────────────────────────────────────────────────
function onPresence() {
  if (!channel) return;
  const metas = channel.metas
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
  // Snapshots don't flow during the countdown — start the staleness clock after it.
  room.raceStartAt = performance.now() + C.COUNTDOWN_SEC * 1000;
  for (const id of p.ids) {
    const peer = room.peers.find(x => x.id === id);
    room.birds.set(id, {
      id, name: peer?.name ?? '???', avatar: peer?.avatar ?? 'penguin',
      bot: !!peer?.bot, owner: peer?.owner ?? id,
      y: C.H / 2, vy: 0, g: 0, size: 1, score: 0, dist: 0, sp: 0, at: room.raceStartAt,
      st: 'fly', finishMs: 0, bonks: 0, dispY: C.H / 2,
    });
  }
  if (p.ids.includes(me.id)) handlers?.onStart(p.seed);
  handlers?.onLobby();
}

function onSnaps(p: { round: number; birds: Array<{ id: string; st: BirdState; y: number; vy: number; g: number; size: number; score: number; d: number; sp: number; fm: number; bk: number }> }) {
  if (p.round !== room.round) return;
  const now = performance.now();
  for (const s of p.birds) {
    if (owns(s.id)) continue;
    const b = room.birds.get(s.id);
    if (!b || b.st === 'fin') continue;   // a 'gone' racer who's talking again is back in (wifi blip / reconnect)
    Object.assign(b, { y: s.y, vy: s.vy, g: s.g, size: s.size, score: s.score, dist: s.d, sp: s.sp, st: s.st, finishMs: s.fm, bonks: s.bk ?? b.bonks, at: now });
    if (s.st === 'fin') finished(b);
  }
  checkRound();
}

// Someone crossed the line: announce it with their place, start the grace clock.
function finished(b: Bird) {
  if (!room.firstFinishAt) room.firstFinishAt = performance.now();
  const place = [...room.birds.values()].filter(x => x.st === 'fin').length;
  handlers?.onFinish(b, place);
  checkRound();
}

// Drops racers who left or went silent (not for good: their next snapshot revives
// them), and closes the race once nobody's racing, FINISH_GRACE_MS after the
// winner, or at the hard cap.
function checkRound() {
  if (!room.roundLive) return;
  const now = performance.now();
  const present = new Set(room.peers.map(p => p.id));
  for (const b of room.birds.values()) {
    if (b.st !== 'fly' || owns(b.id)) continue;
    if (!present.has(b.id) || now - b.at > STALE_MS) b.st = 'gone';
  }
  const racing = [...room.birds.values()].some(b => b.st === 'fly');
  const graceOver = room.firstFinishAt && now - room.firstFinishAt > FINISH_GRACE_MS;
  const capped = now - room.raceStartAt > room.raceSec * 1000 + HARD_CAP_MS;
  if (racing && !graceOver && !capped) return;

  room.roundLive = false;
  room.lastResults = standings(now).map(b => ({
    id: b.id, name: b.name, avatar: b.avatar, bot: b.bot, finished: b.st === 'fin',
    finishMs: b.finishMs, progress: progress(b, now), score: b.score, bonks: b.bonks,
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
// Dead-reckon a bird from its last post-step snapshot by replaying step()'s
// vertical motion (vy += g, capped at terminal velocity, then y += vy) for the
// ticks since; distance grows by its scroll speed. Only flying remote birds move.
// At most a heartbeat's worth (~25) of ticks, so the loop is cheap.
export function extrapolate(b: Bird, now: number): { y: number; vy: number; dist: number } {
  if (b.st !== 'fly' || owns(b.id)) return { y: b.y, vy: b.vy, dist: b.dist };
  const n = Math.min(240, Math.max(0, (now - b.at) / TICK_MS));
  let y = b.y, vy = b.vy;
  for (let k = 1; k <= n; k++) {
    vy = Math.min(vy + b.g, RACE_OPTS.maxFall);
    y += vy;
  }
  const floor = C.GROUND - (C.PLAYER_SIZE * b.size) / 2;
  return { y: Math.min(floor, y), vy, dist: b.dist + b.sp * n };
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
