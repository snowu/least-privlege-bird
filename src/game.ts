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

// Themes are built as loose object literals (optional anim/img/img2/bgLayers per
// avatar); type as a permissive record so render code can read those fields.
const THEMES: { [key: string]: any } = {
  bird: {
    label: 'Bird',
    sky: '#7ec8e3', ground: '#2b2b3b',
    cloudFill: 'rgba(255,255,255,0.82)',
    // Classic pixel-art green pipe: hard-edged body with a highlight band on the
    // left, a shadow band on the right, and a chunky cap. No anti-aliasing.
    drawPipe(x, topH, gap) {
      const capH = 28, capW = C.PIPE_W + 12, capX = x - 6;
      const body = '#5aa02c', light = '#7ec850', dark = '#3a6e1a', edge = '#1f3d0e';
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
    },
  },
  penguin: {
    label: 'Penguin',
    sky: '#bfe6f2', ground: '#dfeef5',
    cloudFill: 'rgba(255,255,255,0.9)',
    // Ice pillars: pale cyan body with a bright highlight band, a cool shadow band,
    // and a frosted cap. Same hard-edged pixel construction as the classic pipe.
    drawPipe(x, topH, gap) {
      const capH = 28, capW = C.PIPE_W + 12, capX = x - 6;
      const body = '#7fc6dd', light = '#bce7f2', dark = '#4f9ab5', edge = '#2e6e85';
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
        ctx.fillRect(capX, cy, capW, 3);
        ctx.fillRect(capX, cy + capH - 3, capW, 3);
        ctx.fillRect(capX, cy, 3, capH);
        ctx.fillRect(capX + capW - 3, cy, 3, capH);
      };
      const botY = topH + gap;
      shaft(x, 0, C.PIPE_W, topH - capH);
      cap(topH - capH);
      cap(botY);
      shaft(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
    },
  },
  squid: {
    label: 'Squid',
    sky: '#0a3d52', ground: '#06212e',
    cloudFill: 'none',                        // underwater — no clouds at all
    anim: true,                               // 2-frame: tentacles tighten on flap
    // Kelp / coral columns: deep teal body with a glow band and rounded knobs.
    drawPipe(x, topH, gap) {
      const capH = 26, capW = C.PIPE_W + 12, capX = x - 6;
      const body = '#1f7a6a', light = '#3fbfa6', dark = '#0f4a40', edge = '#08332c';
      const shaft = (sx, sy, sw, sh) => {
        ctx.fillStyle = body;  ctx.fillRect(sx, sy, sw, sh);
        ctx.fillStyle = light; ctx.fillRect(sx + 4, sy, 8, sh);          // glow band
        ctx.fillStyle = dark;  ctx.fillRect(sx + sw - 10, sy, 8, sh);    // shadow band
        ctx.fillStyle = edge;  ctx.fillRect(sx, sy, 2, sh);
        ctx.fillRect(sx + sw - 2, sy, 2, sh);
      };
      const cap = (cy) => {
        ctx.fillStyle = body;  ctx.fillRect(capX, cy, capW, capH);
        ctx.fillStyle = light; ctx.fillRect(capX + 4, cy + 4, 8, capH - 8);
        ctx.fillStyle = dark;  ctx.fillRect(capX + capW - 12, cy + 4, 8, capH - 8);
        ctx.fillStyle = edge;
        ctx.fillRect(capX, cy, capW, 3);
        ctx.fillRect(capX, cy + capH - 3, capW, 3);
        ctx.fillRect(capX, cy, 3, capH);
        ctx.fillRect(capX + capW - 3, cy, 3, capH);
      };
      const botY = topH + gap;
      shaft(x, 0, C.PIPE_W, topH - capH);
      cap(topH - capH);
      cap(botY);
      shaft(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
    },
  },
  rocket: {
    label: 'Rocket',
    sky: '#05071a', ground: '#1a1a2e',
    cloudFill: null, // stars instead
    drawPipe(x, topH, gap) {
      // Metal station columns
      const capH = 20, capW = C.PIPE_W + 10, capX = x - 5;
      ctx.fillStyle = '#546e7a';
      ctx.fillRect(x, 0, C.PIPE_W, topH - capH);
      ctx.fillRect(capX, topH - capH, capW, capH);
      const botY = topH + gap;
      ctx.fillRect(capX, botY, capW, capH);
      ctx.fillRect(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
      // Rivet highlight
      ctx.fillStyle = '#00e5ff';
      for (let y = 10; y < topH - capH; y += 20) ctx.fillRect(x + 4, y, 4, 4);
      for (let y = botY + capH + 10; y < C.GROUND; y += 20) ctx.fillRect(x + 4, y, 4, 4);
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
    cloudFill: 'rgba(180,100,255,0.25)',
    drawPipe(x, topH, gap) {
      // Stone brick towers
      const capH = 24, capW = C.PIPE_W + 10, capX = x - 5;
      ctx.fillStyle = '#6d6875';
      ctx.fillRect(x, 0, C.PIPE_W, topH - capH);
      ctx.fillRect(capX, topH - capH, capW, capH);
      const botY = topH + gap;
      ctx.fillRect(capX, botY, capW, capH);
      ctx.fillRect(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
      // Brick lines
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
      for (let y = 8; y < topH - capH; y += 12) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + C.PIPE_W, y); ctx.stroke(); }
      for (let y = botY + capH + 8; y < C.GROUND; y += 12) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + C.PIPE_W, y); ctx.stroke(); }
      // Moss cap tint
      ctx.fillStyle = 'rgba(100,200,80,0.25)';
      ctx.fillRect(capX, topH - capH, capW, capH);
      ctx.fillRect(capX, botY, capW, capH);
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
    drawPipe(x, topH, gap) {
      // Steel girders
      const capH = 20, capW = C.PIPE_W + 8, capX = x - 4;
      ctx.fillStyle = '#37474f';
      ctx.fillRect(x, 0, C.PIPE_W, topH - capH);
      ctx.fillRect(capX, topH - capH, capW, capH);
      const botY = topH + gap;
      ctx.fillRect(capX, botY, capW, capH);
      ctx.fillRect(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
      // Yellow warning stripes on caps
      ctx.fillStyle = '#fdd835';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(capX + i * (capW / 4), topH - capH, capW / 8, capH);
        ctx.fillRect(capX + i * (capW / 4), botY, capW / 8, capH);
      }
      ctx.fillStyle = 'rgba(55,71,79,0.6)';
      ctx.fillRect(capX, topH - capH, capW, capH);
      ctx.fillRect(capX, botY, capW, capH);
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
  const u = Math.max(6, Math.round(w / 10));
  for (let i = 0; i * u < w / 2; i++) {
    const inset = i * u, hh = h - i * (h / (w / 2 / u));
    pxRect(x + inset, G() - hh, w - inset * 2, hh, c);
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
  const u = Math.max(3, Math.round(r / 5));
  for (let dy = -r; dy <= r; dy += u) {
    const dw = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ctx.fillRect(Math.round(cx - dw), Math.round(cy + dy), dw * 2, u);
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
];

THEMES.squid.bgLayers = [
  // Deep layer: drifting bubbles of various sizes (rise read comes from size/spacing)
  { speed: 0.2, draw(o) { tileMotif(o, 320, x => {
      const bub = (bx, by, r) => {
        pixelDisc(bx, by, r, 'rgba(150,230,255,0.16)');
        pixelDisc(bx, by, Math.max(1, r - 3), 'rgba(180,240,255,0.10)'); // hollow ring
      };
      bub(x + 40, G() - 220, 9);
      bub(x + 110, G() - 120, 5);
      bub(x + 180, G() - 300, 13);
      bub(x + 250, G() - 180, 4);
      bub(x + 300, G() - 90, 7);
  }); } },
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
      // a couple of foreground bubbles too
      pixelDisc(x + 110, G() - 60, 6, 'rgba(180,240,255,0.18)');
      pixelDisc(x + 215, G() - 100, 4, 'rgba(180,240,255,0.18)');
  }); } },
];

THEMES.bee.bgLayers = [
  // Soft green hills
  { speed: 0.18, draw(o) { tileMotif(o, 300, x => { pixelHill(x, 280, 100, '#9ccc65'); pixelHill(x + 150, 220, 70, '#aed581'); }); } },
  // Flower stalks + small trees up front
  { speed: 0.55, draw(o) { tileMotif(o, 170, x => {
      pixelTree(x + 30, 3, '#558b2f', '#6d4c41');
      // a couple of flowers
      pxRect(x + 110, G() - 26, 2, 26, '#33691e');               // stem
      pxRect(x + 106, G() - 32, 10, 8, '#ec407a');               // bloom
      pxRect(x + 109, G() - 30, 4, 4, '#ffeb3b');                // center
  }); } },
];

THEMES.wizard.bgLayers = [
  // Jagged purple mountain range — overlapping snow-capped peaks
  { speed: 0.12, draw(o) { tileMotif(o, 420, x => {
      pixelPeak(x - 40, 300, 200, '#3a2a5a', '#d8cfe8');
      pixelPeak(x + 150, 260, 160, '#4a3a6e', '#cfc4e0');
      pixelPeak(x + 320, 220, 130, '#332551');
  }); } },
  // A castle on the mid ridge
  { speed: 0.35, draw(o) { tileMotif(o, 520, x => {
      const bx = x + 60, by = G(), c = '#5a5566', d = '#403c4a', win = '#ffd54f';
      pxRect(bx, by - 70, 120, 70, c);                            // keep
      for (let t = 0; t < 4; t++) pxRect(bx - 10 + t * 40, by - 92, 20, 26, c); // battlement towers
      for (let t = 0; t < 4; t++) pxRect(bx - 6 + t * 40, by - 100, 12, 10, d); // tower caps
      pxRect(bx + 50, by - 40, 20, 40, d);                        // gate
      pxRect(bx + 18, by - 56, 8, 8, win); pxRect(bx + 94, by - 56, 8, 8, win); // lit windows
  }); } },
];

THEMES.airplane.bgLayers = [
  // Hazy data-center skyline (rows of windowed slabs)
  { speed: 0.16, draw(o) { tileMotif(o, 340, x => {
      const slab = (sx, w, h, c) => {
        pxRect(sx, G() - h, w, h, c);
        ctx.fillStyle = 'rgba(180,220,255,0.5)';
        for (let yy = G() - h + 10; yy < G() - 8; yy += 16)
          for (let xx = sx + 8; xx < sx + w - 6; xx += 14) ctx.fillRect(xx, yy, 6, 8);
      };
      slab(x, 90, 180, '#56607a');
      slab(x + 120, 70, 130, '#626c88');
      slab(x + 220, 100, 220, '#4c5570');
  }); } },
  // Foreground cooling units / satellite dishes
  { speed: 0.5, draw(o) { tileMotif(o, 240, x => {
      pxRect(x + 30, G() - 40, 60, 40, '#37474f');               // AC unit
      pxRect(x + 38, G() - 34, 44, 12, '#263238');              // vents
      pxRect(x + 150, G() - 30, 6, 30, '#455a64');               // dish mast
      pxRect(x + 138, G() - 48, 30, 16, '#78909c');              // dish
  }); } },
];

THEMES.robot.bgLayers = [
  // Neon circuit-city skyline — towers with antenna spires, setback crowns and a
  // pulsing rooftop beacon, so the silhouette isn't just flat-topped rectangles.
  { speed: 0.16, draw(o) { tileMotif(o, 320, x => {
      const tower = (sx, w, h, edge) => {
        const topY = G() - h;
        pxRect(sx, topY, w, h, '#10202e');
        ctx.fillStyle = edge;
        // horizontal circuit/window rows
        for (let yy = topY + 6; yy < G() - 6; yy += 14) ctx.fillRect(sx + 4, yy, w - 8, 2);
        // a narrower setback crown block on top (breaks the flat rectangle)
        const cw = Math.round(w * 0.55), cx = sx + Math.round((w - cw) / 2), ch = 16;
        pxRect(cx, topY - ch, cw, ch, '#10202e');
        ctx.fillStyle = edge;
        ctx.fillRect(cx, topY - ch, cw, 2);
        ctx.fillRect(sx, topY, w, 2);
        // antenna mast + glowing beacon
        const mx = sx + Math.round(w / 2);
        ctx.fillStyle = edge;
        ctx.fillRect(mx - 1, topY - ch - 18, 2, 18);
        pixelDisc(mx, topY - ch - 20, 4, edge);          // round in round mode, stepped in pixel
      };
      tower(x, 80, 200, '#00e5ff');
      tower(x + 110, 60, 150, '#76ff03');
      tower(x + 200, 90, 240, '#00e5ff');
  }); } },
];

THEMES.rocket.bgLayers = [
  // Distant planets + a moon drifting (stars are already painted in drawBackground)
  { speed: 0.08, draw(o) { tileMotif(o, 600, x => {
      pixelDisc(x + 120, 130, 34, '#c97b5a');                       // ringed planet
      pxRect(x + 86, 124, 68, 6, '#a85f44');                        // band
      pixelDisc(x + 430, 90, 18, '#cfd8dc');                        // moon
      pixelDisc(x + 424, 86, 4, '#b0bec5');                         // crater
  }); } },
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
    // Stars for space
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137 + 11) % C.W, sy = (i * 97 + 7) % C.GROUND;
      ctx.fillRect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
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
function tileMotif(offset, tileW, drawOne) {
  const start = -((offset % tileW) + tileW) % tileW; // wrapped into (-tileW, 0]
  for (let x = start; x < C.W + tileW; x += tileW) drawOne(Math.round(x));
}

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
  if (e.code === 'Space' && !overlay.classList.contains('hidden') === false) flap();
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
function buildAvatarPicker() {
  const selectedKey = Object.keys(THEMES).find(k => THEMES[k] === currentTheme) || 'penguin';
  avatarPicker.innerHTML = '';
  avatarPicker.classList.toggle('round-gfx', gfxStyle === 'round');
  // Penguin leads (it's the mascot); the rest follow in THEMES order.
  const ordered = ['penguin', ...Object.keys(THEMES).filter(k => k !== 'penguin')];
  ordered.forEach((key) => {
    const theme = THEMES[key];
    const div = document.createElement('div');
    div.className = 'avatar-opt' + (key === selectedKey ? ' selected' : '');
    div.dataset.key = key;
    div.innerHTML = `<img src="${theme.img.src}" alt="${theme.label}"><span>${theme.label}</span>`;
    div.addEventListener('click', () => {
      document.querySelectorAll('.avatar-opt').forEach(d => d.classList.remove('selected'));
      div.classList.add('selected');
      currentTheme = THEMES[key];
      drawBackground();      // preview on menu
      reskinFortuneCow();    // swap the corner cow to the new avatar (no refetch)
    });
    avatarPicker.appendChild(div);
  });
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

// Draw a static background while on menu
drawBackground();
populateUserSelect();
showScreen('menu');

// Canvas text uses the pixel webfont; redraw once it's loaded so the first menu
// paint isn't stuck on the fallback monospace.
if (document.fonts && document.fonts.ready) {
  document.fonts.load('14px "Press Start 2P"').then(() => drawBackground()).catch(() => {});
}
