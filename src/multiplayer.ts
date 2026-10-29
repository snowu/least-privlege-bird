// ─── MULTIPLAYER (Supabase Realtime) ──────────────────────────────────────────
// A room is a Realtime channel: presence = who is in the lobby, broadcast = round
// start + bird snapshots. No tables, no edge functions — the channel IS the room,
// and it evaporates when the last player leaves.
//
// Everyone in a round flies the SAME seed with the power-up rng split off (see
// createState's splitPowerUpRng), so the pipe course is identical for all. Peers
// only exchange render data; nobody's sim depends on anybody else's.
//
// Remote birds are dead-reckoned: a snapshot goes out on every flap plus a slow
// heartbeat, and receivers extrapolate gravity in between. ~4 msgs/s per player
// instead of 60, which keeps a whole retro well under the Realtime rate limits.
//
// Multiplayer runs never touch the leaderboard: the server replay doesn't know
// about the split rng, so it would (correctly) reject them.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './scores.ts';
import { C, TICK_MS } from './physics-core.ts';

export interface Peer { id: string; name: string; avatar: string; joinedAt: number; wins: number; }

// One bird in the current round (remote AND local — the local one is never drawn
// from here, but living in the same map keeps standings/round-end logic uniform).
export interface Bird {
  id: string; name: string; avatar: string;
  y: number; vy: number; g: number; size: number;  // last snapshot (post-step state)
  at: number;              // performance.now() the snapshot was taken/received
  score: number;
  alive: boolean;
  deathTick: number;
  dispY: number;           // smoothed render y (render-only)
}

export interface RoundResult { id: string; name: string; avatar: string; score: number; deathTick: number; }

export interface Handlers {
  onLobby(): void;                          // presence/round status changed — re-render
  onStart(seed: number): void;              // a round I'm in is starting
  onRoundEnd(results: RoundResult[]): void; // everyone in the round is down
}

const HEARTBEAT_TICKS = 30;   // re-sync every 0.5s even without flaps
const STALE_MS = 5000;        // no word for this long → treat as disconnected/dead
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — read aloud on a call

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let handlers: Handlers | null = null;
let staleTimer = 0;

const me = { id: crypto.randomUUID(), name: '', avatar: 'penguin', joinedAt: 0, wins: 0 };

export const room = {
  code: '',
  peers: [] as Peer[],          // lobby, sorted by join time (first = host)
  round: 0,
  roundLive: false,
  participants: [] as string[], // ids flying in the current/last round
  birds: new Map<string, Bird>(),
  lastResults: [] as RoundResult[],
};

export const myId = () => me.id;
export const inRoom = () => !!channel;
export const inRound = () => room.roundLive && room.participants.includes(me.id);
export function isHost() { return room.peers.length > 0 && room.peers[0].id === me.id; }

export function newRoomCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(b, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export async function joinRoom(code: string, name: string, avatar: string, h: Handlers): Promise<void> {
  if (channel) await leaveRoom();
  handlers = h;
  me.name = name; me.avatar = avatar; me.joinedAt = Date.now(); me.wins = 0;
  room.code = code; room.peers = []; room.round = 0; room.roundLive = false;
  room.participants = []; room.birds = new Map(); room.lastResults = [];

  // realtime-js throttles sends to 10/s by default — a frantic flapper can exceed it.
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 30 } } });
  const ch = client.channel(`lpb-room-${code}`, {
    config: { broadcast: { self: false }, presence: { key: me.id } },
  });
  ch.on('presence', { event: 'sync' }, onPresence)
    .on('broadcast', { event: 'start' }, ({ payload }) => onStart(payload))
    .on('broadcast', { event: 'snap' },  ({ payload }) => onSnap(payload))
    .on('broadcast', { event: 'dead' },  ({ payload }) => onDead(payload));

  await new Promise<void>((resolve, reject) => {
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(status));
    });
  });
  channel = ch;
  await track();
  staleTimer = window.setInterval(checkRound, 500);
}

export async function leaveRoom(): Promise<void> {
  clearInterval(staleTimer);
  const ch = channel;
  channel = null; handlers = null;
  room.code = ''; room.roundLive = false; room.peers = [];
  if (ch && client) await client.removeChannel(ch);
}

function track() {
  return channel?.track({ id: me.id, name: me.name, avatar: me.avatar, joinedAt: me.joinedAt, wins: me.wins });
}

export function setAvatar(avatar: string) {
  me.avatar = avatar;
  if (channel) track();
}

// ── Host: start a round ───────────────────────────────────────────────────────
export function startRound() {
  if (!channel || !isHost() || room.roundLive) return;
  const payload = {
    round: room.round + 1,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
    ids: room.peers.map(p => p.id),
  };
  channel.send({ type: 'broadcast', event: 'start', payload });
  onStart(payload); // broadcast.self is off — apply it locally too
}

