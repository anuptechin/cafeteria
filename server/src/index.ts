import express from "express";
import cors from "cors";
import fs from "node:fs";
import { env } from "./env.js";
import { pool, query, one } from "./db.js";
import { resolveRange, todayWindow } from "./ranges.js";
import * as Q from "./queries.js";
import { setupLive, manualPunch, setAuto, getAuto } from "./live.js";
import { buildPhotoIndex, photoPath, photoIds, contentTypeFor } from "./photos.js";
import { authRouter } from "./auth-routes.js";
import { requireAuth, requireRole, seedSuperAdmin } from "./auth.js";

const app = express();
app.set("trust proxy", true); // so clientIp() reads X-Forwarded-For correctly
app.use(cors());
app.use(express.json());

// Serve an employee photo. The fixed-digit emp_id is embedded in the filename
// (any prefix). Only employees that actually have a file are served here; the
// client renders inline text for everyone else (no request = instant).
app.get("/faces/:id", (req, res) => {
  const empId = req.params.id.replace(/\D/g, "");
  const full = photoPath(empId);
  if (full && fs.existsSync(full)) {
    res.type(contentTypeFor(full));
    res.setHeader("Cache-Control", "public, max-age=86400");
    return fs.createReadStream(full).pipe(res);
  }
  res.status(404).end();
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

// List of emp_ids that have a photo (client loads images only for these).
app.get("/api/photos", (_req, res) => ok(res, photoIds()));

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

// Managers are limited to live stream + reports; dashboard & config are staff-only.
const STAFF = requireRole("super_admin", "admin");

// ---- Dashboard (consumption monitoring — counts only) ----
app.get("/api/dashboard", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const today = todayWindow();
    const [s, todayS, tr, cafeterias, topEmp, slots, hrs] = await Promise.all([
      Q.summary(r.from, r.to),
      Q.summary(today.from, today.to),
      Q.trend(r.from, r.to),
      Q.byCafeteria(r.from, r.to),
      Q.byEmployee(r.from, r.to, 12),
      Q.bySlot(r.from, r.to),
      Q.hourly(today.from, today.to),
    ]);
    const days = Math.max(1, tr.length);
    ok(res, {
      range: r.key,
      totals: { meals: s.meals },
      uniqueEmployees: s.employees,
      activeCafeterias: cafeterias.filter((c) => c.meals > 0).length,
      avgPerDay: Math.round(s.meals / days),
      today: { meals: todayS.meals, employees: todayS.employees },
      trend: tr,
      cafeterias,
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
        `SELECT e.emp_id, e.name, e.department,
                count(p.id)::int AS meals,
                max(p.punched_at) AS last_seen
           FROM employees e
           LEFT JOIN punches p
             ON p.emp_id = e.emp_id AND p.punched_at >= $2 AND p.punched_at < $3
          WHERE e.emp_id ILIKE $1 OR e.name ILIKE $1
          GROUP BY e.emp_id, e.name, e.department
          ORDER BY meals DESC, e.name
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
app.get("/api/reports/cafeteria", async (req, res) => {
  try {
    const r = rng(req);
    const rows = await Q.byCafeteria(r.from, r.to);
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

// ---- Config / admin (cafeteria mapping + slots) ----
app.get("/api/config", STAFF, async (_req, res) => {
  try {
    ok(res, { devices: await Q.devicesList(), slots: await Q.slotsList() });
  } catch (e) {
    fail(res, e);
  }
});

app.put("/api/config/device/:stdId", STAFF, async (req, res) => {
  try {
    const { cafeteria_name, location, active } = req.body;
    const row = await one(
      `UPDATE devices
          SET cafeteria_name = COALESCE($2, cafeteria_name),
              location       = COALESCE($3, location),
              active         = COALESCE($4, active)
        WHERE std_id = $1 RETURNING *`,
      [Number(req.params.stdId), cafeteria_name ?? null, location ?? null, active ?? null]
    );
    if (!row) return res.status(404).json({ ok: false, error: "Device not found" });
    ok(res, row);
  } catch (e) {
    fail(res, e);
  }
});

// ---- Simulation portal ----
app.post("/api/simulate/punch", async (req, res) => {
  try {
    const empId = req.body.emp_id ? String(req.body.emp_id) : undefined;
    const stdId = req.body.std_id != null ? Number(req.body.std_id) : undefined;
    const row = await manualPunch(empId, stdId);
    if (!row) return res.status(409).json({ ok: false, error: "Punch rejected (duplicate)" });
    ok(res, row);
  } catch (e) {
    if ((e as Error).message === "EMP_NOT_FOUND")
      return res.status(404).json({ ok: false, error: "Employee ID not found" });
    fail(res, e);
  }
});

app.post("/api/simulate/burst", async (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.body.count ?? 10), 1), 200);
    let inserted = 0;
    for (let i = 0; i < n; i++) if (await manualPunch()) inserted++;
    ok(res, { inserted });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/api/simulate/auto", (req, res) => ok(res, { auto: setAuto(Boolean(req.body.on)) }));
app.get("/api/simulate/auto", (_req, res) => ok(res, { auto: getAuto() }));

async function start() {
  await seedSuperAdmin();
  await setupLive(app);
  const n = buildPhotoIndex();
  app.listen(env.port, () => {
    console.log(`\n  Cafeteria API → http://localhost:${env.port}`);
    console.log(`  Photos dir    → ${env.facesDir} (${n} photos indexed)\n`);
  });
}
start().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
