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
  PIPE_INTERVAL_MAX: 2800,  // ms between pipes at start (sparse)
  PIPE_INTERVAL_MIN: 900,   // ms between pipes at max difficulty (dense)
  PIPE_INTERVAL_STEP: 200,  // interval shrinks by this per speed level
  SPEED_UP_INTERVAL: 5000,  // ms between each speed increase
  SPEED_UP_AMOUNT: 0.5,     // px/frame added each interval
  COUNTDOWN_SEC: 3,         // seconds to count down before play starts
  PLAYER_X: 120,
  PLAYER_SIZE: 40,
  GROUND: 0,                // y of ground = H - HUD (computed below)
  CLOUD_COUNT: 6,
};
C.GROUND = C.H - C.HUD;

// ─── CANVAS SETUP ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.width  = C.W;
canvas.height = C.H;

// Size overlay to match canvas
const overlay = document.getElementById('overlay');
overlay.style.width  = C.W + 'px';
overlay.style.height = C.H + 'px';

// ─── ASSETS & THEMES ──────────────────────────────────────────────────────────
const sndJump     = new Audio('assets/jump.wav');
const sndGameOver = new Audio('assets/game_over.wav');

function makeImg(src) { const i = new Image(); i.src = src; return i; }

const THEMES = {
  ghost: {
    label: 'Ghost', img: makeImg('assets/ghosty.png'),
    sky: '#7ec8e3', ground: '#2b2b3b',
    cloudFill: 'rgba(255,255,255,0.82)',
    drawPipe(x, topH, gap) {
      const capH = 24, capW = C.PIPE_W + 12, capX = x - 6;
      ctx.fillStyle = '#3a7d1e';
      ctx.fillRect(x, 0, C.PIPE_W, topH - capH);
      ctx.fillRect(capX, topH - capH, capW, capH);
      const botY = topH + gap;
      ctx.fillRect(capX, botY, capW, capH);
      ctx.fillRect(x, botY + capH, C.PIPE_W, C.GROUND - botY - capH);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + 6, 0, 10, topH - capH);
      ctx.fillRect(x + 6, botY + capH, 10, C.GROUND - botY - capH);
    },
  },
  rocket: {
    label: 'Rocket', img: makeImg('assets/rocket.png'),
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
    label: 'Bee', img: makeImg('assets/bee.png'),
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
    label: 'Wizard', img: makeImg('assets/wizard.png'),
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
  robot: {
    label: 'Robot', img: makeImg('assets/robot.png'),
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

let currentTheme = THEMES.ghost;

// ─── HIGH SCORES (localStorage) ───────────────────────────────────────────────
function loadScores() {
  try { return JSON.parse(localStorage.getItem('flappyKiroScores')) || {}; }
  catch { return {}; }
}
function saveScore(name, score) {
  const scores = loadScores();
  if (!scores[name] || score > scores[name]) scores[name] = score;
  localStorage.setItem('flappyKiroScores', JSON.stringify(scores));
}
function bestForPlayer(name) { return loadScores()[name] || 0; }

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

// ─── GAME STATE ───────────────────────────────────────────────────────────────
let player, pipes, score, lastPipeTime, animId, currentPlayer;
let pipeSpeed, lastSpeedUp, countdown, countdownStart;

function initGame(playerName) {
  currentPlayer = playerName;
  player = { y: C.H / 2, vy: 0 };
  pipes  = [];
  score  = 0;
  pipeSpeed      = C.PIPE_SPEED;
  countdown      = C.COUNTDOWN_SEC;
  countdownStart = performance.now();
  lastSpeedUp    = null; // starts after countdown ends
  lastPipeTime   = null;
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

function spawnPipe(now) {
  const gap    = currentGap();
  const minTop = 60;
  const maxTop = C.GROUND - gap - 60;
  const topH   = minTop + Math.random() * (maxTop - minTop);
  pipes.push({ x: C.W, topH, gap, scored: false });
  lastPipeTime = now;
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
    // Sketch lines (day themes)
    if (t === THEMES.ghost) {
      ctx.strokeStyle = 'rgba(80,130,160,0.18)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 30; i++) {
        const x = (i * 83) % C.W;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 20, C.GROUND); ctx.stroke();
      }
    }
    ctx.fillStyle = t.cloudFill;
    for (const cl of clouds) {
      roundRect(ctx, cl.x, cl.y, cl.w, cl.h, 20);
      ctx.fill();
    }
  }

  // Ground / HUD bar
  ctx.fillStyle = t.ground;
  ctx.fillRect(0, C.GROUND, C.W, C.HUD);
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
  ctx.font = `bold ${C.H * 0.22}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(n > 0 ? n : 'GO!', C.W / 2, C.GROUND / 2);
  ctx.textBaseline = 'alphabetic';
}

function drawPlayer() {
  const s = C.PLAYER_SIZE;
  ctx.save();
  ctx.translate(C.PLAYER_X, player.y);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, player.vy * 0.05)));
  ctx.drawImage(currentTheme.img, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function drawHUD() {
  const best = bestForPlayer(currentPlayer);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const sl = speedLevel() + 1;
  ctx.fillText(
    `Score: ${score}  |  High: ${Math.max(score, best)}  |  ${currentPlayer}  |  Spd ${sl}`,
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
function loop(now) {
  drawBackground();
  for (const p of pipes) drawPipe(p.x, p.topH, p.gap);
  drawPlayer();
  drawHUD();

  // ── Countdown phase: freeze physics, show number ──
  const elapsed = now - countdownStart;
  const remaining = Math.ceil(C.COUNTDOWN_SEC - elapsed / 1000);

  if (remaining > 0) {
    drawCountdown(remaining);
    animId = requestAnimationFrame(loop);
    return;
  }

  // One-frame "GO!" flash (remaining === 0, elapsed just crossed the threshold)
  if (elapsed < (C.COUNTDOWN_SEC + 0.35) * 1000) {
    drawCountdown(0);
  }

  // ── Active play ──
  // Initialize speed timer on first active frame
  if (lastSpeedUp === null) { lastSpeedUp = now; lastPipeTime = now; }

  // Speed ramp
  if (now - lastSpeedUp > C.SPEED_UP_INTERVAL) {
    pipeSpeed += C.SPEED_UP_AMOUNT;
    lastSpeedUp = now;
  }

  // Spawn pipes
  if (now - lastPipeTime > currentInterval()) spawnPipe(now);

  // Update pipes
  for (const p of pipes) {
    p.x -= pipeSpeed;
    if (!p.scored && p.x + C.PIPE_W < C.PLAYER_X) { score++; p.scored = true; }
  }
  pipes = pipes.filter(p => p.x + C.PIPE_W > 0);

  // Update player physics
  player.vy += C.GRAVITY;
  player.y  += player.vy;

  if (collides()) { endGame(); return; }
  animId = requestAnimationFrame(loop);
}

function startGame(playerName) {
  showScreen(null);
  initGame(playerName);
  animId = requestAnimationFrame(loop);
}

function endGame() {
  cancelAnimationFrame(animId);
  sndGameOver.currentTime = 0;
  sndGameOver.play().catch(() => {});

  const prev  = bestForPlayer(currentPlayer);
  const isNew = score > prev;

  // Must complete CAPTCHA + fake audit log before seeing score
  Clave.startScoreSubmit(currentPlayer, score, () => {
    saveScore(currentPlayer, score);
    document.getElementById('gameover-msg').textContent =
      isNew
        ? `New high score: ${score}! 🎉`
        : `Score: ${score} — Best: ${Math.max(score, prev)}`;
    overlay.classList.remove('hidden');
    showScreen('gameover');
  });
  overlay.classList.remove('hidden'); // keep visible for CAPTCHA + submit screens
}

// ─── INPUT ────────────────────────────────────────────────────────────────────
function flap() {
  player.vy = C.FLAP;
  sndJump.currentTime = 0;
  sndJump.play().catch(() => {});
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

function populateUserSelect() {
  const names = Object.keys(loadScores()).sort();
  // remove all options except the placeholder
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

document.getElementById('btn-play').addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  showScreen(null);                          // hide menu screens
  overlay.classList.remove('hidden');        // keep overlay visible for Clave
  Clave.startLogin(name, () => startGame(name));
});

nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-play').click();
});

document.getElementById('btn-scores').addEventListener('click', () => {
  const scores = loadScores();
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

document.getElementById('btn-retry').addEventListener('click', () => startGame(currentPlayer));

document.getElementById('btn-menu').addEventListener('click', () => { populateUserSelect(); showScreen('menu'); });

// ─── INIT ─────────────────────────────────────────────────────────────────────
// Build avatar picker
const avatarPicker = document.getElementById('avatar-picker');
Object.entries(THEMES).forEach(([key, theme]) => {
  const div = document.createElement('div');
  div.className = 'avatar-opt' + (key === 'ghost' ? ' selected' : '');
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

// Draw a static background while on menu
drawBackground();
populateUserSelect();
showScreen('menu');
