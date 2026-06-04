// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const C = {
  W: 910, H: 730,           // canvas dimensions
  HUD: 48,                  // bottom bar height
  GRAVITY: 0.5,
  FLAP: -9,
  PIPE_W: 64,
  PIPE_GAP_MIN: 140,        // smallest vertical gap between pipes
  PIPE_GAP_MAX: 200,        // largest vertical gap between pipes
  PIPE_GAP_STEP: 20,        // gap is chosen in multiples of this value
  PIPE_SPEED: 3,            // initial pipe scroll speed (px/frame)
  PIPE_INTERVAL: 1000,      // ms between new pipe pairs
  SPEED_UP_INTERVAL: 5000, // ms between each speed increase
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

// ─── ASSETS ───────────────────────────────────────────────────────────────────
const ghostImg = new Image(); ghostImg.src = 'assets/ghosty.png';
const sndJump     = new Audio('assets/jump.wav');
const sndGameOver = new Audio('assets/game_over.wav');

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

function currentGap() {
  // Start at max, shrink by one STEP per speed level, clamp to min
  const speedLevel = Math.round((pipeSpeed - C.PIPE_SPEED) / C.SPEED_UP_AMOUNT);
  return Math.max(C.PIPE_GAP_MIN, C.PIPE_GAP_MAX - speedLevel * C.PIPE_GAP_STEP);
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
  // Sky
  ctx.fillStyle = '#7ec8e3';
  ctx.fillRect(0, 0, C.W, C.GROUND);

  // Sketch scribbles (static-ish lines for texture)
  ctx.strokeStyle = 'rgba(80,130,160,0.18)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 30; i++) {
    const x = (i * 83) % C.W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 20, C.GROUND); ctx.stroke();
  }

  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  for (const cl of clouds) {
    roundRect(ctx, cl.x, cl.y, cl.w, cl.h, 20);
    ctx.fill();
  }

  // Ground / HUD bar
  ctx.fillStyle = '#2b2b3b';
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

function drawPipe(x, topH, gap) {
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
}

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
  const px = C.PLAYER_X - s / 2;
  const py = player.y - s / 2;
  // Tilt sprite based on velocity
  ctx.save();
  ctx.translate(C.PLAYER_X, player.y);
  ctx.rotate(Math.max(-0.4, Math.min(0.4, player.vy * 0.05)));
  ctx.drawImage(ghostImg, -s / 2, -s / 2, s, s);
  ctx.restore();
}

function drawHUD() {
  const best = bestForPlayer(currentPlayer);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const speedLevel = Math.round((pipeSpeed - C.PIPE_SPEED) / C.SPEED_UP_AMOUNT) + 1;
  ctx.fillText(
    `Score: ${score}  |  High: ${Math.max(score, best)}  |  ${currentPlayer}  |  Spd ${speedLevel}`,
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
  if (now - lastPipeTime > C.PIPE_INTERVAL) spawnPipe(now);

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

  const prev = bestForPlayer(currentPlayer);
  saveScore(currentPlayer, score);
  const isNew = score > prev;

  document.getElementById('gameover-msg').textContent =
    isNew
      ? `New high score: ${score}! 🎉`
      : `Score: ${score} — Best: ${Math.max(score, prev)}`;

  showScreen('gameover');
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
  startGame(name);
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
// Draw a static background while on menu
drawBackground();
populateUserSelect();
showScreen('menu');
