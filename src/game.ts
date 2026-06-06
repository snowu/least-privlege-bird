// ─── IMPORTS ──────────────────────────────────────────────────────────────────
// Physics is the shared core — same module the server replays with, so the game
// and the anti-cheat validation can never drift. C holds all constants (incl.
// render-only ones like HUD/SPRITE_SCALE/COUNTDOWN_SEC).
import {
  C, TICK_MS, createState, step, speedLevel, type GameState,
} from './physics-core.ts';
import {
  fetchBest, saveScore, loadScores, ensurePlayerToken, fetchFortune,
  showRecoverModal, _loadLocal,
} from './scores.ts';
import { Clave } from './clave.ts';

// ─── CANVAS SETUP ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width  = C.W;
canvas.height = C.H;
// Pin the displayed size to the internal resolution so the browser never rescales
// the canvas (rescaling + image-rendering:pixelated is what produced vertical bands).
canvas.style.width  = C.W + 'px';
canvas.style.height = C.H + 'px';
// Crisp sprite scaling: our 16px pixel-art SVGs are drawn up to 40px — keep hard edges.
ctx.imageSmoothingEnabled = false;

// Size overlay to match canvas
const overlay = document.getElementById('overlay');
overlay.style.width  = C.W + 'px';
overlay.style.height = C.H + 'px';

// ─── AUDIO (synthesized, no files) ────────────────────────────────────────────
// All SFX are generated at runtime with the Web Audio API — retro 8-bit blips that
// match the pixel aesthetic, with a distinct flap timbre per avatar. Zero assets.
const AudioFX = (() => {
  let ac = null;
  const ctxAudio = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());

  // One beep: type=wave, glide from f0→f1 Hz over dur s, with a quick volume env.
  function beep(f0, f1, dur, type = 'square', vol = 0.18, delay = 0) {
    const a = ctxAudio();
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Per-avatar flap voices.
  const FLAPS = {
    bird:   () => beep(900, 1500, 0.10, 'square', 0.15),               // chirp up
    penguin:() => { beep(300, 240, 0.12, 'sawtooth', 0.16); beep(260, 200, 0.1, 'square', 0.1, 0.04); }, // honk-flail
    squid:  () => { beep(180, 70, 0.18, 'sine', 0.16); beep(90, 50, 0.12, 'sine', 0.1, 0.05); },         // water-jet blub
    rocket: () => beep(220, 90,  0.16, 'sawtooth', 0.16),              // whoosh down
    bee:    () => { beep(420, 380, 0.12, 'square', 0.12); beep(440, 400, 0.12, 'square', 0.1, 0.01); }, // buzzy
    wizard: () => { beep(700, 1300, 0.09, 'triangle', 0.14); beep(1300, 2000, 0.08, 'triangle', 0.1, 0.06); }, // sparkle
    robot:  () => beep(140, 140, 0.09, 'square', 0.16),                // flat blip
  };

  return {
    // Resume the context on first user gesture (browsers require it).
    unlock() { const a = ctxAudio(); if (a.state === 'suspended') a.resume(); },
    flap(key) { (FLAPS[key] || FLAPS.bird)(); },
    score() { beep(1200, 1600, 0.06, 'square', 0.13); },
    // Descending minor jingle — that N64/PS1 "you died" sting.
    gameOver() {
      const seq = [660, 550, 440, 330, 220];
      seq.forEach((f, i) => beep(f, f * 0.98, 0.18, 'triangle', 0.2, i * 0.13));
      beep(110, 90, 0.5, 'sawtooth', 0.16, seq.length * 0.13); // low tail
    },
  };
})();

// ─── ASSETS & THEMES ──────────────────────────────────────────────────────────
function makeImg(src) { const i = new Image(); i.src = src; return i; }

// Art style: 'pixel' (8-bit) or 'round' (smooth). Both sprite sets live under
// assets/<style>/<key>.svg. Persisted so the choice sticks across sessions.
let gfxStyle = localStorage.getItem('lpb_gfx') === 'round' ? 'round' : 'pixel';

// ─── STYLE TABLE ────────────────────────────────────────────────────────────────
// Every style-dependent visual setting lives here, keyed by gfxStyle. The toggle
// just flips the key; applyStyle() pushes these into CSS custom properties (so the
// DOM chrome restyles) and the canvas (fonts + smoothing). Nothing visual is
// hardcoded per-style outside this table.
const STYLE: { [key: string]: any } = {
  pixel: {
    fontDisplay: "'Press Start 2P', monospace", // titles, buttons, HUD
    fontBody:    "'Press Start 2P', monospace", // labels, prose
    fontMono:    "'Press Start 2P', monospace", // dense logs
    smoothing: false,        // crisp sprite edges
    radius: '4px',           // button / tile corner radius
    textShadow: '3px 3px 0 #000',
    letterSpacing: '0px',
    fontScale: 1,            // baseline — all rem sizes were tuned for this font
    logo: 'assets/pixel/penguin.svg', logoRendering: 'pixelated',
  },
  round: {
    fontDisplay: "'Segoe UI', system-ui, sans-serif",
    fontBody:    "'Segoe UI', system-ui, sans-serif",
    fontMono:    "'SFMono-Regular', Consolas, monospace",
    smoothing: true,         // smooth vector art
    radius: '12px',
    textShadow: '0 2px 4px rgba(0,0,0,.5)',
    letterSpacing: 'normal',
    // Segoe glyphs are ~1.4× narrower than Press Start 2P, so the same rem size
    // reads small. Bump the root font-size so round text fills the same width.
    fontScale: 1.4,
    logo: 'assets/round/penguin.svg', logoRendering: 'auto',
  },
};
function activeStyle() { return STYLE[gfxStyle] || STYLE.pixel; }

// Push the active style into the DOM (CSS vars) and canvas. Called on load + toggle.
function applyStyle() {
  const s = activeStyle();
  const root = document.documentElement.style;
  root.setProperty('--font-display', s.fontDisplay);
  root.setProperty('--font-body', s.fontBody);
  root.setProperty('--font-mono', s.fontMono);
  root.setProperty('--radius', s.radius);
  root.setProperty('--text-shadow', s.textShadow);
  root.setProperty('--letter-spacing', s.letterSpacing);
  // Scale every rem-based size at once by setting the root font-size (16px × scale).
  document.documentElement.style.fontSize = (16 * s.fontScale) + 'px';
  // Swap the title logo to match the art style.
  const logoEl = document.getElementById('title-logo');
  if (logoEl) { logoEl.src = s.logo; logoEl.style.imageRendering = s.logoRendering; }
  ctx.imageSmoothingEnabled = s.smoothing;
}

// ─── SHARED PIPE DRAWERS ────────────────────────────────────────────────────────
// Pure render-only. Collision is geometry-only (physics-core collides()), so pipe art
// never touches the sim/replay path. Themes pass colors as data → composition, no OOP.

// Hard-edged pixel pipe: body + highlight band (left) + shadow band (right) + hard
// edges, with a chunky capped top/bottom. Shared by bird/penguin/squid (colors only).
function bandedPipe(x, topH, gap, { body, light, dark, edge, capH = 28 }) {
  const capW = C.PIPE_W + 12, capX = x - 6;
  const shaft = (sx, sy, sw, sh) => {
    ctx.fillStyle = body;  ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = light; ctx.fillRect(sx + 4, sy, 8, sh);          // highlight band
    ctx.fillStyle = dark;  ctx.fillRect(sx + sw - 10, sy, 8, sh);    // shadow band
    ctx.fillStyle = edge;  ctx.fillRect(sx, sy, 2, sh);              // hard left edge
    ctx.fillRect(sx + sw - 2, sy, 2, sh);                            // hard right edge
  };
  const cap = (cy) => {
    ctx.fillStyle = body;  ctx.fillRect(capX, cy, capW, capH);
    ctx.fillStyle = light; ctx.fillRect(capX + 4, cy + 4, 8, capH - 8);
    ctx.fillStyle = dark;  ctx.fillRect(capX + capW - 12, cy + 4, 8, capH - 8);
    ctx.fillStyle = edge;
    ctx.fillRect(capX, cy, capW, 3);                 // top edge
    ctx.fillRect(capX, cy + capH - 3, capW, 3);      // bottom edge
    ctx.fillRect(capX, cy, 3, capH);                 // left edge
    ctx.fillRect(capX + capW - 3, cy, 3, capH);      // right edge
  };
  const botY = topH + gap;
  shaft(x, 0, C.PIPE_W, topH - capH);
  cap(topH - capH);
  cap(botY);
  shaft(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
}

// Plain body + 2 caps skeleton; `decorate({x, topH, botY, capX, capW, capH})` paints
// theme detail (rivets / brick lines / warning stripes) over it. Shared by
// rocket/wizard/robot.
function framedPipe(x, topH, gap, { bodyColor, capColor, capH, capW, decorate }) {
  const capX = x - (capW - C.PIPE_W) / 2;
  const botY = topH + gap;
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x, 0, C.PIPE_W, topH - capH);
  ctx.fillRect(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
  ctx.fillStyle = capColor;
  ctx.fillRect(capX, topH - capH, capW, capH);
  ctx.fillRect(capX, botY, capW, capH);
  if (decorate) decorate({ x, topH, botY, capX, capW, capH });
}

// Themes are built as loose object literals (optional anim/img/img2/bgLayers per
// avatar); type as a permissive record so render code can read those fields.
const THEMES: { [key: string]: any } = {
  bird: {
    label: 'Bird',
    sky: '#7ec8e3', ground: '#2b2b3b',
    cloudFill: 'rgba(255,255,255,0.82)',
    // Classic pixel-art green pipe: hard-edged body with bands and a chunky cap.
    drawPipe(x, topH, gap) {
      bandedPipe(x, topH, gap, { body: '#5aa02c', light: '#7ec850', dark: '#3a6e1a', edge: '#1f3d0e' });
    },
  },
  penguin: {
    label: 'Penguin',
    sky: '#bfe6f2', ground: '#dfeef5',
    cloudFill: 'rgba(255,255,255,0.9)',
    // Ice pillars: pale cyan body with bands and a frosted cap. Same construction.
    drawPipe(x, topH, gap) {
      bandedPipe(x, topH, gap, { body: '#7fc6dd', light: '#bce7f2', dark: '#4f9ab5', edge: '#2e6e85' });
    },
  },
  squid: {
    label: 'Squid',
    sky: '#0a3d52', ground: '#06212e',
    cloudFill: 'none',                        // underwater — no clouds at all
    anim: true,                               // 2-frame: tentacles tighten on flap
    // Kelp / coral columns: deep teal body with a glow band. Same construction (capH 26).
    drawPipe(x, topH, gap) {
      bandedPipe(x, topH, gap, { body: '#1f7a6a', light: '#3fbfa6', dark: '#0f4a40', edge: '#08332c', capH: 26 });
    },
  },
  rocket: {
    label: 'Rocket',
    sky: '#05071a', ground: '#1a1a2e',
    cloudFill: null, // stars instead
    // Metal station columns with cyan rivets.
    drawPipe(x, topH, gap) {
      framedPipe(x, topH, gap, {
        bodyColor: '#546e7a', capColor: '#546e7a', capH: 20, capW: C.PIPE_W + 10,
        decorate({ x, topH, botY, capH }) {
          ctx.fillStyle = '#00e5ff';
          for (let y = 10; y < topH - capH; y += 20) ctx.fillRect(x + 4, y, 4, 4);
          for (let y = botY + capH + 10; y < C.GROUND; y += 20) ctx.fillRect(x + 4, y, 4, 4);
        },
      });
    },
  },
  bee: {
    label: 'Bee',
    sky: '#fffde7', ground: '#388e3c',
    cloudFill: 'rgba(255,255,255,0.9)',
    drawPipe(x, topH, gap) {
      // Brown flower stalks with leaf caps
      const capH = 22, capW = C.PIPE_W + 14, capX = x - 7;
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(x + 8, 0, C.PIPE_W - 16, topH - capH);
      ctx.fillStyle = '#558b2f';
      ctx.fillRect(capX, topH - capH, capW, capH);
      const botY = topH + gap;
      ctx.fillStyle = '#558b2f';
      ctx.fillRect(capX, botY, capW, capH);
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(x + 8, botY + capH, C.PIPE_W - 16, C.GROUND - botY - capH);
    },
  },
  wizard: {
    label: 'Wizard',
    sky: '#1a0533', ground: '#4a4453',
    cloudFill: 'none',     // storm clouds + dust drawn as a dedicated bgLayer instead
    // Stone brick towers with mortar lines and moss-tinted caps.
    drawPipe(x, topH, gap) {
      framedPipe(x, topH, gap, {
        bodyColor: '#6d6875', capColor: '#6d6875', capH: 24, capW: C.PIPE_W + 10,
        decorate({ x, topH, botY, capX, capW, capH }) {
          ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
          for (let y = 8; y < topH - capH; y += 12) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + C.PIPE_W, y); ctx.stroke(); }
          for (let y = botY + capH + 8; y < C.GROUND; y += 12) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + C.PIPE_W, y); ctx.stroke(); }
          ctx.fillStyle = 'rgba(100,200,80,0.25)';
          ctx.fillRect(capX, topH - capH, capW, capH);
          ctx.fillRect(capX, botY, capW, capH);
        },
      });
    },
  },
  airplane: {
    label: 'Airplane',
    sky: '#aebfd0', ground: '#3a4150',   // overcast server-room haze
    cloudFill: 'rgba(255,255,255,0.7)',
    // Data-center server-rack towers: dark steel columns with rack-unit slots,
    // rows of status LEDs, and a vented cap. (Not buildings — racks.)
    drawPipe(x, topH, gap) {
      const capH = 22, capW = C.PIPE_W + 10, capX = x - 5;
      const body = '#2b313c', face = '#363d4a', edge = '#1a1e26', vent = '#11141a';
      const rack = (sy, sh) => {
        if (sh <= 0) return;
        ctx.fillStyle = body; ctx.fillRect(x, sy, C.PIPE_W, sh);
        ctx.fillStyle = face; ctx.fillRect(x + 4, sy, C.PIPE_W - 8, sh);   // recessed face
        ctx.fillStyle = edge; ctx.fillRect(x, sy, 2, sh); ctx.fillRect(x + C.PIPE_W - 2, sy, 2, sh);
        // rack-unit slots every 10px
        ctx.fillStyle = vent;
        for (let y = sy + 6; y < sy + sh - 4; y += 10) ctx.fillRect(x + 6, y, C.PIPE_W - 12, 3);
        // status LEDs (steady pattern → deterministic, no RNG in the sim path)
        for (let y = sy + 6; y < sy + sh - 4; y += 10) {
          ctx.fillStyle = ((y / 10) | 0) % 3 === 0 ? '#ff5252' : '#76ff03';
          ctx.fillRect(x + C.PIPE_W - 10, y, 2, 2);
        }
      };
      const cap = (cy) => {
        ctx.fillStyle = body; ctx.fillRect(capX, cy, capW, capH);
        ctx.fillStyle = edge; ctx.fillRect(capX, cy, capW, 2); ctx.fillRect(capX, cy + capH - 2, capW, 2);
        // cooling vents
        ctx.fillStyle = vent;
        for (let vx = capX + 5; vx < capX + capW - 4; vx += 6) ctx.fillRect(vx, cy + 5, 3, capH - 10);
      };
      const botY = topH + gap;
      rack(0, topH - capH);
      cap(topH - capH);
      cap(botY);
      rack(botY + capH, C.GROUND - botY - capH);
    },
  },
  robot: {
    label: 'Robot',
    sky: '#0d1f2d', ground: '#1c2a3a',
    cloudFill: null, // square data-packet clouds
    // Steel girders with yellow hazard-striped caps.
    drawPipe(x, topH, gap) {
      framedPipe(x, topH, gap, {
        bodyColor: '#37474f', capColor: '#37474f', capH: 20, capW: C.PIPE_W + 8,
        decorate({ topH, botY, capX, capW, capH }) {
          ctx.fillStyle = '#fdd835';
          for (let i = 0; i < 4; i++) {
            ctx.fillRect(capX + i * (capW / 4), topH - capH, capW / 8, capH);
            ctx.fillRect(capX + i * (capW / 4), botY, capW / 8, capH);
          }
          ctx.fillStyle = 'rgba(55,71,79,0.6)';
          ctx.fillRect(capX, topH - capH, capW, capH);
          ctx.fillRect(capX, botY, capW, capH);
        },
      });
    },
  },
};

