import type { Express, Response } from "express";
import { punchesSince, maxPunchId } from "./queries.js";

type Client = { id: number; res: Response };
const clients = new Set<Client>();
let nextClientId = 1;
let lastId = 0;

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(payload);
}

// Poll for newly inserted punches (from the external Hikvision ingestion) and
// push them to all connected SSE clients.
async function poll() {
  try {
    const rows = await punchesSince(lastId);
    if (rows.length) {
      lastId = rows[rows.length - 1].id;
      for (const r of rows) broadcast("punch", r);
    }
  } catch (e) {
    console.error("[live] poll error:", (e as Error).message);
  }
}

export async function setupLive(app: Express) {
  lastId = await maxPunchId();

  app.get("/api/live/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: ready\ndata: {"ok":true}\n\n`);
    const client: Client = { id: nextClientId++, res };
    clients.add(client);
    const keepAlive = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(client);
    });
  });

  setInterval(poll, 400); // detect rows inserted by the external feed
}
