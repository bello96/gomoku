export { GomokuRoom } from "./room";

interface Env {
  GOMOKU_ROOM: DurableObjectNamespace;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // POST /api/rooms → 创建房间
    if (path === "/api/rooms" && request.method === "POST") {
      // 6 位数字仅有 100 万种取值，需要重试避免覆盖已存在房间
      const MAX_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        const id = env.GOMOKU_ROOM.idFromName(code);
        const stub = env.GOMOKU_ROOM.get(id);

        const probe = await stub.fetch(
          new Request("https://internal/info", { method: "GET" }),
        );
        if (probe.ok) {
          const info = (await probe.json()) as { roomCode?: string };
          if (info.roomCode) {
            // 房间号已被占用，换一个
            continue;
          }
        }

        await stub.fetch(
          new Request("https://internal/init", {
            method: "POST",
            body: JSON.stringify({ roomCode: code }),
          }),
        );
        return json({ roomCode: code });
      }
      return json({ error: "Failed to allocate room code" }, 503);
    }

    // /api/rooms/:code/*
    const roomMatch = path.match(/^\/api\/rooms\/(\d{6})(\/.*)?$/);
    if (roomMatch) {
      const code = roomMatch[1]!;
      const subpath = roomMatch[2] || "";
      const id = env.GOMOKU_ROOM.idFromName(code);
      const stub = env.GOMOKU_ROOM.get(id);

      // POST /api/rooms/:code/quickleave
      if (subpath === "/quickleave" && request.method === "POST") {
        const playerId = await request.text();
        await stub.fetch(
          new Request("https://internal/quickleave", {
            method: "POST",
            body: playerId,
          }),
        );
        return new Response("ok", { headers: corsHeaders() });
      }

      // GET /api/rooms/:code/ws → WebSocket
      if (
        subpath === "/ws" &&
        request.headers.get("Upgrade") === "websocket"
      ) {
        return stub.fetch(request);
      }

      // GET /api/rooms/:code → 房间信息
      if (!subpath && request.method === "GET") {
        const res = await stub.fetch(
          new Request("https://internal/info", { method: "GET" }),
        );
        return new Response(res.body, {
          status: res.status,
          headers: { ...Object.fromEntries(res.headers), ...corsHeaders() },
        });
      }
    }

    return json({ error: "Not Found" }, 404);
  },
};

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}
