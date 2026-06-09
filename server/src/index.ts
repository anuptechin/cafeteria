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
import { cafeteriasRouter } from "./cafeterias-routes.js";
import { requireAuth, requireRole, seedSuperAdmin } from "./auth.js";
import { buildDetailWorkbook } from "./export-xlsx.js";

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

// Cafeteria / device / meal-window management (admin + super admin; guarded per-route).
app.use("/api", cafeteriasRouter);

// Resolve the time range from query (?range=... &from=YYYY-MM-DD &to=YYYY-MM-DD).
const rng = (req: express.Request) =>
  resolveRange(
    String(req.query.range ?? "month"),
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined
  );

const ok = (res: express.Response, data: unknown) => res.json({ ok: true, data });
const fail = (res: express.Response, e: unknown) => {
  console.error(e);
  res.status(500).json({ ok: false, error: (e as Error).message });
};

// Canteen managers are limited to the live display only (recent-faces + SSE
// stream, which just need requireAuth). Everything analytical — dashboard,
// employee directory and reports — is staff-only (super admin, admin, HR).
const STAFF = requireRole("super_admin", "admin", "hr_manager");

// ---- Dashboard (consumption monitoring — counts only) ----
// Optional ?cafeteria=<id> scopes every figure to that cafeteria's devices.
app.get("/api/dashboard", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const cafe = cafeOf(req);
    const meal = mealOf(req);
    const eff = effectiveCafes(req, cafe);
    const today = todayWindow();
    const [s, todayS, tr, devices, topEmp, meals, byCafe, byCafeMeal, cafeterias, hrs] = await Promise.all([
      Q.summaryC(r.from, r.to, eff, meal),                // KPIs scope to meal
      Q.summaryC(today.from, today.to, eff, meal),
      Q.trendC(r.from, r.to, eff),                        // trend returns all meal columns
      Q.byDeviceC(r.from, r.to, eff, meal),
      Q.byEmployeeC(r.from, r.to, eff, 12, meal),
      Q.byMeal(r.from, r.to, eff, meal),                  // breakdown — follows the meal filter
      Q.byCafeteria(r.from, r.to, eff, meal),
      Q.byCafeteriaMeal(r.from, r.to, eff, meal),         // "Location Share" donut (cafeteria · meal)
      Q.cafeteriasList(allowedCafes(req)),
      Q.hourlyC(today.from, today.to, eff, meal),
    ]);
    const days = Math.max(1, tr.length);
    ok(res, {
      range: r.key,
      from: r.from,
      to: r.to,
      cafeteria: cafe,
      meal,
      cafeterias,
      totals: { meals: s.meals },
      uniqueEmployees: s.employees,
      activeDevices: devices.filter((d) => d.meals > 0).length,
      avgPerDay: Math.round(s.meals / days),
      today: { meals: todayS.meals, employees: todayS.employees },
      trend: tr,
      devices,
      topEmployees: topEmp,
      meals,
      byCafeteria: byCafe,
      byCafeteriaMeal: byCafeMeal,
      hourly: hrs,
    });
  } catch (e) {
    fail(res, e);
  }
});

// ---- Live display / dashboard feed: last N faces (optional meal/cafeteria filter) ----
app.get("/api/recent-faces", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 10), 50);
    const eff = effectiveCafes(req, cafeOf(req));
    // Optional date-range scoping (from/to) so the dashboard "Recent" honors the
    // date picker; omitted -> latest overall (used by the live kiosk display).
    const useRange = req.query.range || req.query.from || req.query.to;
    const r = useRange ? rng(req) : null;
    ok(res, await Q.recentFaces(limit, eff, mealOf(req), r?.from ?? null, r?.to ?? null));
  } catch (e) {
    fail(res, e);
  }
});

// Cafeteria list for the live-display / filter selectors (available to canteen
// managers too, so NOT behind the STAFF guard). Scoped to the user's access.
app.get("/api/live/cafeterias", async (req, res) => {
  try {
    ok(res, await Q.cafeteriasList(allowedCafes(req)));
  } catch (e) {
    fail(res, e);
  }
});

// Live meal counter — resets per time slot (see Q.liveMealCount). Reflects the
// dedup rules automatically (only counted punches exist in punch_meals).
app.get("/api/live/count", async (req, res) => {
  try {
    const requested = cafeOf(req);
    const eff = effectiveCafes(req, requested);
    const allowed = allowedCafes(req);
    // Focused cafeteria for active-slot logic: the requested one (if allowed), or
    // the sole assigned cafeteria for a single-cafeteria manager.
    let activeCafe = requested != null && (allowed === null || allowed.includes(requested)) ? requested : null;
    if (activeCafe == null && allowed && allowed.length === 1) activeCafe = allowed[0];
    ok(res, await Q.liveMealCount(eff, activeCafe, mealOf(req)));
  } catch (e) {
    fail(res, e);
  }
});

