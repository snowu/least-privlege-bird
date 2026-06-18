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

if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
console.log(`\nAll power-up tests passed.`);