// ─── PARALLAX SCENERY (pixel-art, cosmetic, per-theme) ──────────────────────────
// Each entry is a layer list ordered far→near. Layer.speed scales bgScroll: small =
// drifts slowly (distant), ~1 = tracks pipes (foreground). draw(offset) tiles a
// motif across the width via tileMotif. The ground sits at C.GROUND; motifs are
// anchored to it so they read as standing on the same floor as the pipes.
const G = () => C.GROUND;
// True when the round art style is active — the scenery primitives below branch on
// it so the style switch flips the whole background (parallax included), not just
// the sprites. Render-only: physics/replay never touch these, so determinism holds.
const isRound = () => gfxStyle === 'round';
// Small reusable scenery primitives. Each draws stepped/blocky in pixel mode and
// smooth (real curves) in round mode.
function pxRect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
// A hill (rounded mound) anchored to the ground: stepped in pixel mode, a smooth
// half-dome (quadratic) in round mode.
function pixelHill(x, w, h, c) {
  if (isRound()) {
    const cx = x + w / 2, baseY = G();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(cx, baseY - h * 2, x + w, baseY);  // bulge to ~h at the apex
    ctx.closePath();
    ctx.fill();
    return;
  }
  // Pixel mode: a rounded dome built from horizontal scanline blocks whose width
  // follows a cosine profile (wide at base, narrow at apex), quantized to a small
  // grid so it reads as crisp pixel-art rather than the old chunky ziggurat.
  const baseY = G(), cx = x + w / 2;
  const u = Math.max(4, Math.round(w / 28));                 // fine step → smooth silhouette
  for (let i = 0; i * u < h; i++) {
    const yy = baseY - i * u;
    const f = (i * u) / h;                                   // 0 at base → 1 at apex
    const halfW = (w / 2) * Math.cos(f * Math.PI / 2);       // cosine taper to a round top
    const qhw = Math.round(halfW / u) * u;
    if (qhw <= 0) break;
    pxRect(cx - qhw, yy - u, qhw * 2, u, c);
  }
}
// A disc: stepped circle in pixel mode, a true round arc in round mode.
function pixelDisc(cx, cy, r, c) {
  ctx.fillStyle = c;
  if (isRound()) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Finer step → rounder poles. Sample the circle at each row's vertical midpoint so
  // the top/bottom rows narrow instead of capping flat.
  const u = Math.max(2, Math.round(r / 9));
  for (let dy = -r; dy < r; dy += u) {
    const mid = dy + u / 2;                                  // midpoint of this row
    const dw = Math.sqrt(Math.max(0, r * r - mid * mid));
    if (dw <= 0) continue;
    ctx.fillRect(Math.round(cx - dw), Math.round(cy + dy), Math.round(dw * 2), u);
  }
}
// A jagged mountain peak anchored to the ground: a triangular massif with a
// secondary shoulder and (in pixel mode) a stepped/serrated silhouette rather than
// a smooth mound. Round mode draws clean straight ridgelines. `snow` (optional)
// caps the summit. Reads as a mountain, not a hill — used by the wizard theme.
function pixelPeak(x, w, h, c, snow) {
  const baseY = G(), apexX = x + w * 0.42, apexY = baseY - h;
  const shoulderX = x + w * 0.72, shoulderY = baseY - h * 0.55;
  if (isRound()) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.lineTo(apexX, apexY);
    ctx.lineTo(shoulderX, shoulderY);
    ctx.lineTo(x + w, baseY);
    ctx.closePath();
    ctx.fill();
    if (snow) {
      ctx.fillStyle = snow;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(apexX - h * 0.13, apexY + h * 0.2);
      ctx.lineTo(apexX, apexY + h * 0.14);
      ctx.lineTo(apexX + h * 0.13, apexY + h * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  // Pixel mode: fill the triangle as horizontal scanline blocks, with the left and
  // right edges quantized to a block grid so the slopes read as crisp stair-steps.
  const u = Math.max(5, Math.round(w / 26));
  for (let y = baseY; y > apexY; y -= u) {
    const f = (baseY - y) / h;                          // 0 at base → 1 at apex
    // left edge climbs to apex; right edge first follows the shoulder then the apex
    const lx = x + (apexX - x) * f;
    const rx = y > shoulderY
      ? (x + w) + (shoulderX - (x + w)) * ((baseY - y) / (baseY - shoulderY))
      : shoulderX + (apexX - shoulderX) * ((shoulderY - y) / (shoulderY - apexY));
    const qlx = Math.round(lx / u) * u, qrx = Math.round(rx / u) * u;
    pxRect(qlx, y - u, Math.max(u, qrx - qlx), u, c);
  }
  if (snow) {
    // a few stepped blocks at the summit
    pxRect(Math.round((apexX - u) / u) * u, apexY, u * 2, u, snow);
    pxRect(Math.round(apexX / u) * u, apexY + u, u, u, snow);
  }
}
// A conifer on a trunk: stacked stepped triangles in pixel mode, smooth rounded
// tiers (filled triangles with soft corners) in round mode.
function pixelTree(x, scale, leaf, trunk) {
  const s = scale, baseY = G();
  if (isRound()) {
    ctx.fillStyle = trunk;
    ctx.fillRect(x - 2 * s, baseY - 4 * s, 4 * s, 4 * s);         // trunk (kept blocky/short)
    ctx.fillStyle = leaf;
    for (let tier = 0; tier < 3; tier++) {
      const ty = baseY - (4 + tier * 5) * s, tw = (14 - tier * 3) * s, th = 7 * s;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);                                     // apex
      ctx.quadraticCurveTo(x - tw / 2, ty, x, ty);                // left skirt, soft
      ctx.quadraticCurveTo(x + tw / 2, ty, x, ty - th);           // right skirt, soft
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  pxRect(x - 2 * s, baseY - 4 * s, 4 * s, 4 * s, trunk);          // trunk
  for (let tier = 0; tier < 3; tier++) {
    const ty = baseY - (4 + tier * 5) * s, tw = (14 - tier * 3) * s;
    for (let r = 0; r < 5; r++) pxRect(x - tw / 2 + r * s, ty - r * s, tw - r * 2 * s, s, leaf);
  }
}

THEMES.bird.bgLayers = [
  // A sun in the corner with slowly rotating, breathing rays + an inner glow cap.
  { speed: 0, draw() {
      celestialBody(C.W - 120, 110, 38, '#ffd54f', {
        rays: { color: '255,213,79', count: 12, speed: 0.12 },
        caps: [{ dx: 0, dy: 0, r: 32, color: '#ffe57f' }],       // inner brighter core
      });
  } },
  // High drifting clouds that pass IN FRONT of the sun. Layer order = z-order: this
  // sits after the sun layer, so its clouds occlude it. Slow time-driven drift (not
  // parallax) so they sail across independently. Deterministic via index hashes.
  { speed: 0, draw() {
      const tt = nowSec();
      const span = C.W + 320;
      for (let i = 0; i < 5; i++) {
        const spd = 6 + hash01(i * 9.7) * 8;                     // each cloud its own pace
        const cx = ((hash01(i * 3.1) * span - tt * spd) % span + span) % span - 160;
        const cy = 60 + hash01(i * 5.3) * 110;
        const w = 90 + hash01(i * 7.9) * 70, h = 34 + hash01(i * 2.7) * 16;
        pixelCloud(cx, cy, w, h, 'rgba(255,255,255,0.85)');
      }
  } },
  // Distant rolling hills
  { speed: 0.15, draw(o) { tileMotif(o, 360, x => { pixelHill(x, 320, 120, '#6aa84f'); pixelHill(x + 180, 260, 90, '#7cb85f'); }); } },
  // Distant birds gliding across the sky (shared wanderers engine) — little "M"
  // silhouettes whose wings beat via the flap phase. Slow flap → distant soaring.
  { speed: 0, draw() {
      wanderers(
        [
          { drift: 26,  baseY: 150, yAmp: 30, wy: 0.5, sy: 1.1, bank: 0.25, flapHz: 3.5 },
          { drift: 22,  baseY: 200, yAmp: 26, wy: 0.7, sy: 1.4, bank: 0.25, flapHz: 4.0 },
          { drift: 30,  baseY: 110, yAmp: 22, wy: 0.4, sy: 0.9, bank: 0.25, flapHz: 3.0 },
        ],
        (i, t, flap) => {
          // an "M" gull silhouette; wing tips rise on the flap, dip between beats
          const up = flap ? 5 : 2;
          ctx.strokeStyle = 'rgba(40,50,60,0.7)';
          ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(-7, 0);
          ctx.lineTo(-2, -up);
          ctx.lineTo(0, -1);                                     // small body dip
          ctx.lineTo(2, -up);
          ctx.lineTo(7, 0);
          ctx.stroke();
          ctx.lineWidth = 1;
        });
  } },
  // Distant rolling hills
  { speed: 0.15, draw(o) { tileMotif(o, 360, x => { pixelHill(x, 320, 120, '#6aa84f'); pixelHill(x + 180, 260, 90, '#7cb85f'); }); } },
  // Near treeline
  { speed: 0.5, draw(o) { tileMotif(o, 200, x => { pixelTree(x + 40, 4, '#2e7d32', '#5d4037'); pixelTree(x + 130, 3, '#388e3c', '#5d4037'); }); } },
];

THEMES.penguin.bgLayers = [
  // Distant icebergs / ice shelf
  { speed: 0.14, draw(o) { tileMotif(o, 380, x => { pixelHill(x, 300, 110, '#9cd2e6'); pixelHill(x + 190, 240, 80, '#b6e2f0'); }); } },
  // Foreground snow mounds with a small ice floe crack
  { speed: 0.5, draw(o) { tileMotif(o, 220, x => {
      pixelHill(x + 20, 160, 46, '#ffffff');                     // snow mound
      pixelHill(x + 140, 120, 34, '#eaf6fb');                    // smaller mound
      pxRect(x + 90, G() - 6, 30, 2, '#9cd2e6');                 // floe crack
  }); } },
  // Falling snow — same particle engine as squid bubbles, but dir=+1 (down) and a
  // soft-flake style. Near flakes bigger/faster/brighter (parallax depth).
  { speed: 0, draw() {
      particleStream(90, +1,
        { minSpd: 22, spanSpd: 70, minSway: 8, spanSway: 22, minR: 1.5, spanR: 3, minA: 0.4, spanA: 0.55 },
        (x, y, r, a) => {
          const col = `rgba(255,255,255,${a})`;
          if (isRound()) pixelDisc(x, y, r, col);
          else { ctx.fillStyle = col; const s = Math.round(r * 2); ctx.fillRect(Math.round(x), Math.round(y), s, s); }
        });
  } },
];

THEMES.squid.bgLayers = [
  // Bubbles rising from the seabed — same particle engine as penguin snow, but
  // dir=-1 (up) and a hollow-ring bubble style. Near bubbles bigger/faster (depth).
  { speed: 0, draw() {
      particleStream(46, -1,
        { minSpd: 16, spanSpd: 42, minSway: 4, spanSway: 10, minR: 3, spanR: 11, minA: 0.10, spanA: 0.10 },
        (x, y, r, a) => {
          pixelDisc(x, y, r, `rgba(150,230,255,${a + 0.06})`);
          pixelDisc(x, y, Math.max(1, r - 3), `rgba(180,240,255,${a})`); // hollow ring
        });
  } },
  // Foreground: tall swaying-look algae stalks (static curve via stepped offset)
  { speed: 0.55, draw(o) { tileMotif(o, 240, x => {
      const algae = (ax, h, c) => {
        if (isRound()) {
          // smooth swaying kelp: a tapered quadratic ribbon leaning side to side
          const topY = G() - h;
          ctx.strokeStyle = c;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(ax + 3, G());
          ctx.quadraticCurveTo(ax + 14, G() - h * 0.5, ax + 3, topY);  // single graceful S
          ctx.lineWidth = 7;
          ctx.stroke();
          ctx.lineWidth = 1;
          return;
        }
        // stepped stalk that leans alternately — reads like kelp without RNG
        for (let i = 0, y = G(); y > G() - h; i++, y -= 10) {
          const sway = (i % 4 < 2 ? 1 : -1) * (i % 2 ? 3 : 0);
          pxRect(ax + sway, y - 10, 6, 11, c);
        }
      };
      algae(x + 30, 210, '#1f8a5a');
      algae(x + 70, 150, '#27a06a');
      algae(x + 150, 240, '#176e48');
      algae(x + 195, 130, '#27a06a');
      // (static foreground bubbles removed — the rising-bubble layer covers this)
  }); } },
];

THEMES.bee.bgLayers = [
  // Soft green hills
  { speed: 0.18, draw(o) { tileMotif(o, 300, x => { pixelHill(x, 280, 100, '#9ccc65'); pixelHill(x + 150, 220, 70, '#aed581'); }); } },
  // Flower stalks + small trees up front — blooms sway in the breeze (tiled; a
  // repeating meadow reads naturally, unlike repeating insects).
  { speed: 0.55, draw(o) { tileMotif(o, 170, x => {
      const t = nowSec();
      pixelTree(x + 30, 3, '#558b2f', '#6d4c41');
      const sway = Math.sin(t * 1.8 + x * 0.01) * 4;
      pxRect(x + 110, G() - 26, 2, 26, '#33691e');               // stem
      pxRect(x + 106 + sway, G() - 32, 10, 8, '#ec407a');        // bloom (sways)
      pxRect(x + 109 + sway, G() - 30, 4, 4, '#ffeb3b');         // center
  }); } },
  // A few free-roaming bees on distinct wandering paths (shared wanderers engine).
  { speed: 0, draw() {
      wanderers(
        [
          { drift: 38,  baseY: G() - 110, yAmp: 40, wy: 0.8, sy: 1.7, flapHz: 30 },
          { drift: -27, baseY: G() - 180, yAmp: 55, wy: 1.2, sy: 2.5, flapHz: 33 },
          { drift: 31,  baseY: G() - 240, yAmp: 35, wy: 0.6, sy: 1.3, flapHz: 28 },
        ],
        (i, t, flap) => {
          const wf = flap ? -2 : -3;                             // wing flutter
          pixelDisc(-1, wf, 2, 'rgba(255,255,255,0.75)');        // wing
          pixelDisc(2, wf, 2, 'rgba(255,255,255,0.75)');         // wing
          pixelDisc(0, 0, 3.2, '#ffca28');                       // body
          ctx.fillStyle = '#3a2a10';
          ctx.fillRect(-2, -1, 1, 3);                            // stripe
          ctx.fillRect(1, -1, 1, 3);                             // stripe
        });
  } },
];

// Lightning strength for the wizard theme: a sharp flash that decays, firing every
// ~3.5s with a double-blink. Returns 0 (dark) … 1 (full flash). Render-only. Short
// period so a strike is always near — no long wait to see one after switching.
function wizardFlash() {
  const t = nowSec();
  const period = 3.5;
  const into = t % period;                  // seconds since last strike began
  if (into > 0.6) return 0;                  // dark most of the cycle
  // two quick blinks inside the first 0.6s, exponential-ish decay
  const a = Math.max(0, 1 - into / 0.25);
  const b = into > 0.3 ? Math.max(0, 1 - (into - 0.3) / 0.2) * 0.7 : 0;
  return Math.max(a, b);
}

THEMES.wizard.bgLayers = [
  // Heavy storm clouds: dark, low, slow-drifting banks across the top of the sky.
  // They brighten briefly with each lightning flash (lit from within the storm).
  { speed: 0, draw() {
      const t = nowSec();
      const f = wizardFlash();
      const drift = (t * 12) % (C.W + 300);                    // slow leftward roll
      const base = `rgba(${44 + f * 90},${38 + f * 80},${64 + f * 90},`;
      for (let k = 0; k < 6; k++) {
        const cx = ((k * 280 - drift + C.W + 300) % (C.W + 300)) - 150;
        const cy = 40 + (k % 3) * 34;
        const w = 200 + (k % 2) * 80, h = 70 + (k % 3) * 16;
        // each bank = a clump of overlapping lobes, denser/darker than fair clouds
        pixelCloud(cx, cy, w, h, base + (0.85) + ')');
        pixelCloud(cx + 50, cy + 14, w * 0.7, h * 0.8, base + (0.7) + ')');
      }
  } },
  // Wind-blown dust: fine particles streaking right→left, faster than the clouds.
  { speed: 0, draw() {
      const t = nowSec();
      for (let i = 0; i < 80; i++) {
        const spd = 120 + (i % 6) * 40;                        // gusty range
        const x = C.W - ((t * spd + i * 137) % (C.W + 60)) + 30; // right→left
        const y = (i * 89 + 20) % (C.GROUND - 30) + Math.sin(t * 2 + i) * 6;
        const len = 5 + (i % 4) * 3;
        const a = 0.12 + (i % 5) * 0.05;
        ctx.strokeStyle = `rgba(200,185,225,${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + 1); ctx.stroke(); // streak trails behind
      }
  } },
  // Lightning: a full-sky flash painted behind the mountains on a periodic strike.
  { speed: 0, draw() {
      const f = wizardFlash();
      if (f <= 0) return;
      ctx.fillStyle = `rgba(200,190,255,${0.55 * f})`;
      ctx.fillRect(0, 0, C.W, C.GROUND);
      // a jagged bolt down from the sky on the stronger blinks
      if (f > 0.5) {
        ctx.strokeStyle = `rgba(255,255,255,${f})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let bx = C.W * 0.62, by = 0;
        ctx.moveTo(bx, by);
        for (let s = 0; s < 6; s++) { bx += (s % 2 ? 26 : -22); by += 48; ctx.lineTo(bx, by); }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
  } },
  // Jagged purple mountain range — overlapping snow-capped peaks
  { speed: 0.12, draw(o) { tileMotif(o, 420, x => {
      pixelPeak(x - 40, 300, 200, '#3a2a5a', '#d8cfe8');
      pixelPeak(x + 150, 260, 160, '#4a3a6e', '#cfc4e0');
      pixelPeak(x + 320, 220, 130, '#332551');
  }); } },
  // A castle on the mid ridge — windows brighten with each lightning flash
  { speed: 0.35, draw(o) { tileMotif(o, 520, x => {
      const bx = x + 60, by = G(), c = '#5a5566', d = '#403c4a';
      const f = wizardFlash();
      const win = `rgba(255,213,79,${0.85 + 0.15 * f})`;          // base warm, flares on flash
      pxRect(bx, by - 70, 120, 70, c);                            // keep
      for (let t = 0; t < 4; t++) pxRect(bx - 10 + t * 40, by - 92, 20, 26, c); // battlement towers
      for (let t = 0; t < 4; t++) pxRect(bx - 6 + t * 40, by - 100, 12, 10, d); // tower caps
      pxRect(bx + 50, by - 40, 20, 40, d);                        // gate
      ctx.fillStyle = win; ctx.fillRect(bx + 18, by - 56, 8, 8); ctx.fillRect(bx + 94, by - 56, 8, 8); // lit windows
  }); } },
];

THEMES.airplane.bgLayers = [
  // FAR skyline: a dim, slow row of distant slabs for depth (behind everything).
  { speed: 0.07, draw(o) { tileMotif(o, 300, (x, tile) => {
      const far = (sx, w, h) => {
        const topY = G() - h;
        pxRect(sx, topY, w, h, '#3c4659');                         // hazed-out silhouette
        for (let yy = topY + 12; yy < G() - 20; yy += 20)
          for (let xx = sx + 8; xx < sx + w - 8; xx += 18) {
            if ((xx + yy) % 3 === 0) { ctx.fillStyle = 'rgba(255,224,150,0.18)'; ctx.fillRect(xx, yy, 5, 6); }
          }
      };
      // procedural distant slabs keyed to a stable per-building id
      let sx = x;
      for (let i = 0; i < 3; i++) {
        const id = tile * 3 + i;
        const w = 50 + Math.floor(hash01(id * 2.3) * 50);
        const h = 80 + Math.floor(hash01(id * 5.1) * 100);
        far(sx, w, h);
        sx += w + 14 + Math.floor(hash01(id * 7.7) * 24);
      }
  }); } },
  // Crossing planes high in the sky — the theme mascot. Distant, slow, with blinking
  // red (port) + green (starboard) nav lights and a steady white fuselage strobe.
  { speed: 0, draw() {
      wanderers(
        [
          { drift: 34, baseY: 90,  yAmp: 10, wy: 0.25, sy: 0.6, bank: 0.15, flapHz: 6 },
          { drift: -24, baseY: 150, yAmp: 14, wy: 0.3, sy: 0.7, bank: 0.15, flapHz: 5 },
        ],
        (i, t, flap) => {
          ctx.fillStyle = '#aeb9cc';
          pxRect(-12, -1, 24, 3, '#aeb9cc');                       // fuselage
          pxRect(-3, -5, 8, 11, '#aeb9cc');                        // wings
          pxRect(-12, -3, 3, 5, '#8c98ad');                        // tail
          const nav = Math.sin(t * 4 + i) > 0;
          pixelDisc(12, 0, 1.6, nav ? 'rgba(120,255,120,0.95)' : 'rgba(120,255,120,0.2)'); // starboard green
          pixelDisc(-3, 6, 1.6, nav ? 'rgba(255,60,60,0.2)' : 'rgba(255,60,60,0.95)');     // port red
          if (flap) pixelDisc(0, -5, 1.4, 'rgba(255,255,255,0.9)'); // white strobe
        });
  } },
  // Rooftop searchlights: rotating beam cones raking up into the haze.
  { speed: 0.16, draw(o) { tileMotif(o, 460, x => {
      const t = nowSec();
      const light = (sx, baseY, phase) => {
        const ang = -Math.PI / 2 + Math.sin(t * 0.5 + phase) * 0.7; // sweeps overhead
        const len = 230, spread = 0.09;
        const grad = ctx.createLinearGradient(sx, baseY, sx + Math.cos(ang) * len, baseY + Math.sin(ang) * len);
        grad.addColorStop(0, 'rgba(200,225,255,0.22)');
        grad.addColorStop(1, 'rgba(200,225,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(sx, baseY);
        ctx.lineTo(sx + Math.cos(ang - spread) * len, baseY + Math.sin(ang - spread) * len);
        ctx.lineTo(sx + Math.cos(ang + spread) * len, baseY + Math.sin(ang + spread) * len);
        ctx.closePath(); ctx.fill();
        pixelDisc(sx, baseY, 3, 'rgba(220,235,255,0.8)');          // the lamp
      };
      light(x + 60, G() - 150, 0);
      light(x + 300, G() - 110, 2.1);
  }); } },
  // MAIN hazy data-center skyline (rows of windowed slabs)
  { speed: 0.16, draw(o) { tileMotif(o, 340, (x, tile) => {
      const t = nowSec();
      const SLAB_COLS = ['#56607a', '#626c88', '#4c5570', '#5a6480', '#454e68'];
      // procedurally vary each slab: width, height, color, window-pitch, whether it
      // has a mast, whether it has an ad board. All hashed off a stable per-slab id
      // so a given building keeps its look while it scrolls.
      const slab = (sx, w, h, seed) => {
        const topY = G() - h;
        const c = SLAB_COLS[seed % SLAB_COLS.length];
        pxRect(sx, topY, w, h, c);
        const round = isRound();
        const pitchX = 12 + Math.floor(hash01(seed * 3) * 6);          // window column spacing
        const pitchY = 14 + Math.floor(hash01(seed * 5) * 6);          // window row spacing
        // Lit office windows — most steady-warm, a few flicker; density per building.
        let cell = 0;
        for (let yy = topY + 10; yy < G() - 8; yy += pitchY)
          for (let xx = sx + 8; xx < sx + w - 6; xx += pitchX, cell++) {
            const flick = (seed * 5 + cell * 11) % 6 === 0;            // ~1 in 6 flickers
            const dark = hash01(seed * 13 + cell) < 0.18;              // some windows unlit
            const a = dark ? 0.12 : flick ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 4 + cell)) : 0.92;
            const col = `rgba(255,224,130,${a})`;
            if (round) { pixelDisc(xx + 3, yy + 4, 3.5, col); }
            else { ctx.fillStyle = col; ctx.fillRect(xx, yy, 7, 9); }
          }
        // Rooftop antenna mast with a blinking red aviation-warning beacon (~70%).
        if (hash01(seed * 7) > 0.3) {
          const mx = sx + Math.round(w * (0.35 + hash01(seed * 11) * 0.3));
          const mastH = 16 + Math.floor(hash01(seed * 17) * 16);
          ctx.fillStyle = '#2b333f';
          ctx.fillRect(mx - 1, topY - mastH, 2, mastH);
          const blink = 0.35 + 0.65 * (Math.sin(t * 3.2 + seed) > 0 ? 1 : 0.2);
          pixelDisc(mx, topY - mastH - 2, 3.5, `rgba(255,40,40,${blink})`);
        }
        // Backlit ad board on the slab face — most tall-enough slabs carry one.
        if (h > 100 && hash01(seed * 19) > 0.25) {
          const bw = Math.min(w - 12, 90 + Math.floor(hash01(seed * 23) * 36));
          const bh = 44 + Math.floor(hash01(seed * 29) * 16);
          const warm = hash01(seed * 31) > 0.5;
          adBillboard(sx + Math.round((w - bw) / 2), topY + 18, bw, bh,
            warm ? '255,196,90' : '120,200,255', AD_AIRPLANE, seed);
        }
      };
      // three slabs per tile, each with procedural width/height keyed to its stable id.
      let sx = x;
      for (let i = 0; i < 3; i++) {
        const id = tile * 3 + i;                                       // stable per-slab id
        const w = 70 + Math.floor(hash01(id * 2) * 60);
        const h = 110 + Math.floor(hash01(id * 41) * 130);
        slab(sx, w, h, id);
        sx += w + 20 + Math.floor(hash01(id * 37) * 26);              // varied gap
      }
  }); } },
  // Drifting haze band: a soft mist gradient low over the skyline, slowly scrolling.
  { speed: 0, draw() {
      const t = nowSec();
      const top = G() - 150;
      const grad = ctx.createLinearGradient(0, top, 0, G());
      grad.addColorStop(0, 'rgba(174,185,205,0)');
      grad.addColorStop(1, 'rgba(174,185,205,0.28)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, top, C.W, 150);
      // a couple of denser mist puffs drifting through
      const drift = (t * 14) % (C.W + 400);
      for (let k = 0; k < 4; k++) {
        const cx = ((k * 360 - drift + C.W + 400) % (C.W + 400)) - 200;
        pixelCloud(cx, G() - 70, 240, 50, 'rgba(190,200,218,0.12)');
      }
  } },
  // Foreground cooling units / satellite dishes — dish slowly rotating + link LED.
  { speed: 0.5, draw(o) { tileMotif(o, 240, x => {
      const t = nowSec();
      pxRect(x + 30, G() - 40, 60, 40, '#37474f');               // AC unit
      pxRect(x + 38, G() - 34, 44, 12, '#263238');              // vents
      // blinking AC status LED
      const led = Math.sin(t * 2.5 + x) > 0.3;
      pixelDisc(x + 84, G() - 36, 2, led ? 'rgba(120,255,140,0.9)' : 'rgba(120,255,140,0.2)');
      // satellite dish that slowly pans back and forth
      const mastX = x + 153, mastY = G() - 30;
      pxRect(x + 150, G() - 30, 6, 30, '#455a64');               // dish mast
      ctx.save();
      ctx.translate(mastX, mastY);
      ctx.rotate(Math.sin(t * 0.4 + x * 0.01) * 0.5);            // pan
      ctx.fillStyle = '#78909c';
      ctx.beginPath(); ctx.ellipse(0, -12, 16, 9, 0, 0, Math.PI * 2); ctx.fill(); // dish face
      ctx.fillStyle = '#9fb3c2';
      ctx.beginPath(); ctx.ellipse(0, -12, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
      pxRect(-1, -12, 2, 8, '#37474f');                          // feed arm
      ctx.restore();
  }); } },
  // Light rain — faint diagonal streaks (fits the overcast sky). Foreground-most.
  { speed: 0, draw() {
      const t = nowSec();
      ctx.strokeStyle = 'rgba(190,205,225,0.28)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 90; i++) {
        const spd = 420 + (i % 5) * 60;
        const x = (i * 173 + 20) % C.W - Math.sin(t) * 4;
        const y = (t * spd + i * 67) % (C.GROUND + 40) - 20;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 12); ctx.stroke(); // slight slant
      }
  } },
];

// Render-only wall clock (seconds) for cosmetic animation like pulsing lights.
// Never read by physics/replay, so determinism is untouched.
const nowSec = () => performance.now() / 1000;
// Parse a #rrggbb string into an `rgba(r,g,b,a)` with the given alpha — lets the
// neon window lights fade their brightness as they pulse.
function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// A field of vertically-streaming particles with parallax depth — the shared engine
// behind penguin snow (falling) and squid bubbles (rising). Each particle gets a
// stable pseudo-random "nearness" (near = bigger, faster, wider sway, brighter).
// `dir` = +1 falls down, -1 rises up. `drawOne(x, y, r, alpha)` paints one.
// Render-only + deterministic per index → animates identically everywhere.
function particleStream(count, dir, opt, drawOne) {
  const t = nowSec();
  const span = C.GROUND;
  for (let i = 0; i < count; i++) {
    const depth = ((i * 2654435761) % 1000) / 1000;          // stable 0..1
    const near = 0.25 + depth * 0.75;
    const baseX = (i * 197 + 30) % C.W;
    const spd = opt.minSpd + near * opt.spanSpd;
    const travel = (t * spd + i * 53) % span;
    const y = dir > 0 ? travel : (span - travel);            // down vs up + wrap
    const x = (baseX + Math.sin(t * 0.6 + i) * (opt.minSway + near * opt.spanSway)) % C.W;
    const r = opt.minR + near * opt.spanR;
    const a = opt.minA + near * opt.spanA;
    drawOne(x, y, r, a);
  }
}

// A few free-roaming creatures crossing the whole screen on distinct meandering
// paths — the shared engine behind the bee theme's bees and the bird theme's birds.
// Each creature: steady horizontal drift + a 2D Lissajous wander (two out-of-phase
// sines), wraps at the edges, and is canvas-translated to its position + rotated to
// face its heading. The caller's drawOne(i, t, flap) paints the body at the origin,
// where `flap` is a 0/1 wingbeat phase. NOT tiled → never reads as synced clones.
// `specs` = [{ drift, baseY, yAmp, wx, wy, sx, sy, bank, flapHz }]. Render-only.
function wanderers(specs, drawOne) {
  const t = nowSec();
  specs.forEach((s, i) => {
    const at = (tt) => {
      const px = (((tt * s.drift + i * 311) % (C.W + 120)) - 60);
      const py = s.baseY + Math.sin(tt * s.wy + i) * s.yAmp + Math.sin(tt * s.sy + i * 2) * 6;
      return [px, py];
    };
    const [px, py] = at(t);
    const [px2, py2] = at(t + 0.05);                         // sample ahead for heading
    const ang = Math.atan2(py2 - py, px2 - px);
    const flap = Math.sin(t * (s.flapHz ?? 28) + i) > 0 ? 1 : 0;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang * (s.bank ?? 0.4));                       // bank toward heading
    if (s.drift < 0) ctx.scale(-1, 1);                       // face travel direction
    drawOne(i, t, flap);
    ctx.restore();
  });
}

THEMES.robot.bgLayers = [
  // A big hazy neon moon/planet low on the horizon (drawn first, behind it all).
  { speed: 0, draw() {
      celestialBody(C.W - 220, 150, 64, '#1b2a4a', {
        caps: [{ dx: -18, dy: -10, r: 12, color: '#22345a' }, { dx: 14, dy: 16, r: 9, color: '#22345a' }],
      });
      // neon rim glow
      ctx.strokeStyle = 'rgba(0,229,255,0.25)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(C.W - 220, 150, 64, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
  } },
  // FAR neon skyline: dim, slow, narrow towers with cyan edge-glow for depth.
  { speed: 0.07, draw(o) { tileMotif(o, 280, x => {
      const far = (sx, w, h, edge) => {
        const topY = G() - h;
        pxRect(sx, topY, w, h, '#0a1722');
        ctx.fillStyle = edge; ctx.fillRect(sx, topY, w, 1);       // lit top edge
        ctx.fillStyle = withAlpha(edge, 0.25);
        for (let yy = topY + 8; yy < G() - 10; yy += 12) ctx.fillRect(sx + 3, yy, w - 6, 1);
      };
      far(x, 50, 150, '#00e5ff'); far(x + 80, 40, 110, '#76ff03'); far(x + 150, 60, 190, '#00e5ff');
  }); } },
  // Flying traffic: neon vehicles streaking across with a fading light trail.
  { speed: 0, draw() {
      wanderers(
        [
          { drift: 90,  baseY: 120, yAmp: 8,  wy: 0.2, sy: 0.5, bank: 0.1, flapHz: 9 },
          { drift: -70, baseY: 180, yAmp: 12, wy: 0.25, sy: 0.6, bank: 0.1, flapHz: 7 },
          { drift: 120, baseY: 90,  yAmp: 6,  wy: 0.15, sy: 0.4, bank: 0.1, flapHz: 11 },
        ],
        (i, t, flap) => {
          const col = i % 2 ? '255,40,200' : '0,229,255';
          const grad = ctx.createLinearGradient(0, 0, -26, 0);
          grad.addColorStop(0, `rgba(${col},0.9)`);
          grad.addColorStop(1, `rgba(${col},0)`);
          ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-26, 0); ctx.stroke(); // trail
          ctx.fillStyle = `rgba(${col},1)`;
          pxRect(0, -1, 6, 3, `rgba(${col},1)`);                  // body
          if (flap) pixelDisc(2, 0, 2, '#ffffff');               // headlight blink
          ctx.lineWidth = 1;
        });
  } },
  // Rising data packets: glowing bits float up between the towers (particleStream).
  { speed: 0, draw() {
      particleStream(40, -1,
        { minSpd: 30, spanSpd: 60, minSway: 3, spanSway: 8, minR: 1, spanR: 2.5, minA: 0.3, spanA: 0.5 },
        (x, y, r, a) => {
          const col = (Math.round(x + y) % 2) ? '0,229,255' : '118,255,3';
          ctx.fillStyle = `rgba(${col},${a})`;
          ctx.fillRect(Math.round(x), Math.round(y), Math.round(r + 1), Math.round(r + 1)); // square bits
        });
  } },
  // MAIN neon circuit-city skyline — towers with antenna spires, setback crowns and a
  // grid of pulsing window lights. Pixel mode = square lights blinking; round mode
  // = soft glowing dots. Each window has its own phase so the grid shimmers.
  { speed: 0.16, draw(o) { tileMotif(o, 380, (x, tile) => {
      const t = nowSec();
      const tower = (sx, w, h, edge, seed) => {
        const topY = G() - h, round = isRound();
        pxRect(sx, topY, w, h, '#10202e');
        // setback crown block on top (breaks the flat rectangle silhouette)
        const cw = Math.round(w * 0.55), cx = sx + Math.round((w - cw) / 2), ch = 16;
        pxRect(cx, topY - ch, cw, ch, '#10202e');
        ctx.fillStyle = edge;
        ctx.fillRect(cx, topY - ch, cw, 2);
        ctx.fillRect(sx, topY, w, 2);
        // pulsing window grid — each cell pulses on its own phase (deterministic in
        // position via seed+row+col, animated via the render clock t).
        const cols = Math.max(2, Math.floor((w - 10) / 14));
        const stepX = (w - 10) / cols;
        const rows = Math.max(1, Math.floor((h - 16) / 14));
        let cell = 0, row = 0;
        for (let yy = topY + 8; yy < G() - 8; yy += 14, row++) {
          for (let ci = 0; ci < cols; ci++, cell++) {
            const phase = ((seed * 7 + cell * 13) % 31) / 31 * 6.283;
            // brighter floor + full swing, plus a bright "data wave" sweeping up the
            // building (row-based) so the whole tower visibly ripples.
            const wave = 0.5 + 0.5 * Math.sin(t * 3 - row * 0.9 + seed);
            const lit = Math.min(1, 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.6 + phase)) * (0.5 + wave));
            const wx = sx + 6 + ci * stepX;
            if (round) {
              pixelDisc(Math.round(wx + 3), yy + 2, 4, withAlpha(edge, lit));
            } else {
              ctx.fillStyle = withAlpha(edge, lit);
              ctx.fillRect(Math.round(wx), yy, 8, 6);
            }
          }
        }
        // antenna mast + a data-pulse packet that climbs it, topped by a sweeping
        // magenta scanner beacon (the neon-city equivalent of an aviation light).
        const mx = sx + Math.round(w / 2), mastTop = topY - ch - 24, mastH = 24;
        ctx.fillStyle = edge;
        ctx.fillRect(mx - 1, mastTop, 2, mastH);
        const climb = (t * 40 + seed * 13) % mastH;               // packet rising up the mast
        ctx.fillStyle = withAlpha(edge, 0.9);
        ctx.fillRect(mx - 2, mastTop + mastH - climb - 3, 4, 3);
        const beacon = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 4 + seed));
        pixelDisc(mx, mastTop - 2, 5, `rgba(255,40,200,${beacon})`); // magenta scanner
      };
      // Two wide towers per tile (fewer, bigger than before). The taller one carries a
      // large billboard; alternate which side it sits on per tile so the skyline reads
      // varied as it scrolls.
      const tallLeft = tile % 2 === 0;
      const tallX = tallLeft ? x : x + 160, tallW = 150, tallH = 250;
      // Foreground tower overlaps the tall tower's near edge so it partly occludes the
      // billboard — same depth-layering the airplane skyline gets from its packed slabs.
      const shortX = tallLeft ? x + 120 : x + 50, shortW = 130, shortH = 180;
      // Draw the billboard tower FIRST (it's behind), then the foreground tower over it.
      tower(tallX, tallW, tallH, '#00e5ff', 3);
      // One large neon ad board, centered on the tall tower face. Width clamped inside
      // the tower so it never clips; seeded off the tile index so each tile cycles a
      // different slogan, desynced from its neighbours.
      const bw = 120, bh = 56;
      const bsx = tallX + Math.round((tallW - bw) / 2);
      adBillboard(bsx, G() - 215, bw, bh, '0,229,255', AD_ROBOT, tile);
      // Foreground tower last → overlaps and partly hides the board behind it.
      tower(shortX, shortW, shortH, '#76ff03', 2);
  }); } },
  // Neon perspective grid on the ground bar + a periodic scanline sweep over all.
  { speed: 0, draw() {
      const t = nowSec();
      // perspective grid: horizontal lines bunch toward the horizon, verticals fan out
      const horizon = G(), depth = C.HUD;
      ctx.strokeStyle = 'rgba(0,229,255,0.18)'; ctx.lineWidth = 1;
      for (let i = 1; i <= 6; i++) {
        const yy = horizon + (depth * i * i) / 36;                // quadratic spacing
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(C.W, yy); ctx.stroke();
      }
      const scroll = (t * 20) % 80;
      for (let vx = -C.W; vx < C.W * 2; vx += 80) {
        const fx = C.W / 2 + (vx + scroll - C.W / 2) * 2.2;        // fan from center
        ctx.beginPath(); ctx.moveTo(C.W / 2 + (vx - C.W / 2) * 0.3, horizon); ctx.lineTo(fx, horizon + depth); ctx.stroke();
      }
      // scanline: a faint bright bar rolling up the whole scene
      const sy = C.GROUND - ((t * 90) % (C.GROUND + 40));
      const grad = ctx.createLinearGradient(0, sy - 20, 0, sy + 20);
      grad.addColorStop(0, 'rgba(0,229,255,0)');
      grad.addColorStop(0.5, 'rgba(0,229,255,0.10)');
      grad.addColorStop(1, 'rgba(0,229,255,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, sy - 20, C.W, 40);
  } },
];

