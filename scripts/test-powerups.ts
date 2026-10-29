import {
  createState, C, POWERUP_DEFS, getEffective,
  step, simulate,
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

// ── Spawning and collection tests ──

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

// With enough play, a power-up should eventually spawn (seed 42, hover-bot keeps alive)
const s3 = createState(42);
let collected: string | undefined;
let spawnedAny = false;
for (let t = 0; t < 3000; t++) {
  // Hover-bot: aim at the next gap center to stay alive long enough
  let goal = C.H / 2;
  const ahead = s3.pipes.filter(p => p.x + C.PIPE_W > C.PLAYER_X).sort((a, b) => a.x - b.x)[0];
  if (ahead) goal = ahead.topH + ahead.gap / 2;
  const flapped = (s3.player.y > goal - 10) && (s3.player.vy > -2);
  const result = step(s3, flapped);
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

// ── Safe expiry test ──
// Wildcard expiry should NOT kill the player if they're inside a pipe
const s4 = createState(42);
for (let t = 0; t < 600; t++) step(s4, t % 30 === 0);
// Force a wildcard effect that expires next tick, with player inside a pipe
s4.activeEffects = [{ defId: 'wildcard', expiryTick: s4.tick + 1 }];
const nearPipe = s4.pipes.find(p => p.x <= C.PLAYER_X + C.PIPE_W && p.x + C.PIPE_W >= C.PLAYER_X);
if (nearPipe) {
  s4.player.y = nearPipe.topH - 10; // inside the top pipe
  const result = step(s4, false);
  assert(!result.dead, `safe expiry: player not killed when wildcard expires inside pipe`);
  assert(s4.activeEffects.length > 0, `safe expiry: effect extended by grace window`);
} else {
  console.log(`⊘ safe expiry: no pipe near player to test (non-critical, geometry-dependent)`);
}

// ── Safe expiry never extends past the floor ──
// Invincible + no flaps = fall through the ground. The effect must still expire and
// the bird die, or a single pickup farms score forever (and MP rounds never end).
const s6 = createState(123);
s6.activeEffects.push({ defId: 'wildcard', expiryTick: POWERUP_DEFS[0].durationTicks });
let s6dead = false;
for (let t = 0; t < 2000 && !s6dead; t++) s6dead = step(s6, false).dead;
assert(s6dead, `safe expiry: invincible bird below the floor still dies once the effect ends`);

// ── Split power-up rng (multiplayer) keeps the pipe course identical ──
// Two players on one seed: one grabs everything, one ignores power-ups. With the
// rng split, their pipe heights must match pipe-for-pipe.
const grab = createState(99, { splitPowerUpRng: true });
const skip = createState(99, { splitPowerUpRng: true });
const heights = (st: typeof grab) => st.pipes.map(p => Math.round(p.topH));
const seenGrab: number[] = [], seenSkip: number[] = [];
let grabbed = 0;
for (let t = 0; t < 3000; t++) {
  for (const pu of grab.powerUps) if (!pu.collected) pu.y = grab.player.y; // walk into every pickup
  skip.powerUps = [];                                                       // field always clear → rolls every pipe
  grab.player.y = skip.player.y = C.H / 2; grab.player.vy = skip.player.vy = 0; // hover, ignore deaths
  if (step(grab, false).collected) grabbed++;
  step(skip, false);
  for (const h of heights(grab)) if (!seenGrab.includes(h)) seenGrab.push(h);
  for (const h of heights(skip)) if (!seenSkip.includes(h)) seenSkip.push(h);
}
assert(grabbed > 0, `split rng: grabber picked up ${grabbed} power-ups`);
const n = Math.min(seenGrab.length, seenSkip.length, 30);
assert(n >= 10 && seenGrab.slice(0, n).every((h, i) => h === seenSkip[i]),
  `split rng: first ${n} pipe heights identical with vs without power-ups`);

// ── Race physics options (multiplayer) ──
// Terminal velocity caps the fall; soft bounds keep an invincible bird on screen
// (respawn grace / afterburner used to let you sink through the floor and die the
// moment it ended). Single-player gets neither.
const race = createState(5, { maxFall: 10, softBounds: true, gravity: 0.55, flap: -9.4 });
race.activeEffects.push({ defId: 'wildcard', expiryTick: 120 });
let maxVy = 0, maxY = 0;
for (let t = 0; t < 110; t++) { step(race, false); maxVy = Math.max(maxVy, race.player.vy); maxY = Math.max(maxY, race.player.y); }
assert(maxVy <= 10, `race: fall speed capped at terminal velocity (max ${maxVy})`);
assert(maxY <= C.GROUND, `race: invincible bird held above the floor (max y ${Math.round(maxY)})`);
const solo = createState(5);
solo.activeEffects.push({ defId: 'wildcard', expiryTick: 120 });
for (let t = 0; t < 110; t++) step(solo, false);
assert(solo.player.y > C.GROUND, `solo: no soft bounds — invincible bird still falls through (unchanged)`);

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

if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
console.log(`\nAll power-up tests passed.`);
