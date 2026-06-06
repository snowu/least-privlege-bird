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
// The seed=1 → 3 fixture is the exact run verified live against prod on 2026-06-06.

import { simulate } from "../src/physics-core.ts";

interface Golden { seed: number; score: number; flapTicks: number[]; }

const GOLDENS: Golden[] = [
  { seed: 1, score: 3, flapTicks: [0,37,72,107,142,177,212,247,282,317,352,387,422,457,492,527,562,597,612,627,642,674,726,760] },
  { seed: 7, score: 5, flapTicks: [0,15,30,45,80,115,150,185,220,255,290,325,360,395,430,465,500,535,570,607,642,677,737,771,786,817,852,867,902,937] },
  { seed: 42, score: 6, flapTicks: [0,36,71,106,141,176,211,246,281,316,351,386,421,456,491,526,561,596,621,656,705,739,774,796,831,863,878,893,924,972,1006,1027] },
  { seed: 1000, score: 2, flapTicks: [0,43,78,113,148,183,218,253,288,323,358,393,428,463,498,533,568,605,640,675] },
  { seed: 31337, score: 10, flapTicks: [0,40,75,110,145,180,215,250,285,320,355,390,425,460,495,530,565,598,613,628,659,707,741,785,820,855,870,902,937,952,967,982,1014,1057,1092,1146,1180,1224,1258,1273,1288,1303,1318] },
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
