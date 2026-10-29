// ─── ROOM RELAY (Cloudflare Worker + Durable Object) ──────────────────────────
// The multiplayer transport for src/multiplayer.ts. One in-memory Durable Object per
// 4-letter room code; it knows nothing about the game. It does two things:
//   presence  — each socket registers a JSON meta ({t:'track', meta}); every change
//               pushes the full list to everyone ({t:'presence', metas}).
//   broadcast — {t:'bc', event, payload} is relayed verbatim to every OTHER socket.
// No storage: when the last socket leaves and the object is evicted, the room is gone.
// Replaces Supabase Realtime, whose free tier (100 msgs/s project-wide, counting each
// delivery) can't carry a 10-player race.
import { DurableObject } from "cloudflare:workers";

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

const MAX_SOCKETS = 32;
const MAX_FRAME = 16 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const m = new URL(req.url).pathname.match(/^\/ws\/([A-Z]{4})$/);
    if (!m) return new Response("lpb-rooms: connect to /ws/<CODE>", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class Room extends DurableObject<Env> {
  metas = new Map<WebSocket, unknown>();

  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    if (this.metas.size >= MAX_SOCKETS) {
      server.close(4009, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }
    this.metas.set(server, null);
    server.addEventListener("message", (e) => this.onMessage(server, e.data));
    const drop = () => { if (this.metas.delete(server)) this.pushPresence(); };
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(from: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > MAX_FRAME) return;
    let msg: { t?: string; meta?: unknown; event?: string; payload?: unknown };
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === "track") {
      this.metas.set(from, msg.meta ?? null);
      this.pushPresence();
    } else if (msg.t === "bc" && typeof msg.event === "string") {
      const out = JSON.stringify({ t: "bc", event: msg.event, payload: msg.payload });
      for (const ws of this.metas.keys()) if (ws !== from) this.send(ws, out);
    }
  }

  pushPresence() {
    const out = JSON.stringify({ t: "presence", metas: [...this.metas.values()].filter(Boolean) });
    for (const ws of this.metas.keys()) this.send(ws, out);
  }

  send(ws: WebSocket, data: string) {
    try { ws.send(data); } catch {}
  }
}