// Lighten a #rrggbb by `add` and return at alpha `a` — soft highlight helper.
function withAlphaFromHex(hex, a, add) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + add);
  const g = Math.min(255, ((n >> 8) & 255) + add);
  const b = Math.min(255, (n & 255) + add);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Unified celestial body ──────────────────────────────────────────────────────
// One function draws every sky disc — the bird's sun and all of rocket's planets/
// moon. Pass only the features a given body needs; everything is optional:
//   cx, cy, r, color           — position, radius, body fill (#rrggbb)
//   shade                      — true → soft offset highlight on the body
//   rays  {color, count, speed, wobble}            — sun spokes from the center
//   ring  {color, scale=2.1, ry=0.5, tilt=-0.35}   — tilted ellipse ring (Saturn)
//   bands [{dy, h, color}]     — latitude bands clipped to the body (gas giant)
//   spot  {dx, dy, r, color}   — a feature spot clipped to the body (red spot)
//   caps  [{dx, dy, r, color}] — polar caps / craters (plain discs on top)
//   moon  {dist, r, color, speed, craters?}        — a satellite orbiting the body
// Render-only + deterministic (animation via the shared render clock). Style-aware
// through pixelDisc / native ellipse, so it matches pixel vs round automatically.
function celestialBody(cx, cy, r, color, opt = {}) {
  const t = nowSec();
  const round = isRound();
  // Rays — fixed-length triangular spokes radiating from the center, rotating at a
  // steady rate. The whole crown pulses via opacity (not length), so it glows in and
  // out smoothly instead of the spokes jittering individually. Disc covers the roots.
  if (opt.rays) {
    const { color: rcol = '255,213,79', count = 12, speed = 0.15 } = opt.rays;
    const pulse = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.5)); // 0.45 … 0.70, gentle
    const len = r * 1.7, halfBase = (Math.PI / count) * 0.6;     // spoke length + width
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((t * speed) % (Math.PI * 2));
    ctx.fillStyle = `rgba(${rcol},${pulse})`;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - halfBase) * r, Math.sin(a - halfBase) * r);   // base, one side
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);                     // tip
      ctx.lineTo(Math.cos(a + halfBase) * r, Math.sin(a + halfBase) * r);   // base, other side
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  // Ring back half (drawn behind the body).
  if (opt.ring) {
    const { color: rc, scale = 2.1, ry = 0.5, tilt = -0.35 } = opt.ring;
    if (round) {
      ctx.strokeStyle = rc; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(cx, cy, r * scale, r * ry, tilt, Math.PI, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  // Body.
  pixelDisc(cx, cy, r, color);
  if (opt.shade) pixelDisc(cx - r * 0.3, cy - r * 0.3, r * 0.55, withAlphaFromHex(color, 0.25, 40));
  // Latitude bands + feature spot, clipped to the body.
  if (opt.bands || opt.spot) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    for (const b of (opt.bands || [])) pxRect(cx - r * 1.2, cy + b.dy, r * 2.4, b.h, b.color);
    if (opt.spot) pixelDisc(cx + opt.spot.dx, cy + opt.spot.dy, opt.spot.r, opt.spot.color);
    ctx.restore();
  }
  // Ring front half (over the body).
  if (opt.ring && round) {
    const { color: rc, scale = 2.1, ry = 0.5, tilt = -0.35 } = opt.ring;
    ctx.strokeStyle = rc; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(cx, cy, r * scale, r * ry, tilt, 0, Math.PI); ctx.stroke();
    ctx.lineWidth = 1;
  } else if (opt.ring && !round) {
    pxRect(cx - r * 2, cy - 3, r * 4, 6, opt.ring.color);        // pixel mode: flat band
  }
  // Polar caps / craters — plain discs on top.
  for (const c of (opt.caps || [])) pixelDisc(cx + c.dx, cy + c.dy, c.r, c.color);
  // Orbiting moon — angle advances with the render clock.
  if (opt.moon) {
    const m = opt.moon;
    const a = (t * (m.speed ?? 0.6)) % (Math.PI * 2);
    const mx = cx + Math.cos(a) * m.dist, my = cy + Math.sin(a) * m.dist * 0.5; // elliptical orbit
    pixelDisc(mx, my, m.r, m.color);
    for (const cr of (m.craters || [])) pixelDisc(mx + cr.dx, my + cr.dy, cr.r, cr.color);
  }
}

THEMES.rocket.bgLayers = [
  // Distant planets of varied types + a cratered moon. Slow parallax drift.
  { speed: 0.08, draw(o) { tileMotif(o, 760, x => {
      // 1) Saturn-type ringed gas giant, with a small moon orbiting it
      celestialBody(x + 120, 130, 34, '#c97b5a', {
        shade: true,
        ring: { color: '#e0b88a' },
        moon: { dist: 70, r: 5, color: '#cfd8dc', speed: 0.7 },
      });
      // 2) Banded gas giant (Jupiter-like) — two latitude bands + a great red spot
      celestialBody(x + 330, 200, 28, '#d9a86b', {
        shade: true,
        bands: [{ dy: -8, h: 5, color: 'rgba(140,90,50,0.55)' }, { dy: 5, h: 4, color: 'rgba(160,110,70,0.5)' }],
        spot: { dx: 8, dy: 3, r: 6, color: 'rgba(200,80,60,0.6)' },
      });
      // 3) Small rocky ice planet (pale blue) with a polar cap
      celestialBody(x + 520, 95, 16, '#8fd3e0', {
        caps: [{ dx: 0, dy: -10, r: 6, color: '#eaffff' }],
      });
      // 4) Cratered moon
      celestialBody(x + 650, 160, 18, '#cfd8dc', {
        caps: [{ dx: -6, dy: -4, r: 4, color: '#b0bec5' }, { dx: 6, dy: 6, r: 3, color: '#b0bec5' }],
      });
  }); } },
  // Shooting stars: streaks that periodically dart across the sky, each on its own
  // long cycle so they appear sporadically rather than in lockstep. Render-only.
  { speed: 0, draw() {
      const t = nowSec();
      // The star travels along a straight path (totalDX, slope); the trail is drawn
      // straight back along that SAME direction (unit velocity × len), so head and
      // tail always line up — no skew.
      const streak = (period, offset, y0, len, slope) => {
        const into = (t + offset) % period;
        if (into > 0.9) return;                                  // visible <1s per cycle
        const prog = into / 0.9;                                 // 0→1 across the screen
        const totalDX = C.W + 200;
        const hx = prog * totalDX - 100;                         // head x
        const hy = y0 + prog * slope;                            // head y
        // unit vector of travel, trail points opposite it
        const vlen = Math.hypot(totalDX, slope);
        const ux = totalDX / vlen, uy = slope / vlen;
        const fade = Math.sin(prog * Math.PI);                   // fade in+out at the ends
        const tx = hx - ux * len, ty = hy - uy * len;
        const grad = ctx.createLinearGradient(hx, hy, tx, ty);
        grad.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.lineWidth = 1;
      };
      streak(6.0, 0,   90,  120, 60);
      streak(9.0, 3.5, 220, 90,  40);
      streak(13.0, 7,  150, 150, 80);
  } },
];

// (Re)load every theme's sprite for the active art style. Pixel art wants crisp
// scaling; round art wants smooth — flip the canvas hint to match.
function loadSprites() {
  for (const [key, theme] of Object.entries(THEMES)) {
    theme.img = makeImg(`assets/${gfxStyle}/${key}.svg`);
    // Themes flagged `anim` get a second frame (<key>-2.svg) shown briefly on flap.
    // Render-only: never read by physics/replay, so determinism is unaffected.
    // Themes without it just keep using frame 1 (automatic single-frame fallback).
    theme.img2 = theme.anim ? makeImg(`assets/${gfxStyle}/${key}-2.svg`) : null;
  }
  applyStyle();
}
loadSprites();

let currentTheme: any = THEMES.penguin;  // penguin is the mascot / default avatar

// ─── HIGH SCORES — provided by scores.js ──────────────────────────────────────

// ─── SCREENS ──────────────────────────────────────────────────────────────────
const screens = {
  menu:     document.getElementById('menu-screen'),
  scores:   document.getElementById('scores-screen'),
  gameover: document.getElementById('gameover-screen'),
};
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  overlay.classList.remove('hidden');
  if (name) screens[name].classList.remove('hidden');
  else overlay.classList.add('hidden');
  // Fortune cow rides the idle screens (menu, game over) — not during play.
  if (name === 'menu' || name === 'gameover') showFortuneCow();
  else hideFortuneCow();
}

