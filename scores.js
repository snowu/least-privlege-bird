// ── SCORES + TOKEN SYSTEM ─────────────────────────────────────────────────────
// Supabase config — fill in when ready, stubs work offline via localStorage
const SUPABASE_URL = 'https://yozllinwvvprtguinflm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FqTiUUOrvfWv6zmwobkcgg_9_d9iyvU';

const LS_KEY = 'lpb_players'; // { [name]: token }

// ── LOCAL STORAGE ─────────────────────────────────────────────────────────────
function _loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function _saveLocal(data) { localStorage.setItem(LS_KEY, JSON.stringify(data)); }

function getLocalToken(name)      { const v = _loadLocal()[name]; return v?.token || v || null; }
function setLocalToken(name, tok) { const d = _loadLocal(); d[name] = tok; _saveLocal(d); } // always a string

// Strip-on-read migration: normalize legacy { token, score } entries to bare token
// strings, dropping the (untrustworthy) cached score. Runs once at load.
(function normalizeLocal() {
  const d = _loadLocal();
  let changed = false;
  for (const k of Object.keys(d)) {
    if (d[k] && typeof d[k] === 'object') { d[k] = d[k].token || ''; changed = true; }
  }
  if (changed) _saveLocal(d);
})();

// ── TOKEN GENERATION ──────────────────────────────────────────────────────────
function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── SUPABASE CALLS ────────────────────────────────────────────────────────────
// LIVE_DB (set in index.html) decides whether we touch Supabase — always true in prod,
// manually toggleable locally via localStorage.lpb_live. Decoupled from DEV_MODE.
const _sb = SUPABASE_URL && SUPABASE_KEY && (typeof LIVE_DB !== 'undefined' ? LIVE_DB : false);

async function _sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res;
}

async function sbLoadScores() {
  if (!_sb) return null;
  // score=gt.0 hides registered-but-never-played accounts (created at score 0).
  const res = await _sbFetch('/scores?select=name,score&score=gt.0&order=score.desc');
  return res.json(); // [{ name, score }, ...]
}

// Authoritative best score for a player — read from Supabase, never localStorage.
// Returns the score, or null when Supabase is unavailable / the fetch fails.
async function fetchBest(name) {
  if (!_sb) return null;
  try {
    const res = await _sbFetch(`/scores?name=eq.${encodeURIComponent(name)}&select=score`);
    const rows = await res.json();
    return rows.length ? rows[0].score : null;
  } catch (e) {
    console.warn('Supabase fetchBest failed', e);
    return null;
  }
}

// Token-only recovery: given a raw token, find which account it belongs to.
// Goes through the recover-account edge function (service role) rather than a direct
// SELECT — token_hash is NOT exposed to anon, so hashes never leave the server.
// Returns the name, or null if the token matches no account / DB is off.
async function resolveToken(token) {
  if (!_sb) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/recover-account`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    const { name } = await res.json();
    return name || null;
  } catch (e) {
    console.warn('Supabase resolveToken failed', e);
    return null;
  }
}

// ── FORTUNE ───────────────────────────────────────────────────────────────────
// Fetch one random real Unix fortune cookie from the `fortune` edge function — the
// message source for the avatar speech bubble (game.js wraps it cowsay-style with
// the selected avatar's ASCII). Falls back to a small local set of real fortunes
// when Supabase is off (DEV_MODE / offline) so the bubble always has something.
const _FORTUNE_FALLBACK = [
  "Do not overtax your powers.",
  "Caution: breathing may be hazardous to your health.",
  "Domestic happiness and faithful friends.",
  "Don't look now, but the man in the moon is laughing at you.",
  "Excellent day for putting Slinkies on an escalator.",
  "Excellent time to become a missing person.",
  "Exercise caution in your daily affairs.",
  "Live in a world of your own, but always welcome visitors.",
  "Someone is speaking well of you.",
  "Tuesday is the Wednesday of the rest of your life.",
  "Write yourself a threatening letter and pen a defiant reply.",
  "You are capable of planning your future.",
  "You have taken yourself too seriously.",
  "You single-handedly fought your way into this hopeless mess.",
  "You will always have good luck in your personal affairs.",
  "You will be awarded a medal for disregarding safety in saving someone.",
  "You will step on the night soil of many countries.",
  "You will visit the Dung Pits of Glive soon.",
  "Your aims are high, and you are capable of much.",
  "Your lucky number has been disconnected.",
  "Your object is to save the world, while still leading a pleasant life.",
  "The early bird gets the worm, but the second mouse gets the cheese.",
  "Today is the tomorrow you worried about yesterday.",
  "Don't kiss an elephant on the lips today.",
  "A conclusion is the place where you got tired of thinking.",
];

async function fetchFortune() {
  if (_sb) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/fortune`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      });
      if (res.ok) {
        const { tip } = await res.json();
        if (tip) return tip;
      }
    } catch (e) {
      console.warn('Supabase fetchFortune failed, using local fortune', e);
    }
  }
  return _FORTUNE_FALLBACK[Math.floor(Math.random() * _FORTUNE_FALLBACK.length)];
}

