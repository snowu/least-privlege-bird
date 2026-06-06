#!/usr/bin/env node
// Drift guard: game.js (browser) and supabase/functions/submit-score/sim.ts (server)
// each hold a copy of the physics constants `C`. They MUST match byte-for-value, or
// server-side replay validation rejects legitimate scores. There's no shared module
// (browser classic script vs. independently-deployed Deno fn), so this script diffs
// the two copies and fails the commit on any mismatch.
//
// Run: node scripts/check-physics-sync.js   (wired into .git/hooks/pre-commit)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'game.js');
const SIM = path.join(ROOT, 'supabase/functions/submit-score/sim.ts');

// Keys that drive the deterministic sim. Anything here must agree across both files.
// (Render-only constants like HUD/CLOUD_COUNT/SPRITE_SCALE are intentionally excluded.)
const SHARED_KEYS = [
  'W', 'H', 'GRAVITY', 'FLAP', 'PIPE_W',
  'PIPE_GAP_MIN', 'PIPE_GAP_MAX', 'PIPE_GAP_STEP',
  'PIPE_SPEED', 'PIPE_INTERVAL_MAX', 'PIPE_INTERVAL_MIN', 'PIPE_INTERVAL_STEP',
  'SPEED_UP_INTERVAL', 'SPEED_UP_AMOUNT', 'PLAYER_X', 'PLAYER_SIZE',
];

// Pull `KEY: <number>` pairs out of a source file. Tolerant of multiple keys per
// line and arbitrary spacing; ignores comments after the value.
function extractConsts(src) {
  const out = {};
  for (const key of SHARED_KEYS) {
    // match `KEY: 123` or `KEY: -9` or `KEY: 0.5`, not substrings of other keys
    const re = new RegExp('\\b' + key + '\\s*:\\s*(-?\\d+(?:\\.\\d+)?)');
    const m = src.match(re);
    if (m) out[key] = m[1];
  }
  return out;
}

const game = extractConsts(fs.readFileSync(GAME, 'utf8'));
const sim = extractConsts(fs.readFileSync(SIM, 'utf8'));

const problems = [];
for (const key of SHARED_KEYS) {
  const g = game[key];
  const s = sim[key];
  if (g === undefined) problems.push(`  ${key}: missing in game.js`);
  else if (s === undefined) problems.push(`  ${key}: missing in sim.ts`);
  else if (g !== s) problems.push(`  ${key}: game.js=${g}  sim.ts=${s}`);
}

// GROUND is derived (H - HUD) in both; sanity-check sim.ts didn't hard-code a stale H.
const simGround = (fs.readFileSync(SIM, 'utf8').match(/GROUND:\s*(\d+)\s*-\s*(\d+)/));
if (simGround && game.H !== undefined && simGround[1] !== game.H) {
  problems.push(`  GROUND: sim.ts hard-codes H=${simGround[1]} but game.js H=${game.H}`);
}

if (problems.length) {
  console.error('\n✗ Physics constants drift between game.js and sim.ts:\n');
  console.error(problems.join('\n'));
  console.error('\nReplay validation will reject valid scores. Sync them, then re-commit.\n');
  process.exit(1);
}

console.log('✓ Physics constants in sync (game.js ↔ sim.ts)');