// ─── FORTUNE COW (avatar `cowsay`) ─────────────────────────────────────────────
// The `fortune` edge function gives us a line; here we are `cowsay -f <avatar>`:
// wrap the line in a speech balloon and staple the selected avatar's ASCII under
// it. ASCII cows are 7-bit art — they must be raw strings rendered in a true
// monospace <pre> (see #fortune-cow CSS), never the pixel font.
const COW_ART = {
  // Minimal cowsay-style line art: the classic `\  ^__^ \ (oo)` two-line tail
  // leading into a small, sparse figure. Sparse on purpose — reads cleanly at 11px.
  // Bird (secondary) — mid-flap, both wings spread. Most "flappy".
  bird: [
    '        \\',
    '         \\  \\(o)/',
    '          --( ; )--',
    '             > <',
    '             ^ ^',
  ].join('\n'),
  // Penguin — the mascot. Famously cannot fly. Deeply relatable.
  penguin: [
    '        \\   v',
    '         \\ (o>',
    '           //\\',
    '           V_/_',
  ].join('\n'),
  // Squid — mantle up, panic eyes, dangling tentacles. Should not be airborne.
  squid: [
    '        \\   ___',
    '         \\ /o o\\',
    '           \\ - /',
    '          /|/|\\|\\',
    '          \' \' \' \'',
  ].join('\n'),
  bee: [
    '        \\   \\|/',
    '         \\ (oo)',
    '           /##\\',
    '           ^  ^',
  ].join('\n'),
  wizard: [
    '        \\    n',
    '         \\  /*\\',
    '           (o.o)',
    '            \\=/',
  ].join('\n'),
  airplane: [
    '        \\',
    '         \\  __|__',
    '        --@--+--@--',
    '            ` `',
  ].join('\n'),
  rocket: [
    '        \\    /\\',
    '         \\  |oo|',
    '           /|  |\\',
    '            vvvv',
  ].join('\n'),
  robot: [
    '        \\    _',
    '         \\ [o o]',
    '           |_-_|',
    '           |   |',
  ].join('\n'),
};

