// ─── GOLDEN FIXTURE GENERATOR ─────────────────────────────────────────────────
// Regenerates the frozen fixtures used by test-replay.ts. Run this ONLY after an
// INTENTIONAL physics change, then paste the output into test-replay.ts's GOLDENS
// and review the score diffs — a changed score is the whole point of reviewing.
//
//   npx esbuild scripts/gen-goldens.ts --bundle --platform=node --format=esm \
//     --outfile=dist/gen-goldens.mjs && node dist/gen-goldens.mjs
//
// A simple hover-controller "plays" each seed (aims at the next gap center) and
// records the flap ticks, producing valid honest runs at a spread of scores.

import { C, createState, step } from "../src/physics-core.ts";

function playToScore(seed: number, target: number) {
  const s = createState(seed);
  const flapTicks: number[] = [];
  while (s.tick < 200000) {
    let goal = C.H / 2;
    const ahead = s.pipes.filter(p => p.x + C.PIPE_W > C.PLAYER_X).sort((a, b) => a.x - b.x)[0];
    if (ahead) goal = ahead.topH + ahead.gap / 2;
    const flapped = (s.player.y > goal - 10) && (s.player.vy > -2);
    if (flapped) flapTicks.push(s.tick);
    const { dead } = step(s, flapped);
    if (dead) return { seed, score: s.score, flapTicks };
    if (s.score >= target) return { seed, score: s.score, flapTicks };
  }
  return { seed, score: s.score, flapTicks };
}

const SPECS: [number, number][] = [[1, 3], [7, 5], [42, 8], [1000, 2], [31337, 10]];
const out = SPECS.map(([seed, target]) => playToScore(seed, target));
for (const g of out) {
  console.log(`  { seed: ${g.seed}, score: ${g.score}, flapTicks: [${g.flapTicks.join(",")}] },`);
}