// Submit a run to the edge function, which replays { seed, flapTicks } through the
// real physics and accepts the score only if it recomputes to the claimed value.
// `replay` is { seed, flapTicks }; for registration (score 0) an empty run is used.
async function sbSubmitScore(name, token, score, replay) {
  if (!_sb) return;
  const { seed, flapTicks } = replay || { seed: 0, flapTicks: [] };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, token, seed, flapTicks, claimedScore: score }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── TOKEN MODAL ───────────────────────────────────────────────────────────────
function showTokenModal(name, token) {
  return new Promise(resolve => {
    const modal = document.getElementById('token-modal');
    document.getElementById('token-modal-name').textContent = name;
    document.getElementById('token-display').value = token;
    modal.classList.remove('hidden');

    document.getElementById('btn-copy-token').onclick = () => {
      navigator.clipboard.writeText(token).catch(() => {});
      document.getElementById('btn-copy-token').textContent = 'Copied!';
    };

    document.getElementById('btn-token-done').onclick = () => {
      modal.classList.add('hidden');
      resolve(token);
    };
  });
}

// Token-only recovery: the user pastes a token, we resolve it to its account
// name server-side and rebind this browser to it. No name entry — the token IS
// the identity. Resolves to the recovered name, or null if cancelled.
function showRecoverModal() {
  return new Promise(resolve => {
    const modal = document.getElementById('recover-modal');
    const input = document.getElementById('recover-token-input');
    const errEl = document.getElementById('recover-error');
    const confirmBtn = document.getElementById('btn-recover-confirm');
    input.value = '';
    errEl.textContent = '';
    modal.classList.remove('hidden');

    confirmBtn.onclick = async () => {
      const tok = input.value.trim();
      if (!tok) { errEl.textContent = 'Please paste your token.'; return; }
      confirmBtn.disabled = true;
      errEl.textContent = 'Checking…';
      const name = await resolveToken(tok);
      confirmBtn.disabled = false;
      if (!name) { errEl.textContent = 'That token matches no account.'; return; }
      setLocalToken(name, tok);
      modal.classList.add('hidden');
      resolve(name);
    };

    document.getElementById('btn-recover-cancel').onclick = () => {
      modal.classList.add('hidden');
      resolve(null);
    };
  });
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

// Call before starting a game. Returns the player's token (existing or new).
// No-op when the DB is off (LIVE_DB) — a token only matters for writing scores,
// and we don't want the modal interrupting pure gameplay testing.
async function ensurePlayerToken(name) {
  if (!_sb) return null;
  const existing = getLocalToken(name);
  if (existing) return existing;
  // New player — generate, persist locally, register the row in the DB now (score 0)
  // so the account is real the moment the token exists, not only after first play.
  const tok = generateToken();
  setLocalToken(name, tok);
  try { await sbSubmitScore(name, tok, 0); }
  catch (e) { console.warn('Supabase register failed', e); }
  await showTokenModal(name, tok);
  return tok;
}

// Load all scores: Supabase if configured, else localStorage fallback
async function loadScores() {
  if (_sb) {
    try {
      const rows = await sbLoadScores();
      // return as { name: score } map for compatibility
      return Object.fromEntries(rows.map(r => [r.name, r.score]));
    } catch (e) { console.warn('Supabase load failed, using local', e); }
  }
  // No Supabase → no authoritative scores. localStorage holds tokens only.
  return {};
}

// Save score: Supabase only. Scores are NOT cached locally — a client-side
// number is trivially editable, so the leaderboard must stay server-authoritative.
// `replay` is { seed, flapTicks } from the run — the edge function replays it to
// verify the score is genuine before writing.
async function saveScore(name, score, replay) {
  if (!_sb) return; // _sb already encodes LIVE_DB — no separate localhost check needed
  const tok = getLocalToken(name);
  if (!tok) return;
  try { await sbSubmitScore(name, tok, score, replay); }
  catch (e) { console.warn('Supabase submit failed', e); }
}
