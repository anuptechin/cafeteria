import express from "express";
import cors from "cors";
import { env } from "./env.js";
import { pool, query, one } from "./db.js";
import { resolveRange, todayWindow } from "./ranges.js";
import * as Q from "./queries.js";
import { setupLive } from "./live.js";
import fs from "node:fs";
import { sniffImageType } from "./photos.js";
import { resolveFacePath } from "./facesFs.js";
import { authRouter } from "./auth-routes.js";
import { requireAuth, requireRole, seedSuperAdmin } from "./auth.js";

const app = express();
app.set("trust proxy", true); // so clientIp() reads X-Forwarded-For correctly
app.use(cors());
app.use(express.json());

// Serve a captured face image for a punch, addressed by punch id. The photo is
// resolved from the on-disk directory HikCentral syncs to (env.facesDir), keyed
// by the punch's person_name / emp_id. Falls back to a real inline-bytea image if
// one was stored, else 404 (the client then renders an inline monogram). Public
// (an <img> tag can't send auth headers).
app.get("/faces/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).end();
    const row = await one<{ person_name: string | null; emp_id: string | null; image: Buffer | null }>(
      `SELECT person_name, emp_id, image FROM punches WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).end();

    // Preferred: the photo file on disk.
    const file = resolveFacePath(row.person_name, row.emp_id);
    if (file) {
      res.type("image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return fs.createReadStream(file).on("error", () => res.status(404).end()).pipe(res);
    }

    // Back-compat: a genuine image stored inline (skip the tiny path/ref strings
    // the feed sometimes writes — real captures are several KB).
    if (row.image && row.image.length > 1024) {
      res.type(sniffImageType(row.image));
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.end(row.image);
    }
    return res.status(404).end();
  } catch {
    res.status(500).end();
  }
});

// ---- Auth: public login + self-guarded user/audit endpoints ----
app.use("/api", authRouter);

// Public health check (no session required) — used by uptime probes.
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, data: { status: "up" } });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

// 🔒 Everything below this line requires a valid session token.
app.use("/api", requireAuth);

// Resolve the time range from query (?range=... &from=YYYY-MM-DD &to=YYYY-MM-DD).
const rng = (req: express.Request) =>
  resolveRange(
    String(req.query.range ?? "60d"),
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined
  );

const ok = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, e: unknown) => {
  console.error(e);
  res.status(500).json({ ok: false, error: (e as Error).message });
};

// Managers are limited to live stream + reports; the dashboard is staff-only.
const STAFF = requireRole("super_admin", "admin");

// ---- Dashboard (consumption monitoring — counts only) ----
app.get("/api/dashboard", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const today = todayWindow();
    const [s, todayS, tr, devices, topEmp, slots, hrs] = await Promise.all([
      Q.summary(r.from, r.to),
      Q.summary(today.from, today.to),
      Q.trend(r.from, r.to),
      Q.byDevice(r.from, r.to),
      Q.byEmployee(r.from, r.to, 12),
      Q.bySlot(r.from, r.to),
      Q.hourly(today.from, today.to),
    ]);
    const days = Math.max(1, tr.length);
    ok(res, {
      range: r.key,
      totals: { meals: s.meals },
      uniqueEmployees: s.employees,
      activeDevices: devices.filter((d) => d.meals > 0).length,
      avgPerDay: Math.round(s.meals / days),
      today: { meals: todayS.meals, employees: todayS.employees },
      trend: tr,
      devices,
      topEmployees: topEmp,
      slots,
      hourly: hrs,
    });
  } catch (e) {
    fail(res, e);
  }
});

// ---- Live display: last N faces ----
app.get("/api/recent-faces", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    ok(res, await Q.recentFaces(limit));
  } catch (e) {
    fail(res, e);
  }
});

// ---- Employee directory / search ----
app.get("/api/employees", async (req, res) => {
  try {
    const r = rng(req);
    const search = String(req.query.search ?? "").trim();
    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    const offset = Number(req.query.offset ?? 0);
    if (search) {
      const rows = await query(
        `SELECT p.emp_id,
                max(p.person_name) AS name,
                count(*) FILTER (WHERE p.punched_at >= $2 AND p.punched_at < $3)::int AS meals,
                max(p.punched_at) FILTER (WHERE p.punched_at >= $2 AND p.punched_at < $3) AS last_seen,
                (SELECT x.id FROM punches x
                  WHERE x.emp_id = p.emp_id AND x.person_name IS NOT NULL
                  ORDER BY x.punched_at DESC LIMIT 1) AS image_id
           FROM punches p
          WHERE p.emp_id IS NOT NULL AND p.emp_id <> ''
            AND (p.emp_id ILIKE $1 OR p.person_name ILIKE $1)
          GROUP BY p.emp_id
          ORDER BY meals DESC, name
          LIMIT $4`,
        [`%${search}%`, r.from, r.to, limit]
      );
      return ok(res, rows);
    }
    ok(res, await Q.byEmployee(r.from, r.to, limit, offset));
  } catch (e) {
    fail(res, e);
  }
});

// ---- Reports (counts only, for audit / dispute reference) ----
app.get("/api/reports/device", async (req, res) => {
  try {
    const r = rng(req);
    const rows = await Q.byDevice(r.from, r.to);
    const totalMeals = rows.reduce((a, c) => a + c.meals, 0);
    ok(res, { range: r.key, from: r.from, to: r.to, rows, totalMeals });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/reports/employees", async (req, res) => {
  try {
    const r = rng(req);
    const rows = await Q.byEmployee(r.from, r.to, 100000);
    const totalMeals = rows.reduce((a, e) => a + e.meals, 0);
    ok(res, { range: r.key, rows, totalMeals });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/reports/employee/:empId", async (req, res) => {
  try {
    const r = rng(req);
    const { emp, punches } = await Q.employeeReport(req.params.empId, r.from, r.to);
    if (!emp) return res.status(404).json({ ok: false, error: "Employee not found" });
    ok(res, { emp, range: r.key, punches, totalMeals: punches.length });
  } catch (e) {
    fail(res, e);
  }
});

async function start() {
  await seedSuperAdmin();
  await setupLive(app);
  app.listen(env.port, () => {
    console.log(`\n  Cafeteria API → http://localhost:${env.port}\n`);
  });
}
start().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