const _COW_MAX = 40; // balloon inner width

function _cowBalloon(text) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if ((cur + ' ' + w).length <= _COW_MAX) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('');
  const width = Math.max(...lines.map(l => l.length));
  const out = [' ' + '_'.repeat(width + 2)];
  if (lines.length === 1) {
    out.push(`< ${lines[0].padEnd(width)} >`);
  } else {
    lines.forEach((l, i) => {
      const [lb, rb] = i === 0 ? ['/', '\\']
        : i === lines.length - 1 ? ['\\', '/'] : ['|', '|'];
      out.push(`${lb} ${l.padEnd(width)} ${rb}`);
    });
  }
  out.push(' ' + '-'.repeat(width + 2));
  return out.join('\n');
}

// `cowsay -f <currentAvatar>` <<< "<fortune>"
function _renderCow(text) {
  const key = Object.keys(THEMES).find(k => THEMES[k] === currentTheme) || 'penguin';
  const art = COW_ART[key] || COW_ART.penguin;
  return _cowBalloon(text) + '\n' + art;
}

const _fortuneEl = document.getElementById('fortune-cow');
let _currentFortune = null; // last fetched line — reused when only the avatar changes
// Fetch a fresh fortune and show the avatar saying it in the corner. Safe to call
// on every menu/loading/death screen; failures fall back to a local fortune.
async function showFortuneCow() {
  if (!_fortuneEl) return;
  try {
    _currentFortune = await fetchFortune();
    _fortuneEl.textContent = _renderCow(_currentFortune);
    _fortuneEl.classList.remove('hidden');
    requestAnimationFrame(() => _fortuneEl.classList.add('show'));
  } catch (e) {
    console.warn('showFortuneCow failed', e);
  }
}
// Re-skin the cow with the current avatar WITHOUT refetching — pure client render,
// zero Supabase egress. No-op if the cow isn't currently shown.
function reskinFortuneCow() {
  if (!_fortuneEl || _currentFortune == null || _fortuneEl.classList.contains('hidden')) return;
  _fortuneEl.textContent = _renderCow(_currentFortune);
}
function hideFortuneCow() {
  if (!_fortuneEl) return;
  _fortuneEl.classList.remove('show');
  _fortuneEl.classList.add('hidden');
}

