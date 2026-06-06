// Edge function: `fortune` — returns one random real Unix fortune cookie.
// This is the message source (the `fortune` half of `fortune | cowsay`). The
// client is our `cowsay -f <avatar>`: it wraps this line in a speech balloon
// and staples the player's selected avatar (ASCII) underneath.
//
// The fortunes are the genuine fortune-mod data files, extracted into fortunes.ts.
// Living in an edge function lets us grow the bank without redeploying the static
// frontend — and "fortune runs on Supabase Edge" is the joke.

import { FORTUNES } from "./fortunes.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  const tip = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
  return json({ tip });
});
