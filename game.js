// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const C = {
  W: 910, H: 730,           // canvas dimensions
  HUD: 48,                  // bottom bar height
  GRAVITY: 0.5,
  FLAP: -9,
  PIPE_W: 64,
  PIPE_GAP_MIN: 120,        // tightest vertical gap (reached at max speed)
  PIPE_GAP_MAX: 260,        // widest vertical gap (at start)
  PIPE_GAP_STEP: 20,        // gap shrinks by this per speed level
  PIPE_SPEED: 2,            // initial pipe scroll speed (px/frame)
  PIPE_INTERVAL_MAX: 2200,  // ms between pipes at start
  PIPE_INTERVAL_MIN: 800,   // ms between pipes at max difficulty
  PIPE_INTERVAL_STEP: 300,  // interval shrinks by this per speed level
  SPEED_UP_INTERVAL: 5000,  // ms between each speed increase
  SPEED_UP_AMOUNT: 0.5,     // px/frame added each interval
  COUNTDOWN_SEC: 3,         // seconds to count down before play starts
  PLAYER_X: 120,
  PLAYER_SIZE: 40,         // collision box (mirrored in sim.ts — do NOT change lightly)
  SPRITE_SCALE: 1.5,       // draw-only: sprite rendered this much bigger than the hitbox
  GROUND: 0,                // y of ground = H - HUD (computed below)
  CLOUD_COUNT: 6,
};
C.GROUND = C.H - C.HUD;

