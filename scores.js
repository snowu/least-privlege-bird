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

function getLocalToken(name)      { return _loadLocal()[name] || null; }
function setLocalToken(name, tok) { const d = _loadLocal(); d[name] = tok; _saveLocal(d); }

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
const _sb = SUPABASE_URL && SUPABASE_KEY && location.hostname !== 'localhost';

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
  const res = await _sbFetch('/scores?select=name,score&order=score.desc');
  return res.json(); // [{ name, score }, ...]
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
async function ensurePlayerToken(name) {
  const existing = getLocalToken(name);
  if (existing) return existing;
  // New player — generate, show modal, persist
  const tok = generateToken();
  setLocalToken(name, tok);
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
  // localStorage fallback: stored as { name: { token, score } }
  const d = _loadLocal();
  return Object.fromEntries(Object.entries(d).map(([n, v]) => [n, v.score || 0]));
}

// Save score: Supabase if configured, always update local cache too
async function saveScore(name, score) {
  const tok = getLocalToken(name);
  if (!tok) return; // shouldn't happen
  // Update local cache score
  const d = _loadLocal();
  if (!d[name] || score > (d[name].score || 0)) {
    d[name] = { token: tok, score };
    _saveLocal(d);
  }
  if (_sb) {
    try { await sbSubmitScore(name, tok, score); }
    catch (e) { console.warn('Supabase submit failed', e); }
  }
}

function bestForPlayer(name) {
  const d = _loadLocal();
  return d[name]?.score || 0;
}