// ── Local bird → wire ─────────────────────────────────────────────────────────
// Call after every physics tick of the local run. Only actually sends on a flap
// tick or a heartbeat tick; everything in between is extrapolated by receivers.
export function localTick(tick: number, flapped: boolean, y: number, vy: number, g: number, size: number, score: number) {
  if (!channel || !inRound()) return;
  const b = room.birds.get(me.id);
  if (!b || !b.alive) return;
  Object.assign(b, { y, vy, g, size, score, at: performance.now() });
  if (!flapped && tick % HEARTBEAT_TICKS !== 0) return;
  channel.send({ type: 'broadcast', event: 'snap', payload: { id: me.id, round: room.round, y, vy, g, size, score } });
}

export function localDeath(score: number, tick: number) {
  if (!channel || !inRound()) return;
  channel.send({ type: 'broadcast', event: 'dead', payload: { id: me.id, round: room.round, score, tick } });
  onDead({ id: me.id, round: room.round, score, tick });
}

// ── Wire → state ──────────────────────────────────────────────────────────────
function onPresence() {
  if (!channel) return;
  const state = channel.presenceState() as Record<string, any[]>;
  room.peers = Object.values(state)
    .map(metas => metas[0] as Peer)
    .filter(p => p && p.id)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  // Keep names/avatars of round birds fresh (avatar swaps mid-lobby).
  for (const p of room.peers) {
    const b = room.birds.get(p.id);
    if (b) { b.name = p.name; b.avatar = p.avatar; }
  }
  checkRound();
  handlers?.onLobby();
}

function onStart(p: { round: number; seed: number; ids: string[] }) {
  if (p.round <= room.round && room.roundLive) return; // duplicate/stale
  room.round = p.round;
  room.roundLive = true;
  room.participants = p.ids;
  room.birds = new Map();
  // Snapshots don't flow during the countdown — start the staleness clock after it.
  const at = performance.now() + C.COUNTDOWN_SEC * 1000;
  for (const id of p.ids) {
    const peer = room.peers.find(x => x.id === id);
    room.birds.set(id, {
      id, name: peer?.name ?? '???', avatar: peer?.avatar ?? 'penguin',
      y: C.H / 2, vy: 0, g: 0, size: 1, at, score: 0,
      alive: true, deathTick: 0, dispY: C.H / 2,
    });
  }
  if (p.ids.includes(me.id)) handlers?.onStart(p.seed);
  handlers?.onLobby();
}

function onSnap(p: { id: string; round: number; y: number; vy: number; g: number; size: number; score: number }) {
  if (p.round !== room.round) return;
  const b = room.birds.get(p.id);
  if (!b || !b.alive) return;
  Object.assign(b, { y: p.y, vy: p.vy, g: p.g, size: p.size, score: p.score, at: performance.now() });
}

function onDead(p: { id: string; round: number; score: number; tick: number }) {
  if (p.round !== room.round) return;
  const b = room.birds.get(p.id);
  if (!b || !b.alive) return;
  b.alive = false; b.score = p.score; b.deathTick = p.tick;
  checkRound();
}

// Drops birds that left or went silent, and closes the round once nobody's flying.
function checkRound() {
  if (!room.roundLive) return;
  const now = performance.now();
  const present = new Set(room.peers.map(p => p.id));
  for (const b of room.birds.values()) {
    if (!b.alive || b.id === me.id) continue;
    if (!present.has(b.id) || now - b.at > STALE_MS) { b.alive = false; b.deathTick = 0; }
  }
  if ([...room.birds.values()].some(b => b.alive)) return;

  room.roundLive = false;
  room.lastResults = standings().map(({ id, name, avatar, score, deathTick }) => ({ id, name, avatar, score, deathTick }));
  // Everyone computes the same winner from the same results; each player bumps
  // only their own tally and republishes it via presence.
  if (room.lastResults[0]?.id === me.id && room.lastResults[0].score > 0) { me.wins++; track(); }
  handlers?.onRoundEnd(room.lastResults);
  handlers?.onLobby();
}

// ── Queries for the renderer ──────────────────────────────────────────────────
// Ranked: score desc, then whoever survived longer. Alive birds outrank dead ones
// at equal score (they're still going).
export function standings(): Bird[] {
  return [...room.birds.values()].sort((a, b) =>
    b.score - a.score
    || Number(b.alive) - Number(a.alive)
    || b.deathTick - a.deathTick);
}

export function remoteBirds(): Bird[] {
  return [...room.birds.values()].filter(b => b.id !== me.id);
}

// Dead-reckon a bird from its last post-step snapshot: each tick does vy += g then
// y += vy, so after n ticks y = y0 + n·vy0 + g·n(n+1)/2. Clamped to the ground.
export function extrapolate(b: Bird, now: number): { y: number; vy: number } {
  if (!b.alive) return { y: b.y, vy: b.vy };
  const n = Math.max(0, (now - b.at) / TICK_MS);
  const floor = C.GROUND - (C.PLAYER_SIZE * b.size) / 2;
  return {
    y: Math.min(floor, b.y + b.vy * n + b.g * n * (n + 1) / 2),
    vy: b.vy + b.g * n,
  };
}
