// ─── IMPORTS ──────────────────────────────────────────────────────────────────
// Physics is the shared core — same module the server replays with, so the game
// and the anti-cheat validation can never drift. C holds all constants (incl.
// render-only ones like HUD/SPRITE_SCALE/COUNTDOWN_SEC).
import {
  C, TICK_MS, createState, step, speedLevel, type GameState,
} from './physics-core.ts';
import { AVATAR_KEYS } from './avatars-meta.ts';
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

const overlay = document.getElementById('overlay');

// ─── MOBILE SCALING ───────────────────────────────────────────────────────────
// Scale the #game-frame wrapper via CSS transform so the canvas always fits the
// viewport without ever changing canvas.style.width/height (which previously
// caused blurry vertical-band artefacts with image-rendering:pixelated).
const gameFrame = document.getElementById('game-frame') as HTMLElement;
const devDisclaimer = document.getElementById('dev-disclaimer') as HTMLElement;
gameFrame.style.width  = C.W + 'px';
gameFrame.style.height = C.H + 'px';

// Updated by applyStyle() once STYLE is initialised. Default matches pixel fontScale.
// Used by fitToViewport() which is called before STYLE is defined, so it can't
// reference activeStyle() directly.
let _baseFontPx = 16;

function fitToViewport() {
  // On mobile the disclaimer is replaced by a modal and never shown as a banner,
  // so never reserve space for it — avoids a scale jump on first load.
  const isMob = Math.min(window.innerWidth, window.innerHeight) < 900;
  document.body.classList.toggle('is-mobile', isMob);
  const reserved = isMob ? 0 : devDisclaimer.offsetHeight;
  // Always treat the larger dimension as width (landscape-first game).
  // In portrait, the URL bar will eat into innerHeight when the phone rotates to landscape,
  // so pre-subtract that same chrome height from vh now so the scale matches.
  // Only applies when the diff is in the "URL bar" range (20–80 px) to avoid
  // miscorrecting on iOS Safari (full chrome ~120 px) or no-chrome PWA (0 px).
  const isPortrait = window.innerHeight > window.innerWidth;
  const chromeDiff  = Math.max(0, screen.height - window.innerHeight);
  const urlBarEst   = isMob && isPortrait && chromeDiff > 20 && chromeDiff <= 80 ? chromeDiff : 0;
  const vw = Math.max(window.innerWidth, window.innerHeight);
  const vh = Math.min(window.innerWidth, window.innerHeight) - urlBarEst - (isMob ? 0 : reserved);
  const scale = Math.min(vw / C.W, vh / C.H, 1);
  // translate(-50%,-50%) centers the layout box on the anchor point.
  // Shift the anchor down by half the reserved bar height so the game
  // sits centered in the space below the disclaimer.
  gameFrame.style.top = `calc(50% + ${reserved / 2}px)`;
  gameFrame.style.transform = `translate(-50%, -50%) scale(${scale})`;
  // Keep the scores corner badge clear of the disclaimer bar.
  (document.getElementById('btn-scores') as HTMLElement).style.top = `${reserved + 12}px`;
  // Partial font-size compensation: dampens the scale-down so UI text stays
  // legible on small screens without fully undoing the scale transform.
  // _baseFontPx is kept in sync by applyStyle() so desktop (scale=1) is unaffected.
  document.documentElement.style.fontSize = `${_baseFontPx / Math.pow(scale, 0.1)}px`;
  // Reveal after the correct transform is set — prevents flash of unscaled content
  // while the JS bundle loads. CSS opacity:0 hides game-frame until this runs.
  gameFrame.style.opacity = '1';
}
fitToViewport();
window.addEventListener('resize', fitToViewport);
window.addEventListener('orientationchange', () => {
  fitToViewport();
  setTimeout(fitToViewport, 150);
});
document.addEventListener('fullscreenchange', fitToViewport);

// Fullscreen toggle
const btnFullscreen  = document.getElementById('btn-fullscreen')   as HTMLButtonElement;
const mobileHint     = document.getElementById('mobile-hint')      as HTMLButtonElement;
const mobileHintIOS  = document.getElementById('mobile-hint-ios')  as HTMLButtonElement;
const iosFsModal     = document.getElementById('ios-fs-modal')     as HTMLDivElement;
const btnIosDismiss  = document.getElementById('btn-ios-fs-dismiss') as HTMLButtonElement;

// iPad on iOS 13+ lies and reports MacIntel — catch it via maxTouchPoints.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Already running as a home-screen PWA — no need to suggest it.
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true;

function enterFS() {
  document.documentElement.requestFullscreen()
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}
function exitFS() {
  screen.orientation?.unlock?.();
  document.exitFullscreen();
}

function updateFsUI() {
  const isMobile    = window.innerWidth < 900 || window.innerHeight < 900;
  const isLandscape = window.innerWidth > window.innerHeight;
  const inFS        = !!document.fullscreenElement;

  if (isIOS && !isStandalone) {
    // iOS: can't go fullscreen via API. Show hint in portrait, nothing in landscape.
    mobileHint.style.display    = 'none';
    btnFullscreen.style.display = 'none';
    mobileHintIOS.style.display = isMobile && !isLandscape ? 'block' : 'none';
  } else {
    // Chrome/Android: portrait → hint to enter, landscape+fullscreen → exit badge.
    mobileHintIOS.style.display = 'none';
    mobileHint.style.display    = isMobile && !isLandscape && !inFS ? 'block' : 'none';
    btnFullscreen.style.display = isMobile && isLandscape  && inFS  ? 'block' : 'none';
  }
}
updateFsUI();
window.addEventListener('resize', updateFsUI);
window.addEventListener('orientationchange', () => {
  updateFsUI();
  setTimeout(updateFsUI, 150);
});
document.addEventListener('fullscreenchange', updateFsUI);

if (isIOS || !document.documentElement.requestFullscreen) {
  mobileHint.addEventListener('click', () => {}); // no-op on iOS
} else {
  mobileHint.addEventListener('click', enterFS);
  btnFullscreen.addEventListener('click', exitFS);
}

mobileHintIOS.addEventListener('click', () => {
  iosFsModal.style.display = 'flex';
});
btnIosDismiss.addEventListener('click', () => {
  iosFsModal.style.display = 'none';
});

// ─── MOBILE DISCLAIMER MODAL ──────────────────────────────────────────────────
const disclaimerModal   = document.getElementById('disclaimer-modal')      as HTMLDivElement;
const btnDisclaimerOk   = document.getElementById('btn-disclaimer-accept') as HTMLButtonElement;
const btnDisclaimerNope = document.getElementById('btn-disclaimer-decline') as HTMLButtonElement;
const fortuneCow        = document.getElementById('fortune-cow')           as HTMLPreElement;

const DISCLAIMER_KEY = 'lpb-disclaimer-ok';

function isMobileViewport() {
  return window.innerWidth < 900 || window.innerHeight < 900;
}

function updateCowPosition() {
  if (isMobileViewport()) {
    fortuneCow.style.transform      = 'scale(0.9)';
    fortuneCow.style.transformOrigin = 'bottom right';
  } else {
    fortuneCow.style.transform      = '';
    fortuneCow.style.transformOrigin = '';
  }
}
updateCowPosition();
window.addEventListener('resize', updateCowPosition);
window.addEventListener('orientationchange', () => {
  updateCowPosition();
  setTimeout(updateCowPosition, 150);
});

if (isMobileViewport()) {
  devDisclaimer.style.display = 'none';
  if (!localStorage.getItem(DISCLAIMER_KEY)) {
    disclaimerModal.style.display = 'flex';
  }
}

