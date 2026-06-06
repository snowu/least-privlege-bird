// Edge function: token-only account recovery.
// The client posts a raw token; we hash it server-side and look up the account it
// belongs to, returning only the name. token_hash is NOT exposed to anon SELECT
// (revoked) — this function, using the service role, is the only path that touches it.
// A wrong/unknown token simply resolves to no account; we never reveal hashes.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: { token?: string };
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { token } = payload;
  if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) {
    return json({ error: "bad token" }, 400);
  }

  const h = await sha256hex(token);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/scores?token_hash=eq.${h}&select=name`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    },
  );
  if (!res.ok) return json({ error: "db read failed" }, 502);
  const rows = await res.json() as { name: string }[];

  // null name (not 404) so the client distinguishes "no match" from a transport error.
  return json({ name: rows.length ? rows[0].name : null });
});