// Resolve an optional ?cafeteria=<id> filter.
const cafeOf = (req: express.Request) => (req.query.cafeteria ? Number(req.query.cafeteria) : null);
const mealOf = (req: express.Request) => (req.query.meal ? String(req.query.meal) : null);

// The cafeterias this user is allowed to see (null = ALL, super_admin/admin).
const allowedCafes = (req: express.Request): number[] | null => req.user?.cafeterias ?? null;

// Effective cafeteria filter for a query: the user's allowed set intersected with
// any requested ?cafeteria. null = all; [] = nothing (denied / unassigned).
const effectiveCafes = (req: express.Request, requested: number | null): number[] | null => {
  const allowed = allowedCafes(req);
  if (allowed === null) return requested != null ? [requested] : null;
  if (requested != null) return allowed.includes(requested) ? [requested] : [];
  return allowed; // may be [] -> sees nothing
};

// ---- Employee directory / search (optional cafeteria scope) ----
app.get("/api/employees", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const search = String(req.query.search ?? "").trim();
    const limit = Math.min(Number(req.query.limit ?? 50), 500);
    ok(res, await Q.employeesDirectory(r.from, r.to, search, effectiveCafes(req, cafeOf(req)), mealOf(req), limit));
  } catch (e) {
    fail(res, e);
  }
});

// ---- Reports (counts only, for audit / dispute reference) ----
// Location report: one row per (cafeteria, meal) — Lunch/Dinner shown separately.
app.get("/api/reports/device", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const rows = await Q.byLocationMeal(r.from, r.to, effectiveCafes(req, cafeOf(req)), mealOf(req));
    const totalMeals = rows.reduce((a, c) => a + c.meals, 0);
    ok(res, { range: r.key, from: r.from, to: r.to, rows, totalMeals });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/reports/employees", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const rows = await Q.employeesReportC(r.from, r.to, effectiveCafes(req, cafeOf(req)), mealOf(req));
    const totalMeals = rows.reduce((a, e) => a + e.meals, 0);
    ok(res, { range: r.key, rows, totalMeals });
  } catch (e) {
    fail(res, e);
  }
});

// Date-wise report: per-day counts of each meal type (Lunch/Dinner/Tea/Biscuit),
// scoped to the viewer's allowed ∩ selected cafeteria + range. trendC already
// pivots by meal, so this is a thin wrapper over it.
app.get("/api/reports/daily", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const rows = await Q.trendC(r.from, r.to, effectiveCafes(req, cafeOf(req)));
    ok(res, { range: r.key, from: r.from, to: r.to, rows });
  } catch (e) {
    fail(res, e);
  }
});

// Detailed multi-sheet Excel export (Employees summary + one employee×date grid
// per meal, with cost). Streams a styled .xlsx. Scoped to range + cafeteria.
app.get("/api/reports/export.xlsx", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const requested = cafeOf(req);
    const eff = effectiveCafes(req, requested);
    let scope = "All cafeterias";
    if (requested != null) {
      const c = await one<{ name: string }>(`SELECT name FROM cafeterias WHERE id = $1`, [requested]);
      scope = c?.name ?? `Cafeteria #${requested}`;
    }
    const rows = await Q.exportDetail(r.from, r.to, eff);
    const d = (s: string) => s.slice(0, 10);
    const generatedAt = new Date().toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const buf = await buildDetailWorkbook(
      { title: "D'Decor — Cafeteria Consumption & Cost", periodLabel: `${d(r.from)} to ${d(r.to)}`, scope, generatedAt },
      rows
    );
    const fname = `cafeteria_${r.key}_${d(r.from)}_${d(r.to)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.end(buf);
  } catch (e) {
    fail(res, e);
  }
});

// Vendor/Company settlement (PDF source): per-cafeteria day-wise counts + cost.
app.get("/api/reports/settlement", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    const data = await Q.settlementReport(r.from, r.to, effectiveCafes(req, cafeOf(req)));
    ok(res, { range: r.key, from: r.from, to: r.to, generatedAt: new Date().toISOString(), ...data });
  } catch (e) {
    fail(res, e);
  }
});

app.get("/api/reports/employee/:empId", STAFF, async (req, res) => {
  try {
    const r = rng(req);
    // KPI tiles scope to the viewer's allowed ∩ selected cafeteria; punch list +
    // total additionally scope to the selected meal.
    const { emp, kpi, cost, punches } = await Q.employeeReportC(
      req.params.empId, r.from, r.to, effectiveCafes(req, cafeOf(req)), mealOf(req)
    );
    if (!emp) return res.status(404).json({ ok: false, error: "Employee not found" });
    ok(res, { emp, range: r.key, kpi, cost, punches, totalMeals: punches.length });
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