// ─── CLOUDS (static decoration) ───────────────────────────────────────────────
const clouds = Array.from({ length: C.CLOUD_COUNT }, () => ({
  x: Math.random() * C.W,
  y: 40 + Math.random() * (C.GROUND - 120),
  w: 80 + Math.random() * 80,
  h: 40 + Math.random() * 30,
}));

// ─── DETERMINISM ──────────────────────────────────────────────────────────────
// All gameplay physics lives in the shared core (physics-core.ts): fixed-timestep
// + seeded RNG so a run is reproducible from {seed, flapTicks}, which is what the
// Supabase edge function replays to validate scores. The render loop below just
// drives the core's step() and draws the resulting state — it owns no physics.
const MAX_FRAME_MS = 250;            // clamp to avoid spiral-of-death after tab stalls

// ─── GAME STATE ───────────────────────────────────────────────────────────────
// gs IS the core's simulation state (player, pipes, score, tick, rng…). The
// renderer reads it but never mutates it — only step() does.
let gs: GameState;
let animId, currentPlayer, currentBest = null;
// True only during active gameplay (loop() is driving). While false, an idle
// animation loop redraws the menu background so time-based scenery effects (pulsing
// lights, drifting bubbles, lightning…) animate on the preview, not just in-game.
let gameActive = false;
let idleAnimId = 0;
// Wall-clock timestamp of the last flap, for the render-only 2-frame animation.
// Deliberately NOT tied to the sim tick — purely cosmetic, never feeds replay.
let lastFlapAt = -1e9;
const FLAP_FRAME_MS = 180; // how long frame 2 (the "push") shows after a flap
let countdownStart;
let acc, lastFrameTime;              // fixed-timestep bookkeeping (render side)
let seed, flapTicks;                 // replay inputs (captured for submission)
// Set by flap() and consumed by the NEXT physics tick, so the flap lands on the
// tick it's logged at — preserving the input-before-physics-per-tick ordering the
// server replay assumes. Mirrors the old "vy = FLAP immediately + push tick" code.
let pendingFlap = false;
// Parallax scroll offset — RENDER ONLY. Advanced per rendered frame by pipeSpeed,
// never read by physics/collision/replay, so determinism is untouched. Always
// pixel-art regardless of gfxStyle (the parallax is its own world).
let bgScroll = 0;

function initGame(playerName) {
  currentPlayer = playerName;
  // seed drives all gameplay-affecting randomness; createState seeds the core PRNG.
  seed = crypto.getRandomValues(new Uint32Array(1))[0];
  gs = createState(seed);
  flapTicks = [];
  pendingFlap = false;
  bgScroll = 0;
  countdownStart = performance.now();
  acc = 0;
  lastFrameTime = null;
}

// ─── DRAWING ──────────────────────────────────────────────────────────────────
function drawBackground() {
  const t = currentTheme;
  // Sky
  ctx.fillStyle = t.sky;
  ctx.fillRect(0, 0, C.W, C.GROUND);

  if (t.cloudFill === 'none') {
    // No clouds at all (e.g. squid — underwater).
  } else if (t.cloudFill === null && t.sky === THEMES.rocket.sky) {
    // Twinkling stars for space — each star's brightness pulses on its own phase.
    const tt = nowSec();
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137 + 11) % C.W, sy = (i * 97 + 7) % C.GROUND;
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tt * 2.5 + i * 1.7));
      const sz = i % 3 === 0 ? 2 : 1;
      ctx.fillStyle = `rgba(255,255,255,${tw})`;
      ctx.fillRect(sx, sy, sz, sz);
    }
  } else if (t.cloudFill === null) {
    // Robot: square data-packet clouds
    ctx.fillStyle = 'rgba(0,229,255,0.12)';
    for (const cl of clouds) {
      ctx.fillRect(cl.x, cl.y, cl.w, cl.h * 0.7);
    }
  } else {
    // Day themes: blocky pixel clouds (stepped silhouette, no curves).
    for (const cl of clouds) pixelCloud(cl.x, cl.y, cl.w, cl.h, t.cloudFill);
  }

  // ── Parallax scenery layers (pixel-art, cosmetic) ──
  // Each theme may define bgLayers: [{ speed, draw(offset) }]. Far layers use a
  // small speed (drift slowly), near layers a larger one. offset is the wrapped
  // horizontal scroll for that layer's tile width, handled by tileMotif.
  if (t.bgLayers) for (const layer of t.bgLayers) layer.draw(bgScroll * layer.speed);

  // Ground / HUD bar — pixel grass lip on top of a dirt bar.
  const px = 6; // pixel block size for ground detail
  ctx.fillStyle = t.ground;
  ctx.fillRect(0, C.GROUND, C.W, C.HUD);
  // grass strip
  ctx.fillStyle = '#5aa02c';
  ctx.fillRect(0, C.GROUND, C.W, px * 2);
  ctx.fillStyle = '#7ec850';
  for (let gx = 0; gx < C.W; gx += px * 2) ctx.fillRect(gx, C.GROUND, px, px); // dither highlights
  ctx.fillStyle = '#3a6e1a';
  ctx.fillRect(0, C.GROUND + px * 2, C.W, px); // shadow seam under grass
  // Dark wash over the HUD bar (below the grass lip) so the white HUD readout stays
  // legible regardless of the avatar's ground color (e.g. penguin's near-white ice).
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, C.GROUND + px * 3, C.W, C.HUD - px * 3);
}

