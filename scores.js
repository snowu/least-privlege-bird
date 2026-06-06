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

async function sbSubmitScore(name, token, score) {
  if (!_sb) return;
  // calls the DB function which verifies the token hash server-side
  await _sbFetch('/rpc/submit_score', {
    method: 'POST',
    body: JSON.stringify({ p_name: name, p_token: token, p_score: score }),
  });
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

    document.getElementById('btn-show-recover').onclick = e => {
      e.preventDefault();
      modal.classList.add('hidden');
      showRecoverModal(name).then(resolve);
    };
  });
}

function showRecoverModal(name) {
  return new Promise(resolve => {
    const modal = document.getElementById('recover-modal');
    const input = document.getElementById('recover-token-input');
    const errEl = document.getElementById('recover-error');
    input.value = '';
    errEl.textContent = '';
    modal.classList.remove('hidden');

    document.getElementById('btn-recover-confirm').onclick = () => {
      const tok = input.value.trim();
      if (!tok) { errEl.textContent = 'Please paste your token.'; return; }
      setLocalToken(name, tok);
      modal.classList.add('hidden');
      resolve(tok);
    };

    document.getElementById('btn-recover-cancel').onclick = () => {
      modal.classList.add('hidden');
      // generate fresh token as fallback
      const tok = generateToken();
      showTokenModal(name, tok).then(resolve);
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
async function saveScore(name, score) {
  if (!_sb) return; // _sb already encodes LIVE_DB — no separate localhost check needed
  const tok = getLocalToken(name);
  if (!tok) return;
  try { await sbSubmitScore(name, tok, score); }
  catch (e) { console.warn('Supabase submit failed', e); }
}
