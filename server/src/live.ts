import type { Express, Response } from "express";
import { pool, query, one } from "./db.js";
import { punchesSince, maxPunchId } from "./queries.js";

type Client = { id: number; res: Response };
const clients = new Set<Client>();
let nextClientId = 1;
let lastId = 0;

function broadcast(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(payload);
}

// Poll for newly inserted punches and push them to all SSE clients.
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

// ---- caches for simulation ----
let empCache: string[] = [];
let empSet = new Set<string>();
let devCache: number[] = [];
async function loadCaches() {
  empCache = (await query<{ emp_id: string }>(`SELECT emp_id FROM employees`)).map((r) => r.emp_id);
  empSet = new Set(empCache);
  devCache = (await query<{ std_id: number }>(`SELECT std_id FROM devices WHERE active`)).map((r) => r.std_id);
}

// Insert a punch (random fills when not specified) and return the joined row.
// Self-heals a stale cache (e.g. after a master re-import) by reloading + retrying.
export async function manualPunch(empId?: string, stdId?: number): Promise<any> {
  if (!empCache.length) await loadCaches();
  if (empId && !empSet.has(empId)) {
    await loadCaches(); // maybe newly added
    if (!empSet.has(empId)) throw new Error("EMP_NOT_FOUND");
  }
  const emp = empId || empCache[Math.floor(Math.random() * empCache.length)];
  const std = stdId ?? devCache[Math.floor(Math.random() * devCache.length)];
  try {
    return await insertPunch(emp, std);
  } catch (e) {
    if ((e as any)?.code === "23503") {
      await loadCaches(); // FK violation → cache is stale, refresh and retry once
      const e2 = empId || empCache[Math.floor(Math.random() * empCache.length)];
      const s2 = stdId ?? devCache[Math.floor(Math.random() * devCache.length)];
      return await insertPunch(e2, s2);
    }
    throw e;
  }
}

async function insertPunch(emp: string, std: number) {
  const row = await one(
    `WITH ins AS (
       INSERT INTO punches(emp_id, std_id, punched_at) VALUES ($1,$2, now())
       ON CONFLICT DO NOTHING RETURNING id, emp_id, std_id, punched_at
     )
     SELECT i.id, i.emp_id, e.name, e.department, d.cafeteria_name, i.punched_at
       FROM ins i
       JOIN employees e ON e.emp_id = i.emp_id
       JOIN devices  d ON d.std_id = i.std_id`,
    [emp, std]
  );
  // Push to SSE clients immediately (0-latency) and advance the poll cursor
  // so the fallback poller doesn't re-send the same punch.
  if (row?.id) {
    if (row.id > lastId) lastId = row.id;
    broadcast("punch", row);
  }
  return row;
}

// ---- auto simulator (OFF by default; opt in via portal toggle or SIMULATE=true) ----
let autoOn = (process.env.SIMULATE ?? "false") === "true";
let autoTimer: NodeJS.Timeout | null = null;

function scheduleAuto() {
  if (autoTimer) clearTimeout(autoTimer);
  if (!autoOn) return;
  autoTimer = setTimeout(async () => {
    try {
      await manualPunch();
    } catch (e) {
      console.error("[sim] error:", (e as Error).message);
    }
    scheduleAuto();
  }, 1800 + Math.random() * 2600); // every ~1.8–4.4s
}

export function setAuto(on: boolean) {
  autoOn = on;
  if (on) scheduleAuto();
  else if (autoTimer) clearTimeout(autoTimer);
  return autoOn;
}
export function getAuto() {
  return autoOn;
}

export async function setupLive(app: Express) {
  lastId = await maxPunchId();
  await loadCaches();

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

  setInterval(poll, 400); // fallback for external inserts; portal punches broadcast instantly
  if (autoOn) {
    scheduleAuto();
    console.log("[live] auto punch simulator ON");
  }
}
