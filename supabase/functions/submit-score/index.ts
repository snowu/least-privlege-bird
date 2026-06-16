// Edge function: authoritative score submission.
// Recomputes the score by replaying { seed, flapTicks } through the real physics,
// rejects any claim that doesn't match, then does the token-hash + max-only write
// with the service role (bypasses RLS — anon cannot write the table directly).

// Authoritative replay runs the SAME physics the browser does — the shared core
// in src/physics-core.ts. No local sim copy to drift; the golden tests + the
// browser game both exercise this exact module.
import { simulate } from "../../../src/physics-core.ts";
import { AVATAR_KEYS } from "../../../src/avatars-meta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sha256hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Direct REST helpers using the service role (bypasses RLS).
function db(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: {
    name?: string; token?: string; seed?: number;
    flapTicks?: number[]; claimedScore?: number; avatar?: string;
  };
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { name, token, seed, flapTicks, claimedScore, avatar } = payload;

  // Cosmetic field — never affects the replay/score path. Unknown/missing
  // values are dropped silently rather than rejecting the whole request.
  const validAvatar = typeof avatar === "string" && (AVATAR_KEYS as readonly string[]).includes(avatar)
    ? avatar
    : undefined;

  // ── Input validation (cheap rejects before replay) ──
  if (typeof name !== "string" || !name.trim() || name.length > 64) return json({ error: "bad name" }, 400);
  if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) return json({ error: "bad token" }, 400);
  if (!Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff) return json({ error: "bad seed" }, 400);
  if (typeof claimedScore !== "number" || !Number.isInteger(claimedScore) || claimedScore < 0) return json({ error: "bad score" }, 400);
  if (!Array.isArray(flapTicks) || flapTicks.length > 100000) return json({ error: "bad inputs" }, 400);
  // flapTicks must be non-negative integers, strictly increasing (one flap per tick max)
  let prev = -1;
  for (const t of flapTicks) {
    if (!Number.isInteger(t) || t <= prev || t < 0) return json({ error: "bad inputs" }, 400);
    prev = t;
  }

  // ── Authoritative replay ──
  const { score } = simulate(seed as number, flapTicks as number[]);
  if (score !== claimedScore) {
    return json({ error: "score mismatch", computed: score }, 422);
  }

  // ── Token-hash verify + max-only write ──
  const h = await sha256hex(token);
  const sel = await db(`/scores?name=eq.${encodeURIComponent(name)}&select=token_hash,score`);
  if (!sel.ok) return json({ error: "db read failed" }, 502);
  const rows = await sel.json() as { token_hash: string; score: number }[];

  if (rows.length === 0) {
    // New player — register the row.
    const ins = await db(`/scores`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ name, token_hash: h, score, ...(validAvatar ? { avatar: validAvatar } : {}) }),
    });
    if (!ins.ok) return json({ error: "db insert failed" }, 502);
    return json({ ok: true, score });
  }

  const existing = rows[0];
  if (existing.token_hash !== h) return json({ error: "token mismatch" }, 403);
  if (score > existing.score) {
    const upd = await db(`/scores?name=eq.${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ score, ...(validAvatar ? { avatar: validAvatar } : {}) }),
    });
    if (!upd.ok) return json({ error: "db update failed" }, 502);
  }
  return json({ ok: true, score });
});