// ─── CANVAS SETUP ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
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
const STYLE = {
  pixel: {
    fontDisplay: "'Press Start 2P', monospace", // titles, buttons, HUD
    fontBody:    "'Press Start 2P', monospace", // labels, prose
    fontMono:    "'Press Start 2P', monospace", // dense logs
    smoothing: false,        // crisp sprite edges
    radius: '4px',           // button / tile corner radius
    textShadow: '3px 3px 0 #000',
    letterSpacing: '0px',
    fontScale: 1,            // baseline — all rem sizes were tuned for this font
    logo: 'assets/logo.svg', logoRendering: 'pixelated',
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
    logo: 'assets/logo-round.svg', logoRendering: 'auto',
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

const THEMES = {
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

// (Re)load every theme's sprite for the active art style. Pixel art wants crisp
// scaling; round art wants smooth — flip the canvas hint to match.
function loadSprites() {
  for (const [key, theme] of Object.entries(THEMES)) {
    theme.img = makeImg(`assets/${gfxStyle}/${key}.svg`);
  }
  applyStyle();
}
loadSprites();

let currentTheme = THEMES.bird;

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
}

// ─── CLOUDS (static decoration) ───────────────────────────────────────────────
const clouds = Array.from({ length: C.CLOUD_COUNT }, () => ({
  x: Math.random() * C.W,
  y: 40 + Math.random() * (C.GROUND - 120),
  w: 80 + Math.random() * 80,
  h: 40 + Math.random() * 30,
}));

// ─── DETERMINISM ──────────────────────────────────────────────────────────────
// Fixed-timestep physics + seeded RNG so a run is reproducible from {seed, flapTicks}.
// This is the foundation for server-side replay validation (Supabase edge function).
const TICK_MS = 1000 / 60;                       // fixed physics step
const SPEED_UP_TICKS = C.SPEED_UP_INTERVAL / TICK_MS;     // ticks between speed bumps
const MAX_FRAME_MS = 250;                        // clamp to avoid spiral-of-death after tab stalls

// mulberry32 — tiny deterministic PRNG. Same seed → same sequence in JS and TS.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────
let player, pipes, score, animId, currentPlayer, currentBest = null;
let pipeSpeed, countdown, countdownStart;
let tick, acc, lastFrameTime;        // fixed-timestep bookkeeping
let lastSpeedUpTick, lastPipeTick;   // spawn/ramp timers in ticks (not wall-clock)
let seed, rng, flapTicks;            // replay inputs

function initGame(playerName) {
  currentPlayer = playerName;
  player = { y: C.H / 2, vy: 0 };
  pipes  = [];
  score  = 0;
  pipeSpeed      = C.PIPE_SPEED;
  countdown      = C.COUNTDOWN_SEC;
  countdownStart = performance.now();
  // fixed-timestep state
  tick          = 0;
  acc           = 0;
  lastFrameTime = null;
  lastSpeedUpTick = null; // starts on first active tick
  lastPipeTick    = null;
  // replay state — seed drives all gameplay-affecting randomness
  seed     = crypto.getRandomValues(new Uint32Array(1))[0];
  rng      = mulberry32(seed);
  flapTicks = [];
}

function speedLevel() {
  return Math.round((pipeSpeed - C.PIPE_SPEED) / C.SPEED_UP_AMOUNT);
}
function currentGap() {
  return Math.max(C.PIPE_GAP_MIN, C.PIPE_GAP_MAX - speedLevel() * C.PIPE_GAP_STEP);
}
function currentInterval() {
  return Math.max(C.PIPE_INTERVAL_MIN, C.PIPE_INTERVAL_MAX - speedLevel() * C.PIPE_INTERVAL_STEP);
}

function spawnPipe() {
  const gap    = currentGap();
  const minTop = 60;
  const maxTop = C.GROUND - gap - 60;
  const topH   = minTop + rng() * (maxTop - minTop); // seeded → reproducible
  pipes.push({ x: C.W, topH, gap, scored: false });
  lastPipeTick = tick;
}

// ─── DRAWING ──────────────────────────────────────────────────────────────────
function drawBackground() {
  const t = currentTheme;
  // Sky
  ctx.fillStyle = t.sky;
  ctx.fillRect(0, 0, C.W, C.GROUND);

  if (t.cloudFill === null && t.sky === THEMES.rocket.sky) {
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
}

// Blocky pixel cloud: a stepped lozenge built from a few hard rectangles.
function pixelCloud(x, y, w, h, fill) {
  ctx.fillStyle = fill;
  const u = Math.max(6, Math.round(h / 4)); // block unit
  ctx.fillRect(x, y + u, w, h - u * 2);            // mid band (full width)
  ctx.fillRect(x + u, y, w - u * 2, h);            // tall center
  ctx.fillRect(x + u * 2, y - u, w - u * 4, u);    // top bump
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

function drawCountdown(n) {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, C.W, C.GROUND);
  ctx.fillStyle = '#fff';
  ctx.font = `${C.H * 0.16}px ${activeStyle().fontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(n > 0 ? n : 'GO!', C.W / 2, C.GROUND / 2);
  ctx.textBaseline = 'alphabetic';
}

function drawPlayer() {
  // Render LARGER than the hitbox so the sprite looks meaty. The collision radius
  // (PLAYER_SIZE/2 - 4) is unchanged and stays mirrored in sim.ts — this is a
  // draw-only scale, so replay validation is unaffected. The pixel-art SVGs also
  // carry transparent padding, so the visible body roughly matches the hitbox.
  const s = C.PLAYER_SIZE * C.SPRITE_SCALE;
  ctx.save();
  ctx.translate(C.PLAYER_X, player.y);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, player.vy * 0.05)));
  ctx.drawImage(currentTheme.img, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = '#fff';
  ctx.font = `14px ${activeStyle().fontDisplay}`;
  ctx.textAlign = 'center';
  const sl = speedLevel() + 1;
  // High is shown only when we have an authoritative value from Supabase.
  // currentBest === null means offline/unknown → omit it rather than show a stale number.
  const high = currentBest == null ? '' : `High: ${Math.max(score, currentBest)}  |  `;
  ctx.fillText(
    `Score: ${score}  |  ${high}${currentPlayer}  |  Spd ${sl}`,
    C.W / 2, C.GROUND + 32
  );
}

// ─── COLLISION ────────────────────────────────────────────────────────────────
function collides() {
  const r = C.PLAYER_SIZE / 2 - 4;
  const px = C.PLAYER_X, py = player.y;
  if (py - r <= 0 || py + r >= C.GROUND) return true;
  for (const p of pipes) {
    if (px + r > p.x && px - r < p.x + C.PIPE_W) {
      if (py - r < p.topH || py + r > p.topH + p.gap) return true;
    }
  }
  return false;
}

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
// Advance physics exactly one fixed tick. Deterministic: depends only on
// tick count + seeded rng + logged flaps — never on wall-clock or frame rate.
// Returns true if the player died this tick.
function stepPhysics() {
  // Initialize spawn/ramp timers + first pipe on the first active tick
  if (lastSpeedUpTick === null) {
    lastSpeedUpTick = tick;
    lastPipeTick    = tick;
    spawnPipe();
  }

  // Speed ramp (every SPEED_UP_TICKS ticks)
  if (tick - lastSpeedUpTick >= SPEED_UP_TICKS) {
    pipeSpeed += C.SPEED_UP_AMOUNT;
    lastSpeedUpTick = tick;
  }

  // Spawn pipes (interval in ms → ticks)
  if ((tick - lastPipeTick) * TICK_MS >= currentInterval()) spawnPipe();

  // Update pipes
  for (const p of pipes) {
    p.x -= pipeSpeed;
    if (!p.scored && p.x + C.PIPE_W < C.PLAYER_X) { score++; p.scored = true; AudioFX.score(); }
  }
  pipes = pipes.filter(p => p.x + C.PIPE_W > 0);

  // Update player physics
  player.vy += C.GRAVITY;
  player.y  += player.vy;

  tick++;
  return collides();
}

function loop(now) {
  ctx.clearRect(0, 0, C.W, C.H);
  drawBackground();
  for (const p of pipes) drawPipe(p.x, p.topH, p.gap);
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

  // ── Active play: fixed-timestep accumulator ──
  // Advance physics in fixed TICK_MS steps regardless of monitor refresh rate,
  // so a 60Hz and a 144Hz machine produce identical runs.
  if (lastFrameTime === null) lastFrameTime = now;
  acc += Math.min(now - lastFrameTime, MAX_FRAME_MS); // clamp after tab stalls
  lastFrameTime = now;

  while (acc >= TICK_MS) {
    if (stepPhysics()) { endGame(); return; }
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
    GO_ERRORS[score % GO_ERRORS.length] + ` (req ${(score * 7919 + 1009).toString(16)})`;
  overlay.classList.remove('hidden');
  showScreen('gameover');

  // Count-up animation on the score readout (display only — purely cosmetic).
  const el = document.getElementById('go-score-val');
  const target = score, steps = Math.min(30, target) || 1, t0 = performance.now(), dur = 600;
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
  const isNew = prev != null && score > prev;
  // Replay payload for server-side validation — captured before initGame resets it.
  const replay = { seed, flapTicks };

  if (DEV_MODE) {
    // Skip the friction theater. saveScore self-gates on LIVE_DB, so this still
    // exercises the real Supabase round-trip when the DB is enabled locally.
    await saveScore(currentPlayer, score, replay);
    showGameOver(isNew ? 'New high score! 🎉' : '');
    return;
  }

  Clave.startScoreSubmit(currentPlayer, score, async () => {
    await saveScore(currentPlayer, score, replay);
    showGameOver(
      isNew
        ? 'New high score! 🎉'
        : prev == null
          ? ''
          : `Best: ${Math.max(score, prev)}`
    );
  });
  overlay.classList.remove('hidden'); // keep visible for CAPTCHA + submit screens
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function flap() {
  player.vy = C.FLAP;
  if (flapTicks) flapTicks.push(tick); // log input tick for server-side replay
  const key = Object.keys(THEMES).find(k => THEMES[k] === currentTheme) || 'bird';
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
  if (DEV_MODE) { startGame(name); return; }
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
  const selectedKey = Object.keys(THEMES).find(k => THEMES[k] === currentTheme) || 'bird';
  avatarPicker.innerHTML = '';
  avatarPicker.classList.toggle('round-gfx', gfxStyle === 'round');
  Object.entries(THEMES).forEach(([key, theme]) => {
    const div = document.createElement('div');
    div.className = 'avatar-opt' + (key === selectedKey ? ' selected' : '');
    div.dataset.key = key;
    div.innerHTML = `<img src="${theme.img.src}" alt="${theme.label}"><span>${theme.label}</span>`;
    div.addEventListener('click', () => {
      document.querySelectorAll('.avatar-opt').forEach(d => d.classList.remove('selected'));
      div.classList.add('selected');
      currentTheme = THEMES[key];
      drawBackground(); // preview on menu
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
gfxCheck.addEventListener('change', () => {
  gfxStyle = gfxCheck.checked ? 'round' : 'pixel';
  localStorage.setItem('lpb_gfx', gfxStyle);
  loadSprites();        // also re-applies STYLE via applyStyle()
  buildAvatarPicker();
  drawBackground();
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