btnDisclaimerOk.addEventListener('click', () => {
  try { localStorage.setItem(DISCLAIMER_KEY, '1'); } catch {}
  disclaimerModal.style.display = 'none';
});
btnDisclaimerNope.addEventListener('click', () => {
  // TODO: replace with a funny redirect URL
  window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
});

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
    monkey: () => { beep(520, 760, 0.07, 'square', 0.15); beep(680, 980, 0.05, 'square', 0.12, 0.05); }, // panicked "ook ook!"
    rocket: () => beep(220, 90,  0.16, 'sawtooth', 0.16),              // whoosh down
    bee:    () => { beep(420, 380, 0.12, 'square', 0.12); beep(440, 400, 0.12, 'square', 0.1, 0.01); }, // buzzy
    dragon: () => { beep(160, 90, 0.16, 'sawtooth', 0.18); beep(420, 120, 0.1, 'square', 0.1, 0.04); }, // roar/whoosh
    robot:  () => beep(140, 140, 0.09, 'square', 0.16),                // flat blip
    horse:  () => { beep(520, 300, 0.10, 'sawtooth', 0.13); beep(300, 180, 0.14, 'sawtooth', 0.12, 0.05); beep(180, 120, 0.1, 'square', 0.1, 0.11); }, // descending whinny
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
  // Keep _baseFontPx in sync so fitToViewport() uses the right base on next call.
  _baseFontPx = 16 * s.fontScale;
  fitToViewport(); // recompute font-size and scale with updated base
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
// rocket/dragon/robot.
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
    surface: ['#cfeef8', '#ffffff', '#9cc6d8'],   // packed snow lip with icy highlights
    cloudFill: 'rgba(255,255,255,0.9)',
    // Ice pillars: pale cyan body with bands and a frosted cap. Same construction.
    drawPipe(x, topH, gap) {
      bandedPipe(x, topH, gap, { body: '#7fc6dd', light: '#bce7f2', dark: '#4f9ab5', edge: '#2e6e85' });
    },
  },
  // (squid retired in favor of monkey — assets/{pixel,round}/squid{,-2}.svg are
  // kept on disk, unreferenced, in case we want to bring it back.)
  monkey: {
    label: 'Monkey',
    sky: '#0a3d52', ground: '#06212e',
    surface: ['#1f6b5e', '#3fbf9e', '#0c3a30'],   // mossy seafloor lip
    cloudFill: 'none',                        // underwater — no clouds at all
    anim: true,                               // 2-frame: arms pull up to paddle on flap
    // Coral-crusted rock pillars: weathered stone columns blotched with strata
    // patches and dotted with coral polyps/barnacles — DK Country reef vibes,
    // not the construction-site girders the rest of the roster wears.
    drawPipe(x, topH, gap) {
      framedPipe(x, topH, gap, {
        bodyColor: '#5e6b5a', capColor: '#46524a', capH: 22, capW: C.PIPE_W + 10,
        decorate({ x, topH, botY, capX, capW, capH }) {
          const coral = ['#e8748a', '#f0a35c', '#caa0e8'];
          // irregular rock-strata blotches — organic offset rows, not clean bands
          ctx.fillStyle = 'rgba(60,82,64,0.4)';
          for (let y = 8, i = 0; y < topH - capH - 6; y += 12, i++) ctx.fillRect(x + (i % 2 ? 6 : 0), y, C.PIPE_W - 6, 4);
          for (let y = botY + capH + 8, i = 0; y < C.GROUND - 6; y += 12, i++) ctx.fillRect(x + (i % 2 ? 6 : 0), y, C.PIPE_W - 6, 4);
          // coral-polyp clusters dotted along the body, alternating sides
          const cluster = (cx, cy) => { for (let i = 0; i < 3; i++) { ctx.fillStyle = coral[i]; ctx.fillRect(cx + i * 4, cy - (i % 2) * 3, 3, 3); } };
          cluster(x + 3, topH - capH - 18);
          cluster(x + C.PIPE_W - 15, botY + capH + 16);
          // coral-crust band breaking up the cap's straight edge with organic growth
          for (let i = 0; i < 5; i++) {
            ctx.fillStyle = coral[i % coral.length];
            const bw = 4 + (i % 2) * 2, bh = 3 + (i % 3);
            ctx.fillRect(capX + 3 + i * (capW - 6) / 5, topH - capH - bh + 2, bw, bh);
            ctx.fillRect(capX + 3 + i * (capW - 6) / 5, botY + capH - 2, bw, bh);
          }
          // barnacles: pale dots clustered right at the cap edges
          ctx.fillStyle = '#d8ead2';
          for (let i = 0; i < 3; i++) { ctx.fillRect(capX + 6 + i * 9, topH - capH + 5, 2, 2); ctx.fillRect(capX + 6 + i * 9, botY + 5, 2, 2); }
        },
      });
    },
  },
  rocket: {
    label: 'Rocket',
    sky: '#05071a', ground: '#05071a',   // ground = sky → seamless void, no floor
    surface: null,                        // space has no floor lip
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
    sky: '#aee0f0', ground: '#388e3c',
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
  dragon: {
    label: 'Dragon',
    sky: '#3a1408', ground: '#1c0f0a',
    surface: ['#7a1f0a', '#ff7a33', '#3a0f04'],   // molten lava lip — the floor IS the flow
    cloudFill: 'none',     // ash plumes + embers + meteors drawn as dedicated bgLayers instead
    anim: true,            // 2-frame: wings beat down on flap (round bakes fire into frame 2)
    // Data-driven effect layer (render-only). The flame is its OWN transparent asset
    // drawn past the snout in drawPlayer — not baked into the sprite box — so it can be
    // long + gently tapered without clipping. Pixel-only: round bakes fire into frame 2.
    // Generalizes to any avatar effect (rocket exhaust, squid ink, …) via this same data.
    fx: {
      sprite: 'fire', styles: ['pixel'],
      trigger: 'flapRandom', everyMin: 5, everyMax: 10, // re-rolled each fire
      durationMs: 1000,
      anchorX: 0.30, anchorY: -0.05,                     // offset from sprite centre (×s)
      scale: 1.4,                                        // fx width = s × scale
    },
    // Obsidian/basalt columns: dark volcanic-rock blocks veined with glowing
    // lava-seam cracks (swapped from the mossy ruined-keep brickwork).
    drawPipe(x, topH, gap) {
      framedPipe(x, topH, gap, {
        bodyColor: '#241a18', capColor: '#241a18', capH: 24, capW: C.PIPE_W + 10,
        decorate({ x, topH, botY, capX, capW, capH }) {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
          for (let y = 8; y < topH - capH; y += 12) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + C.PIPE_W, y); ctx.stroke(); }
          for (let y = botY + capH + 8; y < C.GROUND; y += 12) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + C.PIPE_W, y); ctx.stroke(); }
          // glowing lava-seam cracks: jagged veins running down the column,
          // pulsing gently with the volcano's rhythm
          const vGlow = volcano().glow;
          const glow = 0.35 + 0.25 * vGlow;
          ctx.strokeStyle = `rgba(255,${110 + Math.round(60 * glow)},60,${glow})`;
          ctx.lineWidth = 2; ctx.lineCap = 'round';
          const vein = (vx, vy0, vy1) => {
            ctx.beginPath(); ctx.moveTo(vx, vy0);
            for (let y = vy0, i = 0; y < vy1; y += 9, i++) ctx.lineTo(vx + (i % 2 ? 3 : -3), y);
            ctx.lineTo(vx, vy1);
            ctx.stroke();
          };
          vein(x + 6,  10, topH - capH - 6);
          vein(x + C.PIPE_W - 8, botY + capH + 6, C.GROUND - 10);
          ctx.lineWidth = 1;
          // ember-crust caps
          ctx.fillStyle = `rgba(255,140,60,${0.18 + 0.12 * vGlow})`;
          ctx.fillRect(capX, topH - capH, capW, capH);
          ctx.fillRect(capX, botY, capW, capH);
        },
      });
    },
  },
  // WIP / parked: a straight copy of the dragon level (storm, lightning, ruined
  // keep) earmarked for a future wizard avatar — kept `hidden` (no picker entry,
  // no sprite load attempts) so this work survives while `dragon` itself gets
  // redone as a fire/lava volcano stage. Bring it back by giving it real sprite
  // assets (assets/{pixel,round}/wizard{,-2}.svg) and dropping `hidden`.
  wizard: {
    label: 'Wizard',
    hidden: true,
    sky: '#1a0533', ground: '#4a4453',
    surface: ['#5a4a6a', '#7a6a8e', '#332a40'],   // cracked dark-stone lip
    cloudFill: 'none',     // storm clouds + dust drawn as a dedicated bgLayer instead
    anim: true,
    fx: {
      sprite: 'fire', styles: ['pixel'],
      trigger: 'flapRandom', everyMin: 5, everyMax: 10,
      durationMs: 1000,
      anchorX: 0.30, anchorY: -0.05,
      scale: 1.4,
    },
    // Stone brick towers with mortar lines and moss-tinted caps (a ruined keep).
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
    surface: ['#4a5263', '#6b7488', '#262b36'],   // wet asphalt rooftop lip
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
    surface: ['#1f3a4a', '#00e5ff', '#0c2230'],   // neon-lit metal grating lip
    cloudFill: null, // square data-packet clouds
    anim: true,      // 2-frame: bendy pincer arm pumps up/down on flap
    // Effect layer: on a random flap cadence, fire an energy BOLT that LEAVES the pincer
    // and travels right (kind 'bolt' → a moving projectile drawn in drawPlayer) until it
    // collides with a pipe or the screen edge, where it pops. Same trigger as the dragon's
    // fire. Render-only — purely cosmetic, never feeds the sim/replay.
    fx: {
      kind: 'bolt', styles: ['pixel', 'round'],
      trigger: 'flapRandom', everyMin: 5, everyMax: 10,
      speed: 1400,                                   // px/sec the bolt travels
      anchorX: 0.5, anchorY: -0.18,                  // pincer tip (× sprite size, from centre)
      color: '#00e5ff', radius: 6,
    },
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
  horse: {
    label: 'Horse',
    sky: '#f3c98b', ground: '#c08a4e',   // dusty desert daylight + sandy trail
    surface: ['#d9a866', '#e8c488', '#a8703a'],   // sandy trail lip
    cloudFill: 'rgba(255,250,235,0.85)',
    anim: true,           // 2-frame: gallop extended ↔ gathered (legs tuck under)
    // Programmatic mane + tail streamers that ripple in the wind every frame (not just
    // on flap), drawn relative to the sprite in drawPlayer. Render-only — never the sim.
    fx: { kind: 'mane', styles: ['pixel', 'round'], color: '#5a3823' },
    // Red-rock sandstone mesa pillars: warm banded stone with a darker shelf cap and
    // horizontal strata lines (the canyon the trail runs through).
    drawPipe(x, topH, gap) {
      framedPipe(x, topH, gap, {
        bodyColor: '#b5613a', capColor: '#9a4f30', capH: 18, capW: C.PIPE_W + 8,
        decorate({ x, topH, botY, capX, capW, capH }) {
          // strata: lighter + darker horizontal bands carved into the rock face
          const strata = ['rgba(214,140,98,0.55)', 'rgba(120,58,34,0.4)'];
          for (let y = 8, i = 0; y < topH - capH; y += 9, i++) {
            ctx.fillStyle = strata[i % 2]; ctx.fillRect(x, y, C.PIPE_W, 3);
          }
          for (let y = botY + capH + 8, i = 0; y < C.GROUND; y += 9, i++) {
            ctx.fillStyle = strata[i % 2]; ctx.fillRect(x, y, C.PIPE_W, 3);
          }
          // shelf shadow under each cap
          ctx.fillStyle = 'rgba(70,34,18,0.35)';
          ctx.fillRect(capX, topH - capH, capW, 3);
          ctx.fillRect(capX, botY + capH - 3, capW, 3);
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
// caps the summit. Reads as a mountain, not a hill — used by the dragon theme.
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
// Blend a hex colour toward white by `f` (0..1) — used to haze distant foliage so
// far trees read lighter/cooler (aerial perspective). Render-only.
function lighten(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.round(c + (255 - c) * f);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

// A conifer on a trunk: stacked stepped triangles in pixel mode, smooth rounded tiers
// (soft-cornered triangles) in round mode. `tiers` controls height (more = taller); the
// trunk and tier geometry scale with both `scale` and `tiers` so big trees stay in
// proportion. `tint` (0..1) hazes the foliage toward white for distance/depth.
function pixelTree(x, scale, leaf, trunk, opt: any = {}) {
  const s = scale, baseY = G();
  const tiers = opt.tiers ?? 3;
  const leafC = opt.tint ? lighten(leaf, opt.tint) : leaf;
  const trunkC = opt.tint ? lighten(trunk, opt.tint * 0.7) : trunk;
  const trunkH = 4 * s;
  if (isRound()) {
    ctx.fillStyle = trunkC;
    ctx.fillRect(x - 2 * s, baseY - trunkH, 4 * s, trunkH);       // trunk (kept blocky/short)
    ctx.fillStyle = leafC;
    for (let tier = 0; tier < tiers; tier++) {
      const ty = baseY - (4 + tier * 5) * s, tw = (14 + (tiers - 3) * 2 - tier * 3) * s, th = 7 * s;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);                                     // apex
      ctx.quadraticCurveTo(x - tw / 2, ty, x, ty);                // left skirt, soft
      ctx.quadraticCurveTo(x + tw / 2, ty, x, ty - th);           // right skirt, soft
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  pxRect(x - 2 * s, baseY - trunkH, 4 * s, trunkH, trunkC);       // trunk
  for (let tier = 0; tier < tiers; tier++) {
    const ty = baseY - (4 + tier * 5) * s, tw = (14 + (tiers - 3) * 2 - tier * 3) * s;
    for (let r = 0; r < 5; r++) pxRect(x - tw / 2 + r * s, ty - r * s, tw - r * 2 * s, s, leafC);
  }
}

// Generic structure-scatter engine: lays out `count` props across one tile with
// deterministic-per-tile variety (hash01) and DEPTH SORTING — each prop gets a random
// x, a scale in [sMin,sMax], a `depth` (0 near/big … 1 far/small), and a spare random
// `r` for per-prop shape variation. Props are drawn far-first so nearer/bigger ones
// overlap them, and `tint = depth × tintMax` hazes distant props toward white (aerial
// perspective). The `draw(px, scale, depth, tint, r)` callback paints ONE prop at px,
// anchored to the ground. Render-only + deterministic → never feeds the sim.
// Shared by the bird/bee tree stands, the bee apiary, and the airplane rooftop gear.
function scatterProps(x, tileW, seed, count, sMin, sMax, tintMax, draw) {
  const span = sMax - sMin;
  const props: any[] = [];
  for (let i = 0; i < count; i++) {
    const r1 = hash01(seed * 7.3 + i * 11.1), r2 = hash01(seed * 3.7 + i * 5.9), r = hash01(seed * 9.1 + i * 2.3);
    const scale = sMin + r2 * span;
    props.push({ px: x + Math.round(r1 * (tileW - 30)) + 15, scale, depth: (sMax - scale) / span, r });
  }
  props.sort((a, b) => b.depth - a.depth);                        // far first → near overlaps
  for (const p of props) draw(p.px, p.scale, p.depth, p.depth * tintMax, p.r);
}

// A varied stand of conifers across one tile (shared by the bird + bee meadows).
// `palette` = [leafColor, trunkColor].
function treeStand(x, tileW, seed, [leaf, trunk], count = 4) {
  scatterProps(x, tileW, seed, count, 2, 5.2, 0.45, (px, scale, _d, tint, r) =>
    pixelTree(px, scale, leaf, trunk, { tiers: 3 + Math.floor(r * 2), tint }));
}

// A classic skep beehive: tapering stacked straw bands (widest at the base) topped by a
// knob, with a dark entrance hole. `s` = scale (band width/height grow with it). `tint`
// hazes it toward white for depth. Render-only.
// `s = 1` ≈ the original fixed hive (~30px wide base, ~7px bands).
function pixelHive(x, s, tint = 0) {
  const baseY = G(), bandH = Math.max(3, Math.round(7 * s));
  const straw = (c) => tint ? lighten(c, tint) : c;
  const bands = ['#e0a84e', '#c8923c', '#e0a84e', '#c8923c', '#d49a44'];
  bands.forEach((c, i) => {
    const w = Math.round((30 - i * 4) * s), by = baseY - (i + 1) * bandH;
    pxRect(x - w / 2, by, w, bandH, straw(c));
    ctx.fillStyle = `rgba(120,80,20,${0.35 * (1 - tint)})`;       // coil shadow under each band
    ctx.fillRect(x - w / 2, by + bandH - 1, w, 1);
  });
  pxRect(x - Math.round(2 * s), baseY - bands.length * bandH - 3, Math.round(4 * s), 3, straw('#b07c2e')); // knob
  pxRect(x - Math.round(3 * s), baseY - Math.round(6 * s), Math.round(6 * s), Math.round(4 * s), '#3a2a10'); // entrance
}

// A varied apiary of skep beehives across one tile (shared scatter engine).
function hiveStand(x, tileW, seed, count = 3) {
  scatterProps(x, tileW, seed, count, 0.5, 0.95, 0.4, (px, scale, _d, tint) => pixelHive(px, scale, tint));
}

// A rooftop AC cooling unit with a vent grille + a blinking status LED. `s` = scale,
// `tint` hazes it for depth, `baseY` = the surface it sits on (defaults to the ground;
// pass a rooftop Y to mount it on a building). Blink phase keyed off x.
function acUnit(x, s, tint = 0, baseY = G()) {
  const w = Math.round(60 * s), h = Math.round(40 * s);
  pxRect(x - w / 2, baseY - h, w, h, tint ? lighten('#37474f', tint) : '#37474f');
  pxRect(x - w / 2 + Math.round(8 * s), baseY - h + Math.round(6 * s), Math.round(44 * s), Math.round(12 * s), tint ? lighten('#263238', tint) : '#263238');
  const led = Math.sin(nowSec() * 2.5 + x) > 0.3;
  pixelDisc(x + Math.round(w / 2 - 6 * s), baseY - h + Math.round(4 * s), Math.max(1, 2 * s), led ? 'rgba(120,255,140,0.9)' : 'rgba(120,255,140,0.2)');
}

// A satellite dish on a mast that slowly pans back and forth. `s` = scale, `tint` for
// depth, `baseY` = mast foot (defaults to the ground; pass a rooftop Y to mount it on a
// building). Pan phase keyed off x → each dish sweeps independently.
function satelliteDish(x, s, tint = 0, baseY = G()) {
  const mastH = Math.round(30 * s), mastY = baseY - mastH;
  const face = tint ? lighten('#78909c', tint) : '#78909c';
  const inner = tint ? lighten('#9fb3c2', tint) : '#9fb3c2';
  pxRect(x - Math.round(3 * s), mastY, Math.round(6 * s), mastH, tint ? lighten('#455a64', tint) : '#455a64'); // mast
  ctx.save();
  ctx.translate(x, mastY);
  ctx.rotate(Math.sin(nowSec() * 0.4 + x * 0.01) * 0.5);          // pan
  ctx.fillStyle = face;
  ctx.beginPath(); ctx.ellipse(0, -12 * s, 16 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = inner;
  ctx.beginPath(); ctx.ellipse(0, -12 * s, 11 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  pxRect(-1 * s, -12 * s, Math.max(1, 2 * s), 8 * s, '#37474f');   // feed arm
  ctx.restore();
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
  // Near treeline — a depth-sorted stand of varied conifers (shared treeStand engine).
  { speed: 0.5, draw(o) { tileMotif(o, 280, (x, tile) => treeStand(x, 280, tile, ['#2e7d32', '#5d4037'], 5)); } },
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

THEMES.monkey.bgLayers = [
  // Bubbles rising from the seabed — same particle engine as penguin snow, but
  // dir=-1 (up). Thinned out from the original pass (fewer, calmer) and given
  // three alternating looks — derived deterministically from each particle's
  // radius — so the stream reads as varied bubbles, not a uniform ring-spam.
  { speed: 0, draw() {
      particleStream(28, -1,
        { minSpd: 14, spanSpd: 34, minSway: 3, spanSway: 8, minR: 2.5, spanR: 10, minA: 0.06, spanA: 0.08 },
        (x, y, r, a) => {
          const variant = Math.round(r * 7) % 3;
          if (variant === 0) {
            // classic hollow ring
            pixelDisc(x, y, r, `rgba(150,230,255,${a + 0.05})`);
            pixelDisc(x, y, Math.max(1, r - 3), `rgba(180,240,255,${a})`);
          } else if (variant === 1) {
            // small solid bead — denser, no ring
            pixelDisc(x, y, Math.max(1, r - 4), `rgba(200,240,255,${a + 0.04})`);
          } else {
            // a bubble trailing a tiny companion
            pixelDisc(x, y, r, `rgba(150,230,255,${a + 0.03})`);
            pixelDisc(x, y, Math.max(1, r - 3), `rgba(180,240,255,${a - 0.02})`);
            pixelDisc(x + r * 0.9, y + r * 0.7, Math.max(1, r * 0.4), `rgba(180,240,255,${a})`);
          }
        });
  } },
  // Reef rock spires: jagged background pillars forming the level's "skyline" —
  // a coral-flecked silhouette standing in for the construction-site girders the
  // rest of the roster wears (this level dropped that framing for a reef/jungle one).
  { speed: 0.35, draw(o) { tileMotif(o, 240, x => {
      const spire = (sx, peakY, baseW, c) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(sx - baseW / 2, G());
        ctx.lineTo(sx - baseW / 3, peakY + 16);
        ctx.lineTo(sx - baseW / 7, peakY);
        ctx.lineTo(sx + baseW / 9, peakY + 12);
        ctx.lineTo(sx + baseW / 3, peakY + 4);
        ctx.lineTo(sx + baseW / 2, G());
        ctx.closePath();
        ctx.fill();
      };
      spire(x + 40,  G() - 150, 70, 'rgba(60,90,82,0.30)');
      spire(x + 130, G() - 110, 55, 'rgba(50,78,70,0.26)');
      spire(x + 195, G() - 185, 80, 'rgba(70,100,90,0.22)');
      // coral-blob accents catching the light along the ridgelines
      pixelDisc(x + 40,  G() - 152, 3, 'rgba(232,116,138,0.35)');
      pixelDisc(x + 195, G() - 186, 3, 'rgba(240,163,92,0.30)');
  }); } },
  // Rolling barrels: DK's signature hazard, adrift and tumbling end-over-end on
  // the current — rusty oil-drums with banded rims (shared wanderers engine, the
  // same one that drives tumbleweeds and traffic).
  { speed: 0, draw() {
      const t = nowSec();
      const round = isRound();
      wanderers(
        [
          { drift: 65,  baseY: G() - 95,  yAmp: 18, wy: 1.6, sy: 0.7, bank: 0, flapHz: 1 },
          { drift: -50, baseY: G() - 160, yAmp: 24, wy: 1.2, sy: 0.9, bank: 0, flapHz: 1 },
          { drift: 90,  baseY: G() - 50,  yAmp: 14, wy: 2.1, sy: 0.6, bank: 0, flapHz: 1 },
        ],
        (i) => {
          ctx.rotate((t * (1.6 + i * 0.4)) % (Math.PI * 2));          // tumbling roll
          const w = 13, h = 17;
          const body = '#7a4a26', band = '#4a2e16';
          if (round) {
            roundRect(ctx, -w / 2, -h / 2, w, h, 4); ctx.fillStyle = body; ctx.fill();
            ctx.strokeStyle = band; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-w / 2, -h * 0.18); ctx.lineTo(w / 2, -h * 0.18); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-w / 2, h * 0.18); ctx.lineTo(w / 2, h * 0.18); ctx.stroke();
            ctx.lineWidth = 1;
          } else {
            pxRect(-w / 2, -h / 2, w, h, body);
            pxRect(-w / 2, -h * 0.3, w, 2, band);
            pxRect(-w / 2, h * 0.18, w, 2, band);
            pxRect(-w / 2, -h / 2, w, 2, '#3a2210');
            pxRect(-w / 2, h / 2 - 2, w, 2, '#3a2210');
          }
        });
  } },
  // Banana bunch: a small drifting DK Country callback, bobbing lazily through
  // the current alongside the barrels (shared wanderers engine).
  { speed: 0, draw() {
      const round = isRound();
      const body = '#f0d33c', stem = '#6b4a16';
      wanderers(
        [{ drift: 45, baseY: G() - 230, yAmp: 14, wy: 1.1, sy: 0.55, bank: 0.15, flapHz: 1 }],
        () => {
          const banana = (ox, oy, rot) => {
            ctx.save(); ctx.translate(ox, oy); ctx.rotate(rot);
            if (round) { roundRect(ctx, -2.5, -6, 5, 12, 2.5); ctx.fillStyle = body; ctx.fill(); }
            else pxRect(-2, -6, 4, 12, body);
            ctx.restore();
          };
          banana(-4, 1, -0.5);
          banana(0, -2, 0);
          banana(4, 1, 0.5);
          if (round) { ctx.beginPath(); ctx.arc(0, -8, 1.6, 0, Math.PI * 2); ctx.fillStyle = stem; ctx.fill(); }
          else pxRect(-1, -9, 2, 2, stem);
        });
  } },
  // Pauline cameo: a tiny "damsel adrift" silhouette riding an air bubble — DK's
  // rescue target, here just another reef wanderer drifting through the current.
  { speed: 0, draw() {
      const round = isRound();
      const skin = '#e8c9a8', dress = '#d13a6e', hair = '#3a2414';
      wanderers(
        [{ drift: -35, baseY: G() - 280, yAmp: 20, wy: 0.8, sy: 0.4, bank: 0, flapHz: 1 }],
        () => {
          // air bubble (hollow ring, matching the rising-bubble layer's style)
          pixelDisc(0, 0, 13, 'rgba(180,240,255,0.18)');
          pixelDisc(0, 0, 10, 'rgba(150,230,255,0.10)');
          if (round) {
            ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(3, 6); ctx.lineTo(0, -2); ctx.closePath();
            ctx.fillStyle = dress; ctx.fill();
            ctx.beginPath(); ctx.arc(0, -4, 2.4, 0, Math.PI * 2); ctx.fillStyle = skin; ctx.fill();
            ctx.beginPath(); ctx.arc(0, -5.5, 2.4, Math.PI, Math.PI * 2); ctx.fillStyle = hair; ctx.fill();
          } else {
            pxRect(-2, -4, 4, 6, dress);  // dress
            pxRect(-1, -6, 2, 2, skin);   // head
            pxRect(-1, -7, 2, 1, hair);   // hair
          }
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
  // A sun in the corner with slowly rotating, breathing rays + an inner glow cap.
  { speed: 0, draw() {
      celestialBody(C.W - 120, 110, 38, '#ffd54f', {
        rays: { color: '255,213,79', count: 12, speed: 0.12 },
        caps: [{ dx: 0, dy: 0, r: 32, color: '#ffe57f' }],       // inner brighter core
      });
  } },
  // High drifting clouds that sail across (and in front of) the sun. Time-driven drift,
  // deterministic via index hashes — same engine as the bird theme's sky.
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
  // Distant birds gliding across the sky ("M" gull silhouettes; wings beat on the flap
  // phase). Slow flap → distant soaring. Shared wanderers engine.
  { speed: 0, draw() {
      wanderers(
        [
          { drift: 26,  baseY: 150, yAmp: 30, wy: 0.5, sy: 1.1, bank: 0.25, flapHz: 3.5 },
          { drift: 22,  baseY: 200, yAmp: 26, wy: 0.7, sy: 1.4, bank: 0.25, flapHz: 4.0 },
          { drift: 30,  baseY: 110, yAmp: 22, wy: 0.4, sy: 0.9, bank: 0.25, flapHz: 3.0 },
        ],
        (i, t, flap) => {
          const up = flap ? 5 : 2;
          ctx.strokeStyle = 'rgba(40,50,60,0.7)';
          ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(-7, 0); ctx.lineTo(-2, -up); ctx.lineTo(0, -1);
          ctx.lineTo(2, -up); ctx.lineTo(7, 0);
          ctx.stroke();
          ctx.lineWidth = 1;
        });
  } },
  // Soft green hills
  { speed: 0.18, draw(o) { tileMotif(o, 300, x => { pixelHill(x, 280, 100, '#9ccc65'); pixelHill(x + 150, 220, 70, '#aed581'); }); } },
  // A varied stand of trees behind the apiary (shared treeStand engine, lighter green).
  { speed: 0.35, draw(o) { tileMotif(o, 300, (x, tile) => treeStand(x, 300, tile + 17, ['#4c9a3a', '#6d4c41'], 5)); } },
  // A varied apiary of skep beehives up front (shared scatter engine — size variety +
  // depth haze, same as the tree stands).
  { speed: 0.55, draw(o) { tileMotif(o, 240, (x, tile) => hiveStand(x, 240, tile + 5, 3)); } },
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

// Lightning strength for the dragon theme: a sharp flash that decays, firing every
// ~3.5s with a double-blink. Returns 0 (dark) … 1 (full flash). Render-only. Short
// period so a strike is always near — no long wait to see one after switching.
function dragonFlash() {
  const t = nowSec();
  const period = 3.5;
  const into = t % period;                  // seconds since last strike began
  if (into > 0.6) return 0;                  // dark most of the cycle
  // two quick blinks inside the first 0.6s, exponential-ish decay
  const a = Math.max(0, 1 - into / 0.25);
  const b = into > 0.3 ? Math.max(0, 1 - (into - 0.3) / 0.2) * 0.7 : 0;
  return Math.max(a, b);
}

// Volcanic lightning for the new dragon stage: same double-blink shape as
// dragonFlash, but on a longer ~7s period — "kept, but a bit less" thunder,
// distinct from the storm-theme cadence the (hidden) wizard inherited.
function emberLightning() {
  const t = nowSec();
  const period = 7;
  const into = t % period;
  if (into > 0.6) return 0;
  const a = Math.max(0, 1 - into / 0.25);
  const b = into > 0.3 ? Math.max(0, 1 - (into - 0.3) / 0.2) * 0.7 : 0;
  return Math.max(a, b);
}

// Eruption state for the dragon's volcano: a slow simmer-build-burst-settle
// cycle (~9s), independent of dragonFlash's quick lightning timing so the two
// never sync into a single "everything happens at once" beat. Returns:
//   glow  — 0.12 (ambient crater simmer) … 1 (peak burst), a brightness curve
//           that rises then falls — used for the crater/rivulet/ash-tint glow.
//   erupt — null outside the active eruption window, else a MONOTONIC 0..1
//           progress through it — drives ballistic bombs / the rising ash
//           column, which must animate strictly forward (not rise-then-rewind
//           the way `glow`'s rise-then-fall shape would force them to).
// Render-only.
function volcano() {
  const t = nowSec();
  const period = 9;
  const into = t % period;
  const rampStart = 6, peak = 6.6, settle = 8.5;
  let glow = 0.12;
  if (into < rampStart) glow = 0.12;
  else if (into < peak) glow = 0.12 + 0.88 * (into - rampStart) / (peak - rampStart);
  else if (into < settle) glow = Math.max(0.12, 1 - (into - peak) / (settle - peak));
  const erupt = (into >= rampStart && into < settle) ? (into - rampStart) / (settle - rampStart) : null;
  return { glow, erupt };
}

// Per-meteor fall-and-impact curve, keyed by index `i` so each meteor in the
// layer runs its own offset cycle (staggered, not synced). Returns
// { y: 0..1 fall progress (clamped at 1 = ground), impact: 0..1 flash strength
// just after landing }. Render-only, deterministic — pure function of time + i.
function meteorFall(i) {
  const t = nowSec();
  const period = 6 + (i % 3) * 2;            // stagger cadence per meteor
  const into = (t + i * 173) % period;
  const fallDur = 1.4;
  if (into < fallDur) return { y: into / fallDur, impact: 0 };
  const sinceImpact = into - fallDur;
  const impact = sinceImpact < 0.35 ? Math.max(0, 1 - sinceImpact / 0.35) : 0;
  return { y: 1, impact };
}

// Mini lava-vent eruption state — the volcano's `{ glow, erupt }` language
// reused "in different dimensions": same simmer→build→burst→settle shape, just
// faster and staggered per-vent by index `i`, so the floor's vents pop off on
// their own independent cadences rather than mirroring the big one in miniature.
function ventState(i) {
  const t = nowSec();
  const period = 5 + (i % 3);
  const into = (t + i * 211) % period;
  const rampStart = period - 2.2, peak = period - 1.7, settle = period - 0.5;
  let glow = 0.15;
  if (into < rampStart) glow = 0.15;
  else if (into < peak) glow = 0.15 + 0.85 * (into - rampStart) / (peak - rampStart);
  else if (into < settle) glow = Math.max(0.15, 1 - (into - peak) / (settle - peak));
  const erupt = (into >= rampStart && into < settle) ? (into - rampStart) / (settle - rampStart) : null;
  return { glow, erupt };
}

// Blocky pixel-art lava cascade — a stepped channel of glowing chunks running
// from (x0,y0) to (x1,y1), with a brightness wave that visibly travels
// downhill over time (the classic "flowing lava" palette-cycle look), pooling
// in a simmering glow where it meets the ground.
function lavaFlow(x0, y0, x1, y1, glow) {
  const t = nowSec();
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len, ny = dx / len;          // perpendicular unit vector — for meander
  // chunk count scales with the slope's actual length so the lava "grain" —
  // chunk size and spacing — looks the same on a small spike as on the big
  // volcano cone, instead of sparse-on-big / cramped-on-small
  const steps = Math.max(3, Math.round(len / 18));
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1);
    // gentle meander off the straight line, seeded by i (not random — stays
    // replay-deterministic while killing the "ruler" look)
    const wobble = Math.sin(i * 1.7 + x0 * 0.05) * 4 * (1 - f * 0.4);
    const px = x0 + dx * f + nx * wobble, py = y0 + dy * f + ny * wobble;
    const w = 5 + f * 6;
    const wave = 0.5 + 0.5 * Math.sin((f * 5 - t * 1.4) * Math.PI * 2);
    const bright = glow * (0.35 + 0.65 * wave);
    pxRect(px - w/2 - 1, py - w/2 - 1, w + 2, w + 2, `rgba(70,22,10,${0.5 + 0.3*glow})`);
    pxRect(px - w/2, py - w/2, w, w, `rgba(255,${130 + Math.round(100*bright)},${40 + Math.round(70*bright)},${0.5 + 0.45*bright})`);
    if (bright > 0.6) pxRect(px - 1, py - 1, 2, 2, `rgba(255,240,200,${(bright - 0.6) * 1.5})`);
  }
  const poolGlow = glow * (0.6 + 0.4 * Math.sin(t * 1.4 + x0 * 0.01));
  pixelDisc(x1, y1 + 2, 6 + 4 * poolGlow, `rgba(255,${120 + Math.round(100*poolGlow)},50,${0.22 + 0.28*poolGlow})`);
}

// A thinner glowing fissure tracing a slope — a hairline crack of light rather
// than a full molten cascade. Used for secondary faces so not every slope on
// the range carries the same heavy effect (variety without extra clutter).
function lavaCrack(x0, y0, x1, y1, glow) {
  const t = nowSec();
  const dx = x1 - x0, dy = y1 - y0;
  // jag amplitude as a fraction of the crack's own length — keeps it reading
  // as "the same crack, scaled" rather than relatively straighter on long
  // slopes and relatively zigzaggier on short ones
  const len = Math.max(1, Math.hypot(dx, dy));
  const jag = len * 0.05;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.7 + x0 * 0.05);
  const bright = glow * (0.35 + 0.65 * pulse);
  ctx.strokeStyle = `rgba(255,${130 + Math.round(90 * bright)},60,${0.2 + 0.5 * bright})`;
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + dx * 0.4 + jag, y0 + dy * 0.4);
  ctx.lineTo(x0 + dx * 0.7 - jag * 0.75, y0 + dy * 0.7);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.lineWidth = 1;
}

THEMES.dragon.bgLayers = [
  // Ash plumes: heavy dark banks drifting low across the sky, lit warm-orange
  // from beneath — brighten as the volcano builds toward an eruption (recolored
  // + reusing the storm theme's overlapping-lobe cloud-bank technique).
  { speed: 0, draw() {
      const t = nowSec();
      const p = volcano().glow;
      const drift = (t * 12) % (C.W + 300);
      const base = `rgba(${70 + Math.round(p * 90)},${50 + Math.round(p * 50)},${42 + Math.round(p * 18)},`;
      for (let k = 0; k < 6; k++) {
        const cx = ((k * 280 - drift + C.W + 300) % (C.W + 300)) - 150;
        const cy = 40 + (k % 3) * 34;
        const w = 200 + (k % 2) * 80, h = 70 + (k % 3) * 16;
        pixelCloud(cx, cy, w, h, base + (0.85) + ')');
        pixelCloud(cx + 50, cy + 14, w * 0.7, h * 0.8, base + (0.7) + ')');
      }
  } },
  // Embers: glowing cinders rising off the volcano on the heat thermals, swaying
  // lazily as they drift up and fade (recolored + re-aimed from the storm
  // theme's side-blown wind dust — thinned out to stay calm, not noisy).
  { speed: 0, draw() {
      const t = nowSec();
      for (let i = 0; i < 50; i++) {
        const spd = 28 + (i % 6) * 13;
        const y = G() - ((t * spd + i * 137) % (C.GROUND + 60));
        const x = (i * 89 + 20) % C.W + Math.sin(t * 1.3 + i) * 14;
        const r = 1.4 + (i % 3);
        const a = 0.08 + (i % 5) * 0.04;
        pixelDisc(x, y, r, `rgba(255,${130 + (i % 4) * 28},60,${a})`);
      }
  } },
  // Volcanic lightning: real eruptions generate their own static-charge storms —
  // a satirical-accurate detail. Same strike shape as the storm theme's bolt,
  // but on a longer cadence ("kept, but a bit less") and a warm-toned flash.
  { speed: 0, draw() {
      const f = emberLightning();
      if (f <= 0) return;
      ctx.fillStyle = `rgba(255,210,160,${0.45 * f})`;
      ctx.fillRect(0, 0, C.W, C.GROUND);
      if (f > 0.5) {
        ctx.strokeStyle = `rgba(255,255,240,${f})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let bx = C.W * 0.62, by = 0;
        ctx.moveTo(bx, by);
        for (let s = 0; s < 6; s++) { bx += (s % 2 ? 26 : -22); by += 48; ctx.lineTo(bx, by); }
        ctx.stroke();
        ctx.lineWidth = 1;
      }
  } },
  // Basalt ridge — dark volcanic-rock peaks streaked with glowing lava flows
  // running down from their summits (recolored + thinned from the storm theme's
  // snow-capped range; a calmer backdrop so the volcano reads as the star).
  { speed: 0.12, draw(o) { tileMotif(o, 460, x => {
      const glow = volcano().glow;
      // a point a fraction `f` along the line from (x0,y0) to (x1,y1), nudged
      // `inset` px toward the interior (perpendicular, left-of-travel) — keeps
      // the lava hugging the rock face instead of floating off the silhouette
      const hug = (x0, y0, x1, y1, f, inset) => {
        const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
        return [x0 + dx * f - (dy / len) * inset, y0 + dy * f + (dx / len) * inset];
      };
      // One full molten cascade per peak (its more prominent face) plus a
      // thinner glowing fissure on the other — mixes the two lava languages so
      // the range doesn't read as the same effect copy-pasted on every slope.
      const peak = (px, w, h, c, mainSide) => {
        pixelPeak(px, w, h, c);
        const apexX = px + w * 0.42, apexY = G() - h;
        const shoulderX = px + w * 0.72, shoulderY = G() - h * 0.55;
        const [lx0, ly0] = hug(px, G(), apexX, apexY, 0.84, 6);
        const [lx1, ly1] = hug(px, G(), apexX, apexY, 0.14, 6);
        const [rx0, ry0] = hug(px + w, G(), shoulderX, shoulderY, 0.74, -6);
        const [rx1, ry1] = hug(px + w, G(), shoulderX, shoulderY, 0.12, -6);
        if (mainSide === 'left') {
          lavaFlow(lx0, ly0, lx1, ly1, glow);
          lavaCrack(rx0, ry0, rx1, ry1, glow);
        } else {
          lavaCrack(lx0, ly0, lx1, ly1, glow);
          lavaFlow(rx0, ry0, rx1, ry1, glow);
        }
      };
      // a sharper, jagged spire — variety against the smoother massifs, with
      // a thin glowing fissure (not a full cascade — keeps the skyline calm)
      const spike = (sx, peakY, baseW, c) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(sx - baseW / 2, G());
        ctx.lineTo(sx - baseW / 3, peakY + 14);
        ctx.lineTo(sx - baseW / 8, peakY);
        ctx.lineTo(sx + baseW / 10, peakY + 10);
        ctx.lineTo(sx + baseW / 3, peakY + 3);
        ctx.lineTo(sx + baseW / 2, G());
        ctx.closePath();
        ctx.fill();
        const [sx0, sy0] = hug(sx - baseW / 2, G(), sx - baseW / 8, peakY, 0.78, 4);
        const [sx1, sy1] = hug(sx - baseW / 2, G(), sx - baseW / 8, peakY, 0.16, 4);
        lavaCrack(sx0, sy0, sx1, sy1, glow);
      };
      peak(x - 30, 170, 140, '#241814', 'left');
      peak(x + 170, 140, 110, '#2e1f18', 'right');
      spike(x + 350, G() - 75, 42, '#1c120e');
  }); } },
  // The volcano: a fixed landmark (not tiled — anchored mid-background). Always
  // simmering (glowing crater + creeping lava rivulets), it periodically erupts
  // in earnest: a billowing ash column mushrooms upward and ballistic lava bombs
  // arc out on real parabolic trajectories (gravity-timed off `erupt`, a
  // monotonic progress value — so they fly forward, not rise-then-rewind the
  // way the brightness curve `glow` would force them to).
  { speed: 0.2, draw() {
      const { glow, erupt } = volcano();
      const vx = C.W - 260, baseY = G(), peakY = baseY - 230, w = 260;
      ctx.fillStyle = '#2a1a14';
      ctx.beginPath();
      ctx.moveTo(vx - w / 2, baseY);
      ctx.lineTo(vx - w * 0.18, peakY + 18);
      ctx.lineTo(vx + w * 0.12, peakY);
      ctx.lineTo(vx + w * 0.2, peakY + 14);
      ctx.lineTo(vx + w / 2, baseY);
      ctx.closePath();
      ctx.fill();
      const craterX = vx + w * 0.02, craterY = peakY + 6;
      // creeping lava down the slopes — traced along the cone's own silhouette
      // edges (nudged inward) so it hugs the rock face; one full cascade on the
      // near slope, a thinner glowing fissure on the far one for variety
      const lerp = (x0, y0, x1, y1, f) => [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
      const [llx0, lly0] = lerp(vx - w / 2, baseY, vx - w * 0.18, peakY + 18, 0.86);
      const [llx1, lly1] = lerp(vx - w / 2, baseY, vx - w * 0.18, peakY + 18, 0.16);
      lavaFlow(llx0 + 6, lly0, llx1 + 6, lly1, glow);
      const [rlx0, rly0] = lerp(vx + w / 2, baseY, vx + w * 0.2, peakY + 14, 0.86);
      const [rlx1, rly1] = lerp(vx + w / 2, baseY, vx + w * 0.2, peakY + 14, 0.16);
      lavaCrack(rlx0 - 6, rly0, rlx1 - 6, rly1, glow);
      // layered crater glow — widens + brightens toward the burst
      pixelDisc(craterX, craterY, 15 + 18 * glow, `rgba(255,${90 + Math.round(90 * glow)},40,${0.10 + 0.20 * glow})`);
      pixelDisc(craterX, craterY, 8 + 10 * glow,  `rgba(255,${110 + Math.round(120 * glow)},40,${0.25 + 0.45 * glow})`);
      pixelDisc(craterX, craterY, 4 + 5 * glow,   `rgba(255,235,170,${0.40 + 0.50 * glow})`);
      // active eruption: ash column billows up, lava bombs arc out ballistically
      if (erupt != null) {
        // billowing ash column — overlapping blooms rising and widening with `erupt`
        for (let i = 0; i < 5; i++) {
          const rise = erupt * (44 + i * 36);
          const r = 9 + i * 7 + erupt * 16;
          const a = Math.max(0, (0.24 - i * 0.035) * Math.sin(Math.min(1, erupt * 1.4) * Math.PI));
          pixelDisc(craterX + (i - 2) * 5 * erupt, craterY - rise, r, `rgba(${72 + i * 8},${58 + i * 6},${52 + i * 4},${a})`);
        }
        // ballistic lava bombs: launched at the start of the eruption window,
        // each follows x = x0 + vx·τ, y = y0 + vy·τ + ½g·τ² until it falls away
        for (let i = 0; i < 6; i++) {
          const ang = -Math.PI / 2 + (i - 2.5) * 0.24;
          const speed = 75 + i * 8, g = 260;
          const tau = erupt * 1.15;                          // bomb's own flight clock
          const fade = Math.max(0, 1 - tau);
          if (fade <= 0) continue;
          const bx = craterX + Math.cos(ang) * speed * tau;
          const by = craterY + Math.sin(ang) * speed * tau + 0.5 * g * tau * tau;
          if (by > baseY) continue;                          // landed — stop drawing
          pixelDisc(bx, by, 3 + (i % 2), `rgba(255,${140 + i * 12},50,${0.9 * fade})`);
          pixelDisc(bx, by, 1.4, `rgba(255,240,200,${fade})`);
        }
        // bright flare wash, peaking mid-eruption
        ctx.fillStyle = `rgba(255,180,90,${0.20 * Math.sin(erupt * Math.PI)})`;
        ctx.fillRect(0, 0, C.W, C.GROUND);
      }
  } },
  // Meteor streaks: a sparse rain of fiery debris falling diagonally out of the
  // ash sky, each with a tapering flame trail and a brief ground-impact flash +
  // dust puff (meteorFall staggers each one onto its own fall/impact cycle).
  { speed: 0, draw() {
      const meteors = [C.W * 0.20, C.W * 0.46, C.W * 0.74];
      meteors.forEach((mx, i) => {
        const { y, impact } = meteorFall(i);
        if (y < 1) {
          const headX = mx + y * 90, headY = y * (G() - 60);
          ctx.strokeStyle = 'rgba(255,150,60,0.6)';
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(headX, headY); ctx.lineTo(headX - 50, headY - 70); ctx.stroke();
          ctx.lineWidth = 1;
          pixelDisc(headX, headY, 5, '#fff3c4');
          pixelDisc(headX, headY, 3, '#ff8a3c');
        } else if (impact > 0) {
          pixelDisc(mx + 90, G() - 60, 16 * impact, `rgba(255,200,120,${0.5 * impact})`);
          ctx.fillStyle = `rgba(120,100,90,${0.35 * impact})`;
          ctx.fillRect(mx + 70, G() - 64, 50, 6);
        }
      });
  } },
  // Lava floor: the ground itself is a molten flow — a string of glowing pools
  // simmering along the surface line, each on its own staggered pulse so the
  // floor reads as alive, not a static painted strip.
  { speed: 0.6, draw(o) { tileMotif(o, 150, (x, tile) => {
      const ph = ((tile * 257) % 100) / 100;
      const s = 0.5 + 0.5 * Math.sin(nowSec() * 1.6 + ph * Math.PI * 2);
      const r = 10 + 8 * s;
      pixelDisc(x + 60, G() + 4, r, `rgba(255,${130 + Math.round(80*s)},50,${0.18 + 0.22*s})`);
      pixelDisc(x + 60, G() + 4, r * 0.45, `rgba(255,225,160,${0.25 + 0.35*s})`);
  }); } },
  // Scattered lava vents: smaller eruptions dotted along the floor and ridge —
  // the volcano's glow-and-burst language reused at a miniature scale.
  { speed: 0, draw() {
      const vents = [C.W * 0.10, C.W * 0.34, C.W * 0.58, C.W * 0.86];
      vents.forEach((vx, i) => {
        const { glow, erupt } = ventState(i);
        const vy = G() - 2;
        pixelDisc(vx, vy, 6 + 7*glow, `rgba(255,${100 + Math.round(110*glow)},40,${0.18 + 0.35*glow})`);
        pixelDisc(vx, vy, 3 + 3*glow, `rgba(255,230,160,${0.3 + 0.5*glow})`);
        if (erupt != null) {
          for (let j = 0; j < 3; j++) {
            const ang = -Math.PI/2 + (j - 1) * 0.4;
            const speed = 36 + j * 8, g = 240;
            const tau = erupt * 1.1;
            const fade = Math.max(0, 1 - tau);
            if (fade <= 0) continue;
            const bx = vx + Math.cos(ang) * speed * tau;
            const by = vy + Math.sin(ang) * speed * tau + 0.5*g*tau*tau;
            if (by > vy + 4) continue;
            pixelDisc(bx, by, 2, `rgba(255,${150+j*15},60,${0.85*fade})`);
          }
        }
      });
  } },
];

// Straight copy of the dragon level's scenery — parked here for the (hidden,
// asset-less) wizard theme so this storm/keep work survives the dragon redesign.
THEMES.wizard.bgLayers = [
  { speed: 0, draw() {
      const t = nowSec();
      const f = dragonFlash();
      const drift = (t * 12) % (C.W + 300);
      const base = `rgba(${44 + f * 90},${38 + f * 80},${64 + f * 90},`;
      for (let k = 0; k < 6; k++) {
        const cx = ((k * 280 - drift + C.W + 300) % (C.W + 300)) - 150;
        const cy = 40 + (k % 3) * 34;
        const w = 200 + (k % 2) * 80, h = 70 + (k % 3) * 16;
        pixelCloud(cx, cy, w, h, base + (0.85) + ')');
        pixelCloud(cx + 50, cy + 14, w * 0.7, h * 0.8, base + (0.7) + ')');
      }
  } },
  { speed: 0, draw() {
      const t = nowSec();
      for (let i = 0; i < 80; i++) {
        const spd = 120 + (i % 6) * 40;
        const x = C.W - ((t * spd + i * 137) % (C.W + 60)) + 30;
        const y = (i * 89 + 20) % (C.GROUND - 30) + Math.sin(t * 2 + i) * 6;
        const len = 5 + (i % 4) * 3;
        const a = 0.12 + (i % 5) * 0.05;
        ctx.strokeStyle = `rgba(200,185,225,${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + 1); ctx.stroke();
      }
  } },
  { speed: 0, draw() {
      const f = dragonFlash();
      if (f <= 0) return;
      ctx.fillStyle = `rgba(200,190,255,${0.55 * f})`;
      ctx.fillRect(0, 0, C.W, C.GROUND);
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
  { speed: 0.12, draw(o) { tileMotif(o, 420, x => {
      pixelPeak(x - 40, 300, 200, '#3a2a5a', '#d8cfe8');
      pixelPeak(x + 150, 260, 160, '#4a3a6e', '#cfc4e0');
      pixelPeak(x + 320, 220, 130, '#332551');
  }); } },
  { speed: 0.35, draw(o) { tileMotif(o, 520, x => {
      const bx = x + 60, by = G(), c = '#5a5566', d = '#403c4a';
      const f = dragonFlash();
      const win = `rgba(255,213,79,${0.85 + 0.15 * f})`;
      pxRect(bx, by - 70, 120, 70, c);
      for (let t = 0; t < 4; t++) pxRect(bx - 10 + t * 40, by - 92, 20, 26, c);
      for (let t = 0; t < 4; t++) pxRect(bx - 6 + t * 40, by - 100, 12, 10, d);
      pxRect(bx + 50, by - 40, 20, 40, d);
      ctx.fillStyle = win; ctx.fillRect(bx + 18, by - 56, 8, 8); ctx.fillRect(bx + 94, by - 56, 8, 8);
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
        // Small panning satellite dish on the roof (~55% of slabs), set toward one edge.
        if (hash01(seed * 23 + 1) > 0.45) {
          const dx = sx + Math.round(w * (0.6 + hash01(seed * 29) * 0.3));
          satelliteDish(dx, 0.35 + hash01(seed * 31) * 0.2, 0, topY);
        }
        // Small AC cooling unit on the roof (~50% of slabs), toward the other edge.
        if (hash01(seed * 37 + 2) > 0.5) {
          const ax = sx + Math.round(w * (0.1 + hash01(seed * 41) * 0.25));
          acUnit(ax, 0.22 + hash01(seed * 43) * 0.12, 0, topY);
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
  // Transit tubes: Futurama-style translucent transport tubes carry little passenger
  // pods — each pod holds a crude pixel person. Mix of styles: shallow horizontal
  // bands, a steep riser, and one tube that recedes INTO the screen (perspective),
  // where pods + people shrink as they travel toward the vanishing point.
  { speed: 0, draw() {
      const t = nowSec();
      const round = isRound();
      // A seated pixel figure built from explicit body parts so it reads as a person:
      // round head, neck, torso, two arms, two bent legs. `cy` = the seat line (hips);
      // `s` = scale (1 near, <1 far). Parts grow/shrink together with `u`.
      const drawPerson = (cx, cy, s) => {
        const u = Math.max(1, 2 * s);                 // base pixel unit (≥1px)
        const dark = 'rgba(16,24,38,0.96)';           // torso/limbs
        const skin = 'rgba(60,76,98,0.98)';           // head (lighter → reads separate)
        const x = Math.round(cx), hipY = Math.round(cy);
        const px = (ox, oy, w, h, c) => pxRect(Math.round(x + ox), Math.round(hipY + oy), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), c);
        // legs: thighs forward (seated), shins down
        px(-u * 1.6, 0, u * 1.4, u, dark);            // thigh L
        px(u * 0.2, 0, u * 1.4, u, dark);             // thigh R
        px(u * 1.0, u, u, u * 1.2, dark);             // shin (front, bent down)
        // torso
        px(-u, -u * 2.6, u * 2, u * 2.6, dark);
        // arms (resting forward on lap)
        px(u * 0.4, -u * 1.6, u * 1.2, u * 0.9, dark);
        // neck + head
        px(-u * 0.4, -u * 3.1, u * 0.8, u * 0.6, skin);
        if (round) pixelDisc(x, Math.round(hipY - u * 4), Math.max(1, Math.round(u)), skin);
        else px(-u, -u * 4.6 + u * 0.4, u * 2, u * 1.6, skin);
      };
      // A glowing capsule with a person inside. `s` = scale, `col` = rgb triplet string.
      const drawPod = (cx, cy, s, col) => {
        const w = Math.max(4, Math.round(15 * s)), h = Math.max(4, Math.round(15 * s));
        const x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
        // glass shell: faint translucent fill + a thin neon outline (the person shows through)
        ctx.fillStyle = `rgba(${col},0.18)`;
        ctx.strokeStyle = `rgba(${col},0.85)`; ctx.lineWidth = 1;
        if (round) {
          roundRect(ctx, x, y, w, h, Math.max(2, 4 * s)); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillRect(x, y, w, h);
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
        drawPerson(cx, cy + h * 0.28, s);            // seat at lower part of the pod
        ctx.lineWidth = 1;
      };
      // A straight glass tube as a soft double-walled band between two points.
      const drawTube = (ax, ay, bx, by, rad) => {
        ctx.strokeStyle = 'rgba(120,220,255,0.16)'; ctx.lineWidth = rad * 2;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = 'rgba(180,240,255,0.3)'; ctx.lineWidth = 1;
        // wall lines offset perpendicular to the tube direction
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * rad, ny = dx / len * rad;
        ctx.beginPath(); ctx.moveTo(ax + nx, ay + ny); ctx.lineTo(bx + nx, by + ny); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax - nx, ay - ny); ctx.lineTo(bx - nx, by - ny); ctx.stroke();
        ctx.lineWidth = 1;
      };

      // --- 2 shallow horizontal bands (the calm baseline) ---
      const bands = [
        { y: 70,  slope: -0.05 },
        { y: 215, slope: -0.04 },
      ];
      bands.forEach((tb, ti) => {
        const x0 = -60, len = C.W + 120, yAt = (x) => tb.y + (x - x0) * tb.slope;
        drawTube(x0, yAt(x0), x0 + len, yAt(x0 + len), 9);
        const dir = ti % 2 ? -1 : 1, spd = 130 + ti * 30, span = len + 80;
        for (let p = 0; p < 3; p++) {
          let px = (t * spd + p * 240 + ti * 90) % span;
          if (dir < 0) px = span - px;
          const x = x0 + px - 40;
          drawPod(x, yAt(x), 1, p % 2 ? '255,213,79' : '0,229,255');
        }
      });

      // --- 1 steep riser tube (endpoints on-screen, pods climbing) ---
      {
        const ax = 280, ay = G() - 40, bx = 360, by = 30, span = 1, spd = 0.22;
        drawTube(ax, ay, bx, by, 9);
        for (let p = 0; p < 3; p++) {
          const u = (t * spd + p / 3) % span;                       // 0 (bottom) → 1 (top)
          const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
          drawPod(x, y, 1, p % 2 ? '0,229,255' : '255,40,200');
        }
      }

      // --- 1 perspective tube receding INTO the screen ---
      {
        const nx = 120, ny = G() - 70, fx = 620, fy = 120;           // near (big) → far (small)
        const nRad = 11, fRad = 2, nScale = 1, fScale = 0.18, spd = 0.16;
        // converging walls
        ctx.fillStyle = 'rgba(120,220,255,0.12)';
        const ndx = fx - nx, ndy = fy - ny, nlen = Math.hypot(ndx, ndy) || 1;
        const ux = -ndy / nlen, uy = ndx / nlen;                     // unit perpendicular
        ctx.beginPath();
        ctx.moveTo(nx + ux * nRad, ny + uy * nRad);
        ctx.lineTo(fx + ux * fRad, fy + uy * fRad);
        ctx.lineTo(fx - ux * fRad, fy - uy * fRad);
        ctx.lineTo(nx - ux * nRad, ny - uy * nRad);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(180,240,255,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(nx + ux * nRad, ny + uy * nRad); ctx.lineTo(fx + ux * fRad, fy + uy * fRad);
        ctx.moveTo(nx - ux * nRad, ny - uy * nRad); ctx.lineTo(fx - ux * fRad, fy - uy * fRad);
        ctx.stroke();
        // far rim
        pixelDisc(Math.round(fx), Math.round(fy), fRad, 'rgba(120,220,255,0.25)');
        // pods: travel far(1)→near(0); draw in far-first order so near overlaps far
        const pods = [];
        for (let p = 0; p < 3; p++) {
          const u = 1 - ((t * spd + p / 3) % 1);                     // 1 (far) → 0 (near)
          pods.push(u);
        }
        pods.sort((a, b) => b - a).forEach((u, i) => {               // largest u (far) first
          const x = nx + (fx - nx) * u, y = ny + (fy - ny) * u;
          const s = nScale + (fScale - nScale) * u;
          drawPod(x, y, s, i % 2 ? '255,213,79' : '0,229,255');
        });
      }
  } },
  // Flying traffic: dense streams of neon vehicles streaking across in lanes, each with
  // a fading light trail. Two stacked streams per direction → a busy traffic corridor.
  { speed: 0, draw() {
      // Many cars across 6 lanes. wanderers phases each car by its array index, so we
      // expand lanes × 3 cars into one flat list → distinct indices = spread-out traffic.
      const lanes = [
        { drift: 95,  baseY: 105, yAmp: 6,  wy: 0.2,  sy: 0.5,  bank: 0.08, flapHz: 9 },
        { drift: 130, baseY: 130, yAmp: 5,  wy: 0.18, sy: 0.4,  bank: 0.08, flapHz: 11 },
        { drift: -80, baseY: 165, yAmp: 8,  wy: 0.25, sy: 0.6,  bank: 0.08, flapHz: 7 },
        { drift: -110, baseY: 195, yAmp: 6, wy: 0.22, sy: 0.5,  bank: 0.08, flapHz: 8 },
        { drift: 70,  baseY: 80,  yAmp: 5,  wy: 0.15, sy: 0.4,  bank: 0.08, flapHz: 12 },
        { drift: -60, baseY: 235, yAmp: 7,  wy: 0.2,  sy: 0.45, bank: 0.08, flapHz: 6 },
      ];
      const cars = [];
      lanes.forEach(l => { for (let c = 0; c < 3; c++) cars.push({ ...l, baseY: l.baseY + c * 3 }); });
      const round = isRound();
      wanderers(cars, (i, t, flap) => {
        const col = i % 5 === 0 ? '255,213,79' : (i % 2 ? '255,40,200' : '0,229,255');
        const big = i % 3 === 0;                                   // a few longer cars for variety
        const L = big ? 9 : 6, trail = big ? 30 : 24;
        // fading speed trail behind the car
        const grad = ctx.createLinearGradient(0, 0, -trail, 0);
        grad.addColorStop(0, `rgba(${col},0.9)`);
        grad.addColorStop(1, `rgba(${col},0)`);
        ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-trail, 0); ctx.stroke();
        // chassis (front nose tapers): a body bar with a sloped front in round mode.
        ctx.fillStyle = `rgba(${col},1)`;
        if (round) {
          roundRect(ctx, -L + 1, -2, L + 2, 4, 2); ctx.fill();
        } else {
          pxRect(-L + 1, -2, L, 4, `rgba(${col},1)`);
          pxRect(L - 2, -1, 2, 2, `rgba(${col},1)`);              // pointed nose
        }
        // canopy cabin bump + a tiny passenger silhouette inside
        const dark = 'rgba(14,22,34,0.9)';
        pxRect(-2, -4, 4, 2, `rgba(${col},0.85)`);                // cabin glass
        pxRect(-1, -4, 2, 1, dark);                               // passenger head
        // headlight at the nose; blinks brighter on the wingbeat phase
        if (round) pixelDisc(L, 0, flap ? 2 : 1, '#ffffff');
        else pxRect(L - 1, -1, 2, 2, flap ? '#ffffff' : `rgba(255,255,255,0.7)`);
        pxRect(-L, -1, 1, 2, 'rgba(255,60,60,0.9)');              // red taillight
        ctx.lineWidth = 1;
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
        // Dense window grid (tight 10px pitch → grittier, more-lit-up cyberpunk tower).
        const cols = Math.max(3, Math.floor((w - 8) / 10));
        const stepX = (w - 8) / cols;
        let cell = 0, row = 0;
        for (let yy = topY + 7; yy < G() - 6; yy += 10, row++) {
          for (let ci = 0; ci < cols; ci++, cell++) {
            const phase = ((seed * 7 + cell * 13) % 31) / 31 * 6.283;
            // High lit floor so most windows glow steadily (dense city); a slow data
            // wave ripples up the building. Only a few cells dip dark, and slowly —
            // no rapid strobe. ~1 in 9 cells is an unlit (dead) window for texture.
            const dead = (seed * 3 + cell * 7) % 9 === 0;
            const wave = 0.5 + 0.5 * Math.sin(t * 1.1 - row * 0.5 + seed);
            const lit = dead ? 0.1 : Math.min(1, 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 0.9 + phase)) * (0.5 + 0.5 * wave));
            const wx = sx + 5 + ci * stepX;
            if (round) {
              pixelDisc(Math.round(wx + 2), yy + 2, 3, withAlpha(edge, lit));
            } else {
              ctx.fillStyle = withAlpha(edge, lit);
              ctx.fillRect(Math.round(wx), yy, 6, 5);
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
      // Three overlapping towers per tile → a dense, packed cyberpunk skyline. Heights
      // vary per tile (hash01) so the silhouette isn't repetitive. The tall tower carries
      // the billboard; it alternates sides per tile.
      const tallLeft = tile % 2 === 0;
      const tallX = tallLeft ? x : x + 160, tallW = 150, tallH = 240 + Math.floor(hash01(tile * 3) * 40);
      const shortX = tallLeft ? x + 120 : x + 50, shortW = 130, shortH = 170 + Math.floor(hash01(tile * 5) * 50);
      // A back-row mid tower fills the gap behind the two (drawn first, deepest).
      const midX = tallLeft ? x + 250 : x + 90, midW = 100, midH = 200 + Math.floor(hash01(tile * 7) * 60);
      tower(midX, midW, midH, tile % 3 ? '#00e5ff' : '#ff40c8', 5);
      // Mid-tower board (~half the tiles) — smaller, deeper, partly hidden by front towers.
      if (hash01(tile * 11) > 0.5) {
        const mbw = 80, mbh = 40;
        adBillboard(midX + Math.round((midW - mbw) / 2), G() - midH + 22, mbw, mbh, '255,40,200', AD_ROBOT, tile * 3 + 2);
      }
      // Draw the billboard tower next (behind the foreground tower), then its board.
      tower(tallX, tallW, tallH, '#00e5ff', 3);
      const bw = 120, bh = 56;
      const bsx = tallX + Math.round((tallW - bw) / 2);
      adBillboard(bsx, G() - tallH + 25, bw, bh, '0,229,255', AD_ROBOT, tile * 3);
      // Foreground tower last → overlaps and partly hides the board behind it.
      tower(shortX, shortW, shortH, '#76ff03', 2);
      // Board on the foreground short tower (always on top, fully readable).
      const sbw = 96, sbh = 46;
      adBillboard(shortX + Math.round((shortW - sbw) / 2), G() - shortH + 22, sbw, sbh, '118,255,3', AD_ROBOT, tile * 3 + 1);
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
  // Distant planets of varied types + cratered moons. Slow parallax drift. Each tile's
  // planets are PROCEDURAL: per-tile hashes pick the body type, position, size, hue and
  // surface features. The tile is WIDER than the canvas (TILEW > C.W) so no more than one
  // tile is ever fully on screen → planets never repeat within a single view. Salted by
  // AD_LOAD_SEED so the whole sky reshuffles every page load.
  { speed: 0.08, draw(o) { const TILEW = 1700; tileMotif(o, TILEW, (x, tile) => {
      const GAS = ['#c97b5a', '#d9a86b', '#b07a9a', '#7a8fc9', '#6fae8f', '#c2b15a', '#cf6f6f', '#8a7ac2'];
      const ICE = ['#8fd3e0', '#a8c4e8', '#cfe8e0', '#9fd0c4', '#bcd4f0'];
      const ROCK = ['#cfd8dc', '#c2a89a', '#b0bec5', '#a89f8a', '#9aa0a8'];
      const SPOT = ['rgba(200,80,60,0.6)', 'rgba(90,140,210,0.5)', 'rgba(180,150,70,0.55)', 'rgba(150,90,170,0.5)'];
      const h = (k) => hash01(tile * 17.3 + k * 3.7 + AD_LOAD_SEED);
      const pick = (arr, k) => arr[Math.floor(h(k) * arr.length)];
      const count = 4 + Math.floor(h(0) * 3);                      // 4..6 bodies across the wide tile
      for (let i = 0; i < count; i++) {
        const b = i * 13 + 1;                                      // per-body hash offset
        const px = x + (i + 0.5) * (TILEW / count) + (h(b + 1) - 0.5) * 160;
        const py = 60 + h(b + 2) * 200;
        const type = Math.floor(h(b + 3) * 4);                     // 0 ring,1 banded,2 ice,3 moon
        const opt: any = {};
        if (type === 0) {                                          // ringed gas giant (+ maybe moons)
          const r = 24 + h(b + 4) * 22;
          opt.shade = true;
          opt.ring = { color: pick(['#e0b88a', '#c9b6d8', '#a8c0d8', '#d8c89a'], b + 5), tilt: -0.6 + h(b + 6) * 1.2, scale: 1.9 + h(b + 7) * 0.6 };
          opt.moon = { dist: r * (1.8 + h(b + 8)), r: 3 + h(b + 9) * 4, color: pick(ROCK, b + 10), speed: 0.4 + h(b + 11) * 1.2 };
          if (h(b + 12) > 0.6) opt.bands = [{ dy: -r * 0.3, h: 4, color: 'rgba(255,255,255,0.18)' }];
          celestialBody(px, py, r, pick(GAS, b + 13), opt);
        } else if (type === 1) {                                   // banded gas giant + storm spot
          const r = 22 + h(b + 4) * 22;
          opt.shade = true;
          opt.bands = [{ dy: -r * 0.3, h: 4 + h(b + 5) * 3, color: 'rgba(140,90,50,0.5)' }, { dy: r * 0.2, h: 3 + h(b + 6) * 3, color: 'rgba(160,110,70,0.45)' }];
          if (h(b + 7) > 0.35) opt.spot = { dx: r * 0.3, dy: h(b + 8) * r * 0.3, r: r * 0.2, color: pick(SPOT, b + 9) };
          if (h(b + 10) > 0.7) opt.ring = { color: '#d8c89a', tilt: -0.4 + h(b + 11) * 0.8 };
          celestialBody(px, py, r, pick(GAS, b + 12), opt);
        } else if (type === 2) {                                   // small ice planet + polar cap(s)
          const r = 11 + h(b + 4) * 12;
          opt.caps = [{ dx: 0, dy: -r * 0.6, r: r * 0.4, color: '#eaffff' }];
          if (h(b + 5) > 0.5) opt.caps.push({ dx: 0, dy: r * 0.6, r: r * 0.3, color: '#dffafa' });
          opt.shade = true;
          celestialBody(px, py, r, pick(ICE, b + 6), opt);
        } else {                                                   // cratered moon (varied craters)
          const r = 13 + h(b + 4) * 12;
          const caps: any[] = [];
          const craters = 2 + Math.floor(h(b + 5) * 3);
          for (let c = 0; c < craters; c++) {
            const ca = h(b + 6 + c) * Math.PI * 2, cd = h(b + 9 + c) * r * 0.6;
            caps.push({ dx: Math.cos(ca) * cd, dy: Math.sin(ca) * cd, r: r * (0.12 + h(b + 12 + c) * 0.16), color: '#9aa0a8' });
          }
          celestialBody(px, py, r, pick(ROCK, b + 2), { caps });
        }
      }
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

// A flat-topped mesa: a trapezoid butte of red rock with a couple of strata bands and
// a darker shaded right face, anchored to the ground. Pixel mode = blocky; round draws
// the same trapezoid (it's already chunky enough to read in both styles).
function pixelMesa(x, w, h, top, bodyC, shadeC) {
  const baseY = G(), topY = baseY - h, topW = w * top;          // top narrower than base
  const tx = x + (w - topW) / 2;
  ctx.fillStyle = bodyC;
  ctx.beginPath();
  ctx.moveTo(x, baseY); ctx.lineTo(tx, topY);
  ctx.lineTo(tx + topW, topY); ctx.lineTo(x + w, baseY);
  ctx.closePath(); ctx.fill();
  // shaded right third
  ctx.fillStyle = shadeC;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.62, baseY); ctx.lineTo(tx + topW * 0.62, topY);
  ctx.lineTo(tx + topW, topY); ctx.lineTo(x + w, baseY);
  ctx.closePath(); ctx.fill();
  // strata lines
  ctx.strokeStyle = 'rgba(80,38,20,0.3)'; ctx.lineWidth = 2;
  for (let i = 1; i <= 2; i++) {
    const yy = baseY - (h * i / 3);
    const inset = (w - topW) / 2 * (i / 3);
    ctx.beginPath(); ctx.moveTo(x + inset, yy); ctx.lineTo(x + w - inset, yy); ctx.stroke();
  }
  ctx.lineWidth = 1;
}

THEMES.horse.bgLayers = [
  // Big pale desert sun, low and hazy, with a soft heat-shimmer ring.
  { speed: 0, draw() {
      celestialBody(C.W - 200, 120, 52, '#ffe9b0', { rays: { color: '255,220,150', count: 16, speed: 0.06 } });
  } },
  // FAR mesa range: distant blue-grey buttes on the horizon, slow parallax.
  { speed: 0.06, draw(o) { tileMotif(o, 520, x => {
      pixelMesa(x, 260, 150, 0.5, '#9a6f63', '#83584d');
      pixelMesa(x + 300, 200, 110, 0.55, '#a87a6b', '#8f6557');
  }); } },
  // MID mesa range: warmer red-rock buttes, closer + taller.
  { speed: 0.12, draw(o) { tileMotif(o, 460, x => {
      pixelMesa(x + 40, 300, 210, 0.42, '#b5613a', '#8f4528');
      pixelMesa(x + 260, 220, 150, 0.5, '#c06a40', '#9a4f30');
  }); } },
  // FAR ranch fence in parallax: a line of weathered posts + two rails running across
  // the midground (between mesas and trail). Slower than the trail → sits back.
  { speed: 0.35, draw(o) { tileMotif(o, 56, x => {
      const fy = G() - 60;
      ctx.fillStyle = '#7a5532';
      ctx.fillRect(x, fy, 5, 44);                              // post
      ctx.fillStyle = 'rgba(122,85,50,0.85)';
      ctx.fillRect(x, fy + 10, 56, 4);                         // top rail
      ctx.fillRect(x, fy + 26, 56, 4);                         // bottom rail
  }); } },
  // Roadside billboards on weathered wooden posts — hay-fever / snake-oil ads. Spaced
  // far apart so one drifts by "from time to time", not a wall of signs.
  { speed: 0.5, draw(o) { tileMotif(o, 900, (x, tile) => {
      const bx = x + 120, bw = 150, bh = 80, by = G() - 200;
      // two posts
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(bx + 18, by + bh, 8, 200 - bh);
      ctx.fillRect(bx + bw - 26, by + bh, 8, 200 - bh);
      // board (reuse the neon-ad engine; warm wood frame colour). seed by tile for variety.
      adBillboard(bx, by, bw, bh, '120,72,40', AD_HORSE, tile, { noFlicker: true });
  }); } },
  // The TRAIL beneath us: a sandy road band hugging the ground with dashed centre ruts
  // + scattered pebbles that scroll past at near-foreground speed (sells the gallop).
  { speed: 0.95, draw(o) {
      const roadY = G() - 16;
      ctx.fillStyle = '#b07d44'; ctx.fillRect(0, roadY, C.W, 16);            // packed dirt
      ctx.fillStyle = '#9a6a39'; ctx.fillRect(0, roadY, C.W, 3);            // top edge shade
      tileMotif(o, 70, x => {
        ctx.fillStyle = 'rgba(90,58,28,0.6)'; ctx.fillRect(x, roadY + 8, 26, 3); // wheel rut dash
        ctx.fillStyle = 'rgba(60,40,20,0.5)'; ctx.fillRect(x + 40, roadY + 12, 4, 3); // pebble
      });
  } },
  // Tumbleweeds bouncing along the trail (shared wanderers engine) — spiky dry balls
  // that roll + rotate as they drift across. A couple at different heights/speeds.
  { speed: 0, draw() {
      const t = nowSec();
      wanderers(
        [
          { drift: 120, baseY: G() - 22, yAmp: 14, wy: 3.2, sy: 1.1, bank: 0, flapHz: 1 },
          { drift: 86,  baseY: G() - 30, yAmp: 20, wy: 2.4, sy: 0.8, bank: 0, flapHz: 1 },
          { drift: 150, baseY: G() - 18, yAmp: 10, wy: 4.0, sy: 1.4, bank: 0, flapHz: 1 },
        ],
        (i, _t, _flap) => {
          ctx.rotate((t * (2 + i)) % (Math.PI * 2));            // rolling spin
          const r = 9 + i * 2;
          // tangled dry brush: a disc of crossing twigs
          ctx.strokeStyle = 'rgba(150,116,66,0.9)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI;
            ctx.beginPath();
            ctx.moveTo(-Math.cos(a) * r, -Math.sin(a) * r);
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(120,90,50,0.8)';
          ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.stroke();
          ctx.lineWidth = 1;
        });
  } },
];

// (Re)load every theme's sprite for the active art style. Pixel art wants crisp
// scaling; round art wants smooth — flip the canvas hint to match.
function loadSprites() {
  for (const [key, theme] of Object.entries(THEMES)) {
    if (theme.hidden) continue; // WIP themes parked without sprite assets yet — skip to avoid 404s
    theme.img = makeImg(`assets/${gfxStyle}/${key}.svg`);
    // Themes flagged `anim` get a second frame (<key>-2.svg) shown briefly on flap.
    // Render-only: never read by physics/replay, so determinism is unaffected.
    // Themes without it just keep using frame 1 (automatic single-frame fallback).
    theme.img2 = theme.anim ? makeImg(`assets/${gfxStyle}/${key}-2.svg`) : null;
    // Optional data-driven effect overlay (theme.fx): gated to the styles in fx.styles.
    // Sprite effects (fx.sprite) load a transparent FX image; programmatic effects
    // (fx.kind, e.g. 'beam') need no asset. Render-only.
    theme.fxImg = (theme.fx && theme.fx.sprite && theme.fx.styles.includes(gfxStyle))
      ? makeImg(`assets/${gfxStyle}/fx/${theme.fx.sprite}.svg`) : null;
  }
  applyStyle();
}
loadSprites();

// Restore the last-picked avatar (QOL); fall back to penguin (mascot / default) if
// unset or unknown. Persisted in selectAvatar under 'lpb_avatar'.
const _savedAvatar = (() => { try { return localStorage.getItem('lpb_avatar'); } catch { return null; } })();
let currentTheme: any = (_savedAvatar && THEMES[_savedAvatar]) ? THEMES[_savedAvatar] : THEMES.penguin;

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
  // Monkey — DK callback: broad ape face (heavy brow, round eyes, wide muzzle),
  // mid panic-paddle underwater. (Previous draft read as a cat — swapped the
  // pointy "(\_/)" ears for a rounded gorilla head + brow ridge.)
  monkey: [
    '        \\  .------.',
    '         \\(  o  o )',
    '           |  ^^  |',
    '           \\ ==== /',
    '            d    b',
  ].join('\n'),
  // Squid — retired from the avatar roster, but the ascii lives on here (kept
  // alongside the unreferenced squid.svg assets in case it makes a comeback).
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
  dragon: [
    '        \\    ^^__',
    '         \\  /  o \\___',
    '          \\ \\____/    >~~ )',
    '             /\\  /\\',
    '            ~~  ~~',
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
  // Horse — derpy nonsense steed, mane streaming, mid-gallop.
  horse: [
    '        \\   ~^',
    '         \\ /o \\__',
    '           |    o\\',
    '           |__||__',
    '           ^^   ^^',
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
// Effect-layer cadence (render-only, theme.fx with trigger 'flapRandom'): count flaps,
// and every random everyMin..everyMax flaps fire the effect for fx.durationMs.
let flapsSinceFx = 0;
let nextFxAt = 1;        // (re)seeded from the active theme's fx when it first fires
let fxFiredAt = -1e9;    // timestamp the current effect started
// For projectile effects (kind 'bolt'): the spawn point captured at fire time, plus the
// resolved impact x (where it pops). The bird keeps moving, so these are frozen on fire.
let boltSpawnX = 0, boltSpawnY = 0, boltActive = false;
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

  // Ground / HUD bar — a pixel "surface" lip on top of a dirt/base bar. The lip palette
  // is per-theme (t.surface = [lip, highlight, seam]) so each avatar gets a fitting top
  // edge (grass, sand, snow, seafloor, metal grating, …); falls back to green grass.
  const px = 6; // pixel block size for ground detail
  ctx.fillStyle = t.ground;
  ctx.fillRect(0, C.GROUND, C.W, C.HUD);
  // A theme can opt OUT of a floor entirely (surface: null) — e.g. space, where the
  // scene has no ground; the bar just blends into the void + the dark HUD wash below.
  if (t.surface !== null) {
    const [lip, lipHi, seam] = t.surface || ['#5aa02c', '#7ec850', '#3a6e1a'];
    ctx.fillStyle = lip;
    ctx.fillRect(0, C.GROUND, C.W, px * 2);
    ctx.fillStyle = lipHi;
    for (let gx = 0; gx < C.W; gx += px * 2) ctx.fillRect(gx, C.GROUND, px, px); // dither highlights
    ctx.fillStyle = seam;
    ctx.fillRect(0, C.GROUND + px * 2, C.W, px); // shadow seam under the lip
  }
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
function adBillboard(sx, sy, w, h, col, slogans, seed, opt = {}) {
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
  // power-flicker: a brief, rare brownout, deterministic per seed. Neon-only — painted
  // wooden signs (opt.noFlicker) don't flicker.
  const flick = opt.noFlicker ? 1 : (Math.sin(t * 5 + seed * 9) > 0.985 ? 0.45 : 1);
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

// Horse theme: a dusty western frontier — roadside billboards hawking allergy/hay-fever
// remedies (the running gag), plus old-timey patent-medicine snake-oil. Wry, sneezy.
const AD_HORSE = [
  'HAY FEVER? GIDDY-UP', 'SNEEZE NO MORE', 'POLLEN BE GONE', 'ALLERGY-OFF TONIC',
  'DR. DUSTY ANTIHISTAMINE', 'STOP THE SNIFFLES', 'RAGWEED RELIEF 5¢', 'BREATHE EASY PARDNER',
  'NO MORE ITCHY EYES', 'POLLEN COUNT: HIGH', 'ACHOO ELIXIR', 'PRAIRIE NASAL SPRAY',
  'ASK YER DOCTOR', 'SIDE EFFECTS: NEIGHING', 'NON-DROWSY* (LIES)', 'HORSE-STRENGTH DOSE',
  'CACTUS-FREE FORMULA', 'TUMBLEWEED ALLERGY?', 'SADDLE UP, SNEEZE LESS', 'GENUINE SNAKE OIL',
  'CURES ALL AILMENTS', 'PATENTED 1887', 'DESERT BLOOM DEFENSE', 'GESUNDHEIT GULCH',
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

// The active theme's fx, but only if it applies to the current gfx style (and, for
// sprite effects, only once its image exists). Used by both the flap trigger and render.
function fxActiveForStyle(theme) {
  const fx = theme.fx;
  if (!fx || !fx.styles.includes(gfxStyle)) return null;
  if (fx.sprite && !theme.fxImg) return null;
  return fx;
}

// The x where a rightward projectile at height `y`, starting at `x0`, first meets a
// pipe's solid part (top column or bottom column, not the gap) — else the screen edge.
// Mirrors framedPipe geometry: a pipe occupies [p.x, p.x+PIPE_W] and is solid outside
// the gap (y < p.topH or y > p.topH+p.gap). Render-only; reads sim state, never mutates.
function beamEndX(x0, y) {
  let end = C.W;
  for (const p of gs.pipes) {
    const left = p.x;
    if (left + C.PIPE_W <= x0 || left >= end) continue;     // behind us or beyond a closer hit
    const inGap = y > p.topH && y < p.topH + p.gap;
    if (inGap) continue;                                    // bolt passes through the gap
    if (left >= x0) end = Math.min(end, left);              // stops at the pipe's near face
  }
  return end;
}

function drawPlayer() {
  // Render LARGER than the hitbox so the sprite looks meaty. The collision radius
  // (PLAYER_SIZE/2 - 4) is unchanged and stays mirrored in sim.ts — this is a
  // draw-only scale, so replay validation is unaffected. The pixel-art SVGs also
  // carry transparent padding, so the visible body roughly matches the hitbox.
  const s = C.PLAYER_SIZE * C.SPRITE_SCALE;
  // 2-frame avatars show frame 2 (the "push") for a beat after each flap; others
  // (img2 == null) always render frame 1. Render-only, so replay is unaffected.
  const now = performance.now();
  const inFlap = (now - lastFlapAt) < FLAP_FRAME_MS;
  const sprite = (inFlap && currentTheme.img2) ? currentTheme.img2 : currentTheme.img;
  const fxMane = fxActiveForStyle(currentTheme);
  ctx.save();
  ctx.translate(C.PLAYER_X, gs.player.y);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, gs.player.vy * 0.05)));
  // Mane + tail streamers (horse): rippling hair drawn BEHIND the body so it trails the
  // neck crest and rump. Continuous sine flutter via nowSec → always blowing, not just
  // on flap. Render-only, no sim touch.
  if (fxMane && fxMane.kind === 'mane') drawMane(s, fxMane.color);
  ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
  // Sprite effect (theme.fx with fx.sprite): a transparent FX image drawn relative to the
  // avatar for fx.durationMs after it fired. Inside the same translate/rotate so it tracks
  // + tilts with the body; drawn past the sprite box so it isn't clipped. Render-only.
  const fx = fxActiveForStyle(currentTheme);
  const fxOn = fx && (now - fxFiredAt) < fx.durationMs;
  if (fx && fx.sprite && fxOn) {
    const fw = s * fx.scale, fh = fw * 0.5;          // fire.svg viewBox aspect = 0.5
    ctx.drawImage(currentTheme.fxImg, s * fx.anchorX, s * fx.anchorY - fh / 2, fw, fh);
  }
  ctx.restore();

  // Bolt effect (theme.fx kind 'bolt'): a projectile that LEFT the pincer at fire time
  // and travels right at fx.speed until it reaches its impact point (next pipe face or
  // screen edge), then pops. Drawn in SCREEN space since it crosses the canvas. The
  // spawn point was frozen in flap(); we recompute the impact each frame against live
  // pipe positions (they scroll left, so the bolt closes on them faster). Render-only.
  if (fx && fx.kind === 'bolt' && boltActive) {
    const travelled = (now - fxFiredAt) / 1000 * fx.speed;
    const headX = boltSpawnX + travelled;
    const impactX = beamEndX(boltSpawnX, boltSpawnY);  // where a clear path ends
    if (headX >= impactX) {
      // reached the wall/edge → pop and retire
      drawBoltImpact(impactX, boltSpawnY, fx);
      boltActive = false;
    } else {
      drawBolt(headX, boltSpawnY, fx);
    }
  }
}

// Flowing mane + tail for the horse. Several hair strands stream BACKWARD (leftward,
// the sprite faces right) from the neck crest and the rump, each a wavy line whose tail
// ripples via a phase-shifted sine on nowSec. Lengths/phases differ per strand so it
// reads as windblown hair, not a comb. Called inside drawPlayer's translate/rotate frame
// (origin = sprite centre). Render-only, deterministic in time → never feeds the sim.
function drawMane(s, color) {
  const t = nowSec();
  ctx.save();
  ctx.lineCap = 'round';
  // One wavy strand rooted at (ox,oy), trailing back (left). `droop` biases the tip
  // vertically (− = lifts up, + = sags down) so the strand follows a base arc; the
  // ripple rides on top via a per-strand `freq`/`ph`/`dir` so no two move in lockstep.
  const strand = (ox, oy, len, droop, amp, freq, ph, dir, w, alpha) => {
    ctx.strokeStyle = withAlpha(color, alpha); ctx.lineWidth = w;
    ctx.beginPath();
    const x0 = ox * s, y0 = oy * s, L = len * s, segs = 7;
    ctx.moveTo(x0, y0);
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const x = x0 - L * f;                                       // trails backward
      const arc = droop * s * f * f;                             // base sag/lift (eases out)
      const wave = dir * Math.sin(t * freq + ph + f * 5) * amp * s * f;
      ctx.lineTo(x, y0 + arc + wave);
    }
    ctx.stroke();
  };
  // MANE off the neck crest: short, lifts UP-and-back, fast nervous flutter.
  strand(0.30, -0.30, 0.34, -0.14, 0.07, 9.0, 0.0,  1, Math.max(2, s * 0.06), 0.95);
  strand(0.25, -0.26, 0.40, -0.10, 0.09, 8.2, 1.6, -1, Math.max(2, s * 0.05), 0.85);
  strand(0.20, -0.21, 0.36, -0.05, 0.08, 7.4, 3.0,  1, Math.max(1, s * 0.045), 0.7);
  // TAIL off the rump: longer, sags DOWN-and-back, slower heavier sway (opposite phase).
  strand(-0.32, -0.02, 0.50, 0.16, 0.10, 4.6, 2.4, -1, Math.max(2, s * 0.06), 0.95);
  strand(-0.33, 0.04, 0.46, 0.22, 0.13, 5.2, 0.8,  1, Math.max(1, s * 0.05), 0.8);
  ctx.restore();
  ctx.lineWidth = 1;
}

// A small glowing energy bolt with a short motion-trail, travelling right.
function drawBolt(x, y, fx) {
  const r = fx.radius, tail = r * 3.2;
  ctx.save();
  ctx.lineCap = 'round';
  // trailing streak
  ctx.strokeStyle = fx.color; ctx.globalAlpha = 0.4; ctx.lineWidth = r * 1.2;
  ctx.beginPath(); ctx.moveTo(x - tail, y); ctx.lineTo(x, y); ctx.stroke();
  // glow
  ctx.globalAlpha = 0.35; ctx.fillStyle = fx.color;
  ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
  // core + hot white centre
  ctx.globalAlpha = 1; ctx.fillStyle = fx.color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// A quick burst where the bolt collides.
function drawBoltImpact(x, y, fx) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = fx.color; ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
  const spokes = 6, len = fx.radius * 2.2;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
  }
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(0, 0, fx.radius * 0.7, 0, Math.PI * 2); ctx.fill();
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
  (document.getElementById('gfx-toggle') as HTMLElement).style.display = 'none';
  gameActive = true;
  boltActive = false;            // clear any in-flight projectile from a prior run
  flapsSinceFx = 0;
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
  (document.getElementById('gfx-toggle') as HTMLElement).style.display = '';
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
  // Effect cadence: for a theme.fx using trigger 'flapRandom', every random
  // everyMin..everyMax flaps mark this flap as the effect start so the renderer overlays
  // the FX sprite for fx.durationMs. Render-only, never feeds replay.
  const fx = fxActiveForStyle(currentTheme);
  if (fx && fx.trigger === 'flapRandom' && ++flapsSinceFx >= nextFxAt) {
    flapsSinceFx = 0;
    nextFxAt = fx.everyMin + Math.floor(Math.random() * (fx.everyMax - fx.everyMin + 1));
    fxFiredAt = lastFlapAt;
    // Projectile: freeze the muzzle point at fire time so the bolt flies from where the
    // pincer was, independent of the bird's continued motion.
    if (fx.kind === 'bolt' && gameActive) {
      const s = C.PLAYER_SIZE * C.SPRITE_SCALE;
      boltSpawnX = C.PLAYER_X + s * fx.anchorX;
      boltSpawnY = gs.player.y + s * fx.anchorY;
      boltActive = true;
    }
  }
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

// QOL: remember the last player name typed, so returning players land on a
// pre-filled input instead of retyping it every visit (mirrors lpb_avatar/lpb_gfx).
try {
  const lastPlayer = localStorage.getItem('lpb_player');
  if (lastPlayer) nameInput.value = lastPlayer;
} catch {}

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
  if (userSelect.value) {
    nameInput.value = userSelect.value;
    try { localStorage.setItem('lpb_player', userSelect.value); } catch {}
  }
});

document.getElementById('btn-play').addEventListener('click', async () => {
  AudioFX.unlock(); // first user gesture — enable audio
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  // Dismiss the dev disclaimer banner and reclaim the space it occupied.
  devDisclaimer.style.display = 'none';
  fitToViewport();
  try { localStorage.setItem('lpb_player', name); } catch {}   // QOL: remember last pick
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

// Rank 1-3 get an IAM "privilege tier" badge instead of a plain rank number —
// the leaderboard's running gag on the game's access-control satire.
const RANK_BADGES = [
  { cls: 'tier-admin',    label: 'Admin' },
  { cls: 'tier-power',    label: 'PowerUser' },
  { cls: 'tier-readonly', label: 'ReadOnly' },
];

// Returns the avatar key to show for a leaderboard row, or null if none should
// be shown. DB avatar always wins; for the current player's own row with no DB
// avatar, fall back to their localStorage pick; everyone else gets nothing.
function resolveAvatarKey(row): string | null {
  if (row.avatar && (AVATAR_KEYS as readonly string[]).includes(row.avatar)) return row.avatar;
  try {
    const myName = currentPlayer || localStorage.getItem('lpb_player');
    if (myName && row.name === myName) {
      const saved = localStorage.getItem('lpb_avatar');
      if (saved && (AVATAR_KEYS as readonly string[]).includes(saved)) return saved;
    }
  } catch {}
  return null;
}

// Build one leaderboard row. Built with DOM methods (not innerHTML) because
// `row.name` is untrusted player input.
function renderScoreRow(row, i) {
  const rank = i + 1;
  const avatarKey = resolveAvatarKey(row);
  const div = document.createElement('div');
  div.className = 'score-row' + (row.name === currentPlayer ? ' current-player' : '');

  if (avatarKey) {
    const theme = THEMES[avatarKey] || THEMES.penguin;
    const img = document.createElement('img');
    img.className = 'score-avatar';
    img.src = theme.img.src;
    img.alt = theme.label;
    div.appendChild(img);
  } else {
    div.appendChild(document.createElement('span')); // empty placeholder keeps grid alignment
  }

  const rankEl = document.createElement('span');
  const badge = RANK_BADGES[rank - 1];
  if (badge) {
    rankEl.className = `score-badge ${badge.cls}`;
    rankEl.textContent = badge.label;
  } else {
    rankEl.className = 'score-rank';
    rankEl.textContent = `#${rank}`;
  }
  div.appendChild(rankEl);

  const nameEl = document.createElement('span');
  nameEl.className = 'score-name';
  nameEl.textContent = row.name;
  div.appendChild(nameEl);

  const valEl = document.createElement('span');
  valEl.className = 'score-value';
  valEl.textContent = String(row.score);
  div.appendChild(valEl);

  return div;
}

document.getElementById('btn-scores').addEventListener('click', async () => {
  const scores = await loadScores(); // [{ name, score, avatar }], pre-sorted desc
  const list = document.getElementById('scores-list');
  list.innerHTML = '';
  list.classList.toggle('round-gfx', gfxStyle === 'round');
  if (!scores.length) {
    list.innerHTML = '<p class="scores-empty">No scores yet.</p>';
  } else {
    scores.forEach((row, i) => list.appendChild(renderScoreRow(row, i)));
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
  // Display order: penguin (mascot) leads, then the showcase themes robot/airplane/
  // dragon, then everything else in THEMES order, with bird + bee parked at the end
  // (the least-improved, blander options for now).
  const TAIL = ['bird'];
  const LEAD = ['penguin', 'robot', 'horse', 'airplane', 'dragon', 'bee'];
  // `hidden` themes (WIP, no sprite assets yet) never appear in the picker.
  const mid = Object.keys(THEMES).filter(k => !LEAD.includes(k) && !TAIL.includes(k) && !THEMES[k].hidden);
  const ordered = [...LEAD, ...mid, ...TAIL];
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
  try { localStorage.setItem('lpb_avatar', key); } catch {}   // QOL: remember last pick
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
