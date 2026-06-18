import {
  createState, C, POWERUP_DEFS, getEffective,
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

if (failed > 0) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
console.log(`\nAll power-up definition tests passed.`);