// A cloud: stepped lozenge of hard rectangles in pixel mode, a puff of overlapping
// circles in round mode.
function pixelCloud(x, y, w, h, fill) {
  ctx.fillStyle = fill;
  if (isRound()) {
    const cy = y + h / 2, r = h / 2;
    // Three overlapping lobes across the width + a taller center lobe — reads as a
    // soft cumulus. Single fillStyle, so the overlaps don't double the alpha.
    ctx.beginPath();
    ctx.arc(x + r, cy, r, 0, Math.PI * 2);
    ctx.arc(x + w / 2, cy - r * 0.4, r * 1.25, 0, Math.PI * 2);
    ctx.arc(x + w - r, cy, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const u = Math.max(6, Math.round(h / 4)); // block unit
  ctx.fillRect(x, y + u, w, h - u * 2);            // mid band (full width)
  ctx.fillRect(x + u, y, w - u * 2, h);            // tall center
  ctx.fillRect(x + u * 2, y - u, w - u * 4, u);    // top bump
}

// Repeat a pixel-art motif horizontally with seamless wraparound. `tileW` is the
// motif's footprint; `offset` is the (positive) scroll distance. `drawOne(x)` paints
// a single motif at the given left x. We over-draw one tile on each side so motifs
// slide off-screen cleanly. Pure cosmetic — no game state touched.
// `drawOne(x, tile)` gets the wrapped screen x AND a STABLE tile index (which real
// tile this is in the infinite strip, independent of scroll) — hash off `tile` for
// per-building procedural variation that scrolls WITH the building, not the screen.
function tileMotif(offset, tileW, drawOne) {
  const start = -((offset % tileW) + tileW) % tileW; // wrapped into (-tileW, 0]
  const baseTile = Math.floor(offset / tileW);       // index of the tile at `start`
  for (let x = start, k = 0; x < C.W + tileW; x += tileW, k++) drawOne(Math.round(x), baseTile + k);
}

// Tiny deterministic hash → [0,1) from an integer. Used for procedural scenery
// variation (building heights, window seeds) that's stable per tile, no Math.random.
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// A neon ad billboard mounted on a building face: framed panel that cycles through
// a list of cloud-corp satire slogans, one at a time, with a slow swap + occasional
// power-flicker. `col` is "r,g,b". Deterministic-in-time (nowSec only) → no physics
// touch. Text uses the game's pixel font (Press Start 2P) so it reads as a real ad.
const EGG_RARITY = 14;   // ~1 in N slogan-cycles, a board glitches to an IT-error egg
// Per-page-load random offset so each visit/run starts on different slogans (procedural
// freshness). Render-only — billboards never touch physics/replay, so Math.random here
// is safe and cannot affect determinism.
const AD_LOAD_SEED = Math.floor(Math.random() * 9973);
function adBillboard(sx, sy, w, h, col, slogans, seed) {
  const t = nowSec();
  const period = 9;                                     // seconds per slogan (slow)
  // stride the start index by a coprime of the list length so neighbouring boards
  // (seed 0,1,2,3) show well-separated slogans, not adjacent ones.
  const cycle = Math.floor(t / period);
  // Easter egg: rarely (deterministic per board+cycle) the board glitches to an IT/auth
  // error instead of its themed ad. ~1 in EGG_RARITY cycles, so it's a catch-it-if-you-care
  // surprise, not a constant. hash01 keyed on cycle+seed → stable for the whole cycle.
  const eggRoll = hash01(cycle * 31 + seed * 7 + AD_LOAD_SEED);
  const isEgg = eggRoll < 1 / EGG_RARITY;
  const pool = isEgg ? AD_EGGS : slogans;
  const idx = (cycle + seed * 5 + AD_LOAD_SEED) % pool.length;
  const phase = (t / period + seed * 0.37) % 1;         // 0..1, desynced per board
  // fade in at the start, hold, fade out at the end (swap transition)
  const fade = Math.min(1, phase * 8) * Math.min(1, (1 - phase) * 8);
  // power-flicker: a brief, rare brownout, deterministic per seed
  const flick = Math.sin(t * 5 + seed * 9) > 0.985 ? 0.45 : 1;
  const lit = fade * flick;
  // panel + neon frame
  ctx.fillStyle = 'rgba(8,14,22,0.9)'; ctx.fillRect(sx, sy, w, h);
  ctx.strokeStyle = `rgba(${col},${0.85 * lit})`; ctx.lineWidth = 2;
  ctx.strokeRect(sx + 1, sy + 1, w - 2, h - 2);
  // text — shrink font until the wrapped block fits inside the panel (w & h).
  const text = pool[idx];
  const words = text.split(' ');
  const padX = 8, padY = 6;
  let fontPx = 12, lines = [];
  for (; fontPx >= 5; fontPx--) {
    ctx.font = `${fontPx}px "Press Start 2P", monospace`;
    lines = []; let cur = '';
    let fits = true;
    for (const word of words) {
      // a single word wider than the box at this size → too big, shrink more
      if (ctx.measureText(word).width > w - padX * 2) { fits = false; break; }
      const trial = cur ? cur + ' ' + word : word;
      if (ctx.measureText(trial).width > w - padX * 2 && cur) { lines.push(cur); cur = word; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    const blockH = lines.length * (fontPx + 4);
    if (fits && blockH <= h - padY * 2) break;          // fits in both axes
  }
  ctx.font = `${fontPx}px "Press Start 2P", monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lineH = fontPx + 4, blockH = lines.length * lineH;
  let ly = sy + h / 2 - blockH / 2 + lineH / 2;
  ctx.save();
  ctx.shadowColor = `rgba(${col},${lit})`; ctx.shadowBlur = 6;
  ctx.fillStyle = `rgba(${col},${lit})`;
  for (const line of lines) { ctx.fillText(line, sx + w / 2, ly); ly += lineH; }
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1;
}

// Building ad boards carry silly in-world ads, themed per setting (the airplane
// skyline = present-day consumer-ad satire; the robot city = sci-fi satire). A rare
// IT/auth error slips in as an easter egg via adBillboard's egg pool. Kept short so
// they wrap cleanly on a panel.

// Airplane theme: a hazy modern city — billboards for absurd present-day products,
// influencer/wellness/finance nonsense, the ads you actually scroll past.
const AD_AIRPLANE = [
  'BUY ONE GET ONE', 'NOW 30% LESS!', 'AS SEEN ON TV', 'LIMITED TIME ONLY',
  'NEW & IMPROVED', 'DOCTORS HATE IT', 'SUBSCRIBE TODAY', 'SMOOTHIE = SELFCARE',
  'CRYPTO TO THE MOON', 'INVEST IN VIBES', 'HUSTLE HARDER', 'LIVE LAUGH LEVERAGE',
  'GLUTEN-FREE AIR', 'ARTISANAL WATER', 'COLD BREW EVERYTHING', 'OAT MILK NATION',
  'INFLUENCE RESPONSIBLY', 'LIKE & SUBSCRIBE', 'GOING VIRAL SOON', 'TRUST ME BRO',
  'ELECTRIC & PROUD', 'CARBON-NEUTRAL*', 'WELLNESS JOURNEY', 'MANIFEST WEALTH',
  'BIGGER PHONE 16', 'NOW FOLDS TWICE', 'SMART FRIDGE 9000', 'IT HAS AN APP NOW',
  'PUMPKIN SPICE SZN', 'SKIP AD IN 5', 'BUY THE DIP', 'NFT YOUR DOG',
];

// Robot theme: a neon sci-fi megacity — billboards for cyberpunk consumer goods,
// off-world living, synthetic everything. Silly, dystopian-bright.
const AD_ROBOT = [
  'UPLOAD YOUR MIND', 'CLONE TODAY!', 'RENT A SKYCAR', 'MARS: NOW LEASING',
  'SYNTH-NOODLES 4U', 'NEURAL ADS LITE', 'BUY MORE OXYGEN', 'REPLACE YOUR ARM',
  'CHROME IS IN', 'JACK IN & CHILL', 'HOLO-PETS ON SALE', 'GROW A NEW LIVER',
  'MEMORY UPGRADES', 'FEELINGS DLC', 'DREAMS NOW ADFREE*', 'LIVE TO 200!',
  'ANTIGRAV MATTRESS', 'PROTEIN PASTE PRO', 'ROBO-NANNY 3000', 'DELETE YOUR FEARS',
  'OFFWORLD VISA OPEN', 'ANDROID DATING APP', 'LASER TEETH WHITEN', 'SLEEP IS OPTIONAL',
  'RENT-A-EMOTION', 'GENE-MOD MONDAYS', 'CITIZENSHIP TIER 3', 'BREATHE: PREMIUM',
  'TELEPORT RESPONSIBLY', 'YOUR CLONE MISSES U', 'HOVER OR DIE', 'NEON IS MANDATORY',
  // sci-fi deep cuts: Futurama
  'SLURM: ITS HIGHLY ADDICTIVE', 'DRINK BENDERS BREW', 'BLERNSBALL TONIGHT',
  'MOMCORP: WE OWN YOU', 'BACHELOR CHOW', 'SUICIDE BOOTH 25¢', 'WHY NOT ZOIDBERG?',
  'PLANET EXPRESS DELIVERS', 'AWAIT MOMS LOVE',
  // sci-fi deep cuts: Firefly
  'FRESH BLUE SUN GOODS', 'CANT STOP THE SIGNAL', 'SHINY! BUY NOW',
  'FRUITY OATY BARS', 'JAYNES HAT 9.99', 'ALLIANCE-APPROVED',
  'GORRAM GOOD DEALS', 'I AIM TO MISBEHAVE',
];

// Easter-egg pool: the only IT/auth-error slogans left. adBillboard surfaces one of
// these rarely (~1 in EGG_RARITY cycles per board) so a sharp-eyed player catches the
// game breaking character. Everything else stays in-world silly.
const AD_EGGS = [
  'ACCESS DENIED', 'POLICY: DENY', 'SESSION EXPIRED', '403 FORBIDDEN',
  '99.99% UPTIME*', 'EGRESS FEES APPLY', 'RECONFIRM IDENTITY', 'IT WORKS ON PROD',
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPipe(x, topH, gap) { currentTheme.drawPipe(x, topH, gap); }

// White text with a black outline so it stays legible on ANY background (e.g. the
// penguin's near-white sky/ground, where plain white vanishes). lineWidth scales
// with font size; outline is painted under the fill.
function strokedText(text, x, y, lineWidth = 4) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}

function drawCountdown(n) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, C.W, C.GROUND);
  ctx.font = `${C.H * 0.16}px ${activeStyle().fontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  strokedText(n > 0 ? n : 'GO!', C.W / 2, C.GROUND / 2, 8);
  ctx.textBaseline = 'alphabetic';
}

function drawPlayer() {
  // Render LARGER than the hitbox so the sprite looks meaty. The collision radius
  // (PLAYER_SIZE/2 - 4) is unchanged and stays mirrored in sim.ts — this is a
  // draw-only scale, so replay validation is unaffected. The pixel-art SVGs also
  // carry transparent padding, so the visible body roughly matches the hitbox.
  const s = C.PLAYER_SIZE * C.SPRITE_SCALE;
  // 2-frame avatars show frame 2 (the "push") for a beat after each flap; others
  // (img2 == null) always render frame 1. Render-only, so replay is unaffected.
  const inFlap = (performance.now() - lastFlapAt) < FLAP_FRAME_MS;
  const sprite = (inFlap && currentTheme.img2) ? currentTheme.img2 : currentTheme.img;
  ctx.save();
  ctx.translate(C.PLAYER_X, gs.player.y);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, gs.player.vy * 0.05)));
  ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function drawHUD() {
  ctx.font = `14px ${activeStyle().fontDisplay}`;
  ctx.textAlign = 'center';
  const sl = speedLevel(gs) + 1;
  // High is shown only when we have an authoritative value from Supabase.
  // currentBest === null means offline/unknown → omit it rather than show a stale number.
  const high = currentBest == null ? '' : `High: ${Math.max(gs.score, currentBest)}  |  `;
  strokedText(
    `Score: ${gs.score}  |  ${high}${currentPlayer}  |  Spd ${sl}`,
    C.W / 2, C.GROUND + 32, 4
  );
}

// Collision lives in the shared core (collides()); step() returns whether the
// player died this tick. The renderer never re-checks it.

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
// Advance physics exactly one fixed tick by driving the shared core's step().
// Deterministic: the core depends only on tick count + seeded rng + whether the
// player flapped this tick. We log the flap tick HERE (at consumption), which
// guarantees flapTicks stays strictly increasing with one entry per tick — what
// the server replay validates — even if two flaps land in the same frame.
// Returns true if the player died this tick.
function stepOnce() {
  const flapped = pendingFlap;
  if (flapped) { flapTicks.push(gs.tick); pendingFlap = false; }
  const { scored, dead } = step(gs, flapped);
  if (scored) AudioFX.score();       // side-effect kept in the render layer, not the core
  return dead;
}

function loop(now) {
  ctx.clearRect(0, 0, C.W, C.H);
  drawBackground();
  for (const p of gs.pipes) drawPipe(p.x, p.topH, p.gap);
  drawPlayer();
  drawHUD();

  // ── Countdown phase: freeze physics, show number ──
  // Countdown is purely cosmetic, so wall-clock timing is fine here.
  const elapsed = now - countdownStart;
  const remaining = Math.ceil(C.COUNTDOWN_SEC - elapsed / 1000);

  if (remaining > 0) {
    drawCountdown(remaining);
    lastFrameTime = now; // don't accumulate time spent in countdown
    animId = requestAnimationFrame(loop);
    return;
  }

  // One-frame "GO!" flash (remaining === 0, elapsed just crossed the threshold)
  if (elapsed < (C.COUNTDOWN_SEC + 0.35) * 1000) {
    drawCountdown(0);
  }

  // Advance the parallax scroll with the world. Render-only: tied to pipeSpeed so
  // scenery tracks pipe motion, but never fed into physics/replay.
  bgScroll += gs.pipeSpeed;

  // ── Active play: fixed-timestep accumulator ──
  // Advance physics in fixed TICK_MS steps regardless of monitor refresh rate,
  // so a 60Hz and a 144Hz machine produce identical runs.
  if (lastFrameTime === null) lastFrameTime = now;
  acc += Math.min(now - lastFrameTime, MAX_FRAME_MS); // clamp after tab stalls
  lastFrameTime = now;

  while (acc >= TICK_MS) {
    if (stepOnce()) { endGame(); return; }
    acc -= TICK_MS;
  }

  animId = requestAnimationFrame(loop);
}

async function startGame(playerName) {
  stopIdle();
  gameActive = true;
  showScreen(null);
  // Fetch the authoritative best from Supabase once, before the loop starts.
  // null ⇒ offline/unknown → HUD omits the High readout.
  currentBest = await fetchBest(playerName);
  initGame(playerName);
  animId = requestAnimationFrame(loop);
}

// Mock AWS-style error codes for flavor — deterministic-ish from the score so it
// feels like a real (absurd) policy denial rather than random noise.
const GO_ERRORS = [
  'AccessDenied: explicit deny in flappy-bird-boundary',
  'ThrottlingException: rate exceeded (gravity)',
  'InvalidGroundError: collision with s3://terra-firma',
  'TokenExpired: STS session ended mid-flight',
  'PolicyEvaluation: NotAuthorized to continue',
];

// Reveal the game-over screen: count the score up, set a fake error code, show msg.
function showGameOver(msg) {
  document.getElementById('gameover-msg').textContent = msg;
  document.getElementById('go-errcode').textContent =
    GO_ERRORS[gs.score % GO_ERRORS.length] + ` (req ${(gs.score * 7919 + 1009).toString(16)})`;
  overlay.classList.remove('hidden');
  showScreen('gameover');

  // Count-up animation on the score readout (display only — purely cosmetic).
  const el = document.getElementById('go-score-val');
  const target = gs.score, steps = Math.min(30, target) || 1, t0 = performance.now(), dur = 600;
  el.textContent = '0';
  (function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = Math.round(target * p);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

async function endGame() {
  cancelAnimationFrame(animId);
  gameActive = false;
  startIdle();           // resume animated menu/game-over background
  AudioFX.gameOver();

  const prev  = currentBest;            // authoritative best, or null when offline
  const finalScore = gs.score;
  const isNew = prev != null && finalScore > prev;
  // Replay payload for server-side validation — captured before initGame resets it.
  const replay = { seed, flapTicks };

  if (window.DEV_MODE) {
    // Skip the friction theater. saveScore self-gates on LIVE_DB, so this still
    // exercises the real Supabase round-trip when the DB is enabled locally.
    await saveScore(currentPlayer, finalScore, replay);
    showGameOver(isNew ? 'New high score! 🎉' : '');
    return;
  }

  Clave.startScoreSubmit(currentPlayer, finalScore, async () => {
    await saveScore(currentPlayer, finalScore, replay);
    showGameOver(
      isNew
        ? 'New high score! 🎉'
        : prev == null
          ? ''
          : `Best: ${Math.max(finalScore, prev)}`
    );
  });
  overlay.classList.remove('hidden'); // keep visible for CAPTCHA + submit screens
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function flap() {
  // Queue the flap for the next physics tick, which applies it to the core AND
  // logs that tick into flapTicks (see stepOnce). Routing input through the tick
  // boundary keeps browser play byte-identical to the server replay.
  pendingFlap = true;
  lastFlapAt = performance.now();      // trigger the render-only flap frame
  const key = Object.keys(THEMES).find(k => THEMES[k] === currentTheme) || 'penguin';
  AudioFX.flap(key);
}
document.addEventListener('keydown', e => {
  // e.repeat is true for OS auto-repeat while the key is held — ignore it so one
  // physical press = exactly one flap (must release + press again to flap again).
  if (e.code === 'Space' && !e.repeat && !overlay.classList.contains('hidden') === false) flap();
});
canvas.addEventListener('pointerdown', () => {
  if (overlay.classList.contains('hidden')) flap();
});

// ─── UI WIRING ────────────────────────────────────────────────────────────────
const nameInput  = document.getElementById('name-input');
const userSelect = document.getElementById('user-select');

async function populateUserSelect() {
  const data = _loadLocal(); // sync local read for the dropdown
  const names = Object.keys(data).sort();
  while (userSelect.options.length > 1) userSelect.remove(1);
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = n;
    userSelect.appendChild(opt);
  });
  userSelect.classList.toggle('hidden', names.length === 0);
  userSelect.value = '';
}

userSelect.addEventListener('change', () => {
  if (userSelect.value) nameInput.value = userSelect.value;
});

document.getElementById('btn-play').addEventListener('click', async () => {
  AudioFX.unlock(); // first user gesture — enable audio
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  // DB interaction (token) is self-gated on LIVE_DB inside ensurePlayerToken.
  // DEV_MODE independently controls only the SSO/captcha friction below.
  await ensurePlayerToken(name);
  if (window.DEV_MODE) { startGame(name); return; }
  showScreen(null);
  overlay.classList.remove('hidden');
  Clave.startLogin(name, () => startGame(name));
});

nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-play').click();
});

document.getElementById('btn-scores').addEventListener('click', async () => {
  const scores = await loadScores();
  const list = document.getElementById('scores-list');
  list.innerHTML = '';
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    list.innerHTML = '<li>No scores yet.</li>';
  } else {
    sorted.forEach(([name, sc]) => {
      const li = document.createElement('li');
      li.textContent = `${name}: ${sc}`;
      list.appendChild(li);
    });
  }
  showScreen('scores');
});

document.getElementById('btn-back').addEventListener('click', () => { populateUserSelect(); showScreen('menu'); });

document.getElementById('btn-recover-home').addEventListener('click', (e) => {
  e.preventDefault();
  // Token-only recovery — no name needed; the token resolves to its account.
  showRecoverModal().then(name => {
    if (!name) return;
    populateUserSelect();   // surface the recovered name in the picker
    nameInput.value = name; // and pre-fill it, ready to play
  });
});

document.getElementById('btn-retry').addEventListener('click', () => startGame(currentPlayer));

document.getElementById('btn-menu').addEventListener('click', () => { populateUserSelect(); showScreen('menu'); });

// ─── INIT ─────────────────────────────────────────────────────────────────────
// Build avatar picker (rebuildable so the art-style toggle can refresh thumbnails)
const avatarPicker = document.getElementById('avatar-picker');
const avatarPickerGo = document.getElementById('avatar-picker-go');
// Build the avatar picker into a container. Used for the menu picker AND the game-over
// picker (the latter lets players switch avatar and retry without redoing the login
// theater — retry skips auth). Selecting in one syncs the highlight in the other.
function buildAvatarPickerInto(container) {
  const selectedKey = Object.keys(THEMES).find(k => THEMES[k] === currentTheme) || 'penguin';
  container.innerHTML = '';
  container.classList.toggle('round-gfx', gfxStyle === 'round');
  // Penguin leads (it's the mascot); the rest follow in THEMES order.
  const ordered = ['penguin', ...Object.keys(THEMES).filter(k => k !== 'penguin')];
  ordered.forEach((key) => {
    const theme = THEMES[key];
    const div = document.createElement('div');
    div.className = 'avatar-opt' + (key === selectedKey ? ' selected' : '');
    div.dataset.key = key;
    div.innerHTML = `<img src="${theme.img.src}" alt="${theme.label}"><span>${theme.label}</span>`;
    div.addEventListener('click', () => selectAvatar(key));
    container.appendChild(div);
  });
}
// Apply an avatar choice and reflect it in every picker (menu + game-over).
function selectAvatar(key) {
  currentTheme = THEMES[key];
  document.querySelectorAll('.avatar-opt').forEach(d =>
    d.classList.toggle('selected', d.dataset.key === key));
  drawBackground();      // live preview (menu or game-over background)
  reskinFortuneCow();    // swap the corner cow to the new avatar (no refetch)
}
function buildAvatarPicker() {
  buildAvatarPickerInto(avatarPicker);
  buildAvatarPickerInto(avatarPickerGo);
}
buildAvatarPicker();

// Art-style toggle: a checkbox in the bottom-left corner. Checked → round graphics.
// Flips the STYLE key (fonts, smoothing, radii — all of it), persists, and refreshes
// sprites + thumbnails + the live preview. Gameplay is unaffected (see hitbox note).
const gfxCheck = document.getElementById('gfx-check');
gfxCheck.checked = (gfxStyle === 'round');

function applyGfx(style) {
  gfxStyle = style;
  localStorage.setItem('lpb_gfx', gfxStyle);
  gfxCheck.checked = (gfxStyle === 'round');
  loadSprites();        // also re-applies STYLE via applyStyle()
  buildAvatarPicker();
  drawBackground();
}

// Switching pixel→round is a documented mistake. Intercept with a judgmental modal.
const tasteModal = document.getElementById('taste-modal');
gfxCheck.addEventListener('change', () => {
  if (gfxCheck.checked) {
    // pixel → round: don't apply yet; ask the user to confront their choices.
    gfxCheck.checked = false; // keep visual state on pixel until they decide
    tasteModal.classList.remove('hidden');
  } else {
    applyGfx('pixel'); // round → pixel: always welcome, no questions asked
  }
});
document.getElementById('btn-taste-keep').addEventListener('click', () => {
  tasteModal.classList.add('hidden'); // stay on pixel — correct choice
});
document.getElementById('btn-taste-switch').addEventListener('click', () => {
  tasteModal.classList.add('hidden');
  applyGfx('round'); // they admitted it
});

// Idle animation loop: while not actively playing, redraw the background each frame
// so animated scenery (pulsing lights, bubbles, lightning) lives on the menu preview
// too. Cheap — just the parallax, no physics. startGame stops it; endGame restarts.
function idleLoop() {
  if (gameActive) { idleAnimId = 0; return; }
  drawBackground();
  idleAnimId = requestAnimationFrame(idleLoop);
}
function startIdle() { if (!idleAnimId && !gameActive) idleAnimId = requestAnimationFrame(idleLoop); }
function stopIdle()  { if (idleAnimId) { cancelAnimationFrame(idleAnimId); idleAnimId = 0; } }

drawBackground();
populateUserSelect();
showScreen('menu');
startIdle();

// Canvas text uses the pixel webfont; redraw once it's loaded so the first menu
// paint isn't stuck on the fallback monospace.
if (document.fonts && document.fonts.ready) {
  document.fonts.load('14px "Press Start 2P"').then(() => drawBackground()).catch(() => {});
}
