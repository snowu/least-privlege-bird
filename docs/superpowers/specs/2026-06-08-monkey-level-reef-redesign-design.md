# Monkey level: jungle-reef redesign

## Why

The monkey (DK-callback) water level currently has two rough edges:
- The background "sunken girders" layer renders as three crisscrossing diagonal
  strokes that read as bare geometric triangles, not scaffolding.
- The pipes use the generic `bandedPipe` (same rusted-girder look as other
  industrial themes), which doesn't fit an underwater setting.

User direction: drop the "sunken construction site" framing entirely and pivot
the level's aesthetic toward DK Country's tropical jungle-reef vibe. Pipes
become rock pillars; background trades girders for reef/jungle motifs. Keep
the existing rolling-barrel layer (DK's signature hazard still reads fine
tumbling through a reef current).

## Changes

### 1. Pipes — coral-crusted rock pillars
Replace `THEMES.monkey.drawPipe`'s `bandedPipe` call with a `framedPipe` +
custom `decorate`:
- Body: weathered grey-green stone (`#5e6b5a` family)
- Irregular blotchy strata patches (organic rock texture — uneven blob shapes,
  not the horse mesa's clean horizontal bands)
- Small coral-polyp clusters (pink/orange/purple bumps) dotted along the body
- Barnacle/anemone dots near the caps
- Cap: jagged rock-shelf silhouette via stepped overlapping rects, crowned
  with a coral-crust band
Hitbox stays the standard rectangular `framedPipe` geometry — purely cosmetic.

### 2. Background layer swap
- **Remove** the triangle/X-beam girder layer (`beam()` helper + its tile draw).
- **Add** a rock-spire silhouette layer: jagged background pillars of varying
  height/blotchy texture, giving the reef a "skyline."
- **Add** a kelp/vine layer: tall swaying fronds (reuse the existing algae
  layer's stepped-curve technique, recolored toward jungle vine green/yellow —
  doing double duty as both reef kelp and a DK Country jungle nod).
- **Keep** the rolling-barrels layer as-is.

### 3. Easter eggs (new wanderer-driven props)
- A small drifting **banana bunch** prop (cheap DK Country callback).
- A small **Pauline cameo**: a tiny humanoid silhouette inside an air
  bubble/diving-bell, drifting past in the background — a "damsel" nod kept
  deliberately subtle/background so it doesn't clash with the underwater read.

Both ride the existing `wanderers()` engine, consistent with how barrels and
other themes' background creatures are implemented.

## Out of scope
- No changes to collision/physics — all of the above is render-only
  (`drawPipe` + `bgLayers`), same boundary every other theme respects.
- No new SVG avatar assets — this only touches in-canvas pixel/round drawing
  code in `src/game.ts`.
