// ─── GOLDEN REPLAY TESTS ──────────────────────────────────────────────────────
// Frozen { seed, flapTicks } → expectedScore fixtures. Asserts the physics core's
// simulate() still reproduces each score exactly.
//
// WHY: the constant-diff guard catches a constant drifting, but NOT a logic change
// (reordering input-vs-physics, a collision tweak, an off-by-one in scoring) that
// leaves constants identical yet changes replay output. That class of bug silently
// rejects honest scores on the server. These goldens lock the *behaviour*.
//
// If a fixture fails after an INTENTIONAL physics change, regenerate the fixtures
// deliberately (see scripts/gen-goldens — a hover-controller that plays each seed)
// and review the diff. A surprise failure means unintended drift.
//
// Fixtures regenerated 2026-06-07 after moving the field pre-fill into createState
// (pipes now exist from construction → render during the countdown). Physics + rng
// order unchanged; the hover-bot just sees the field at tick 0, so its honest runs —
// and thus these fixtures — differ from the prior set.

import { simulate } from "../src/physics-core.ts";

interface Golden { seed: number; score: number; flapTicks: number[]; }

const GOLDENS: Golden[] = [
  { seed: 1, score: 3, flapTicks: [8,43,78,113,148,183,218,253,288,318,333,348,373,408,460,494] },
  { seed: 7, score: 5, flapTicks: [0,15,30,45,80,115,150,185,220,255,290,327,362,397,457,491,526,541,571,606,629,664,699] },
  { seed: 42, score: 8, flapTicks: [5,40,75,110,145,180,215,250,285,318,347,382,417,466,500,529,560,595,629,644,659,689,736,771,798,825,860,908,942] },
  { seed: 1000, score: 2, flapTicks: [18,53,88,123,158,193,228,263,298,335,370,405] },
  { seed: 31337, score: 9, flapTicks: [13,48,83,118,153,188,223,258,293,318,333,359,394,442,477,512,555,590,625,640,673,708,723,738,753,786,829,864,917,952,996,1030,1048] },
];

let failed = 0;
for (const g of GOLDENS) {
  const { score } = simulate(g.seed, g.flapTicks);
  const ok = score === g.score;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} seed=${g.seed} expected=${g.score} got=${score}`);
}

// Sanity: a run with no flaps must score 0 (bird falls immediately).
const noFlap = simulate(1, []);
if (noFlap.score !== 0) { failed++; console.log(`✗ no-flap run scored ${noFlap.score}, expected 0`); }
else console.log(`✓ no-flap run scores 0 (seed=1)`);

// Sanity: empty/identical inputs are deterministic across two calls.
const a = simulate(31337, GOLDENS[4].flapTicks).score;
const b = simulate(31337, GOLDENS[4].flapTicks).score;
if (a !== b) { failed++; console.log(`✗ non-deterministic: ${a} != ${b}`); }
else console.log(`✓ deterministic across repeated calls`);

if (failed > 0) {
  console.error(`\n${failed} replay test(s) FAILED — physics core drifted. Investigate before deploying.`);
  process.exit(1);
}
console.log(`\nAll ${GOLDENS.length} goldens + 3 sanity checks passed.`);
