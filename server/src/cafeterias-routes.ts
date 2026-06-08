import { Router } from "express";
import { query, one } from "./db.js";
import { requireRole, audit } from "./auth.js";
import { todayWindow } from "./ranges.js";

// Cafeteria / device / meal-window management. Admin + super admin only.
// These tables are not under RLS (like punches/emp_data), so the API guard
// below is the gate; every write is recorded in the audit trail.
export const cafeteriasRouter = Router();

const ok = (res: any, data: unknown) => res.json({ ok: true, data });
const fail = (res: any, e: unknown) => {
  console.error(e);
  res.status(500).json({ ok: false, error: (e as Error).message });
};

const ADMIN = requireRole("super_admin", "admin");
export const CATEGORIES = ["lunch_dinner", "tea", "biscuits"] as const;
type Category = (typeof CATEGORIES)[number];
const isCategory = (v: unknown): v is Category => CATEGORIES.includes(v as Category);

// ---- read: full nested view (cafeterias -> devices + windows + today counts) ----
cafeteriasRouter.get("/cafeterias", ADMIN, async (_req, res) => {
  try {
    const today = todayWindow();
    const [cafeterias, devices, slots, counts] = await Promise.all([
      query<{ id: number; name: string; active: boolean; created_at: string }>(
        `SELECT id, name, active, created_at FROM cafeterias ORDER BY name`
      ),
      query<{ device_id: string; cafeteria_id: number; category: Category; label: string | null }>(
        `SELECT device_id, cafeteria_id, category, label FROM cafeteria_devices ORDER BY device_id`
      ),
      query<{ id: number; cafeteria_id: number; meal: string; start_time: string; end_time: string; dedup_mode: string; sort: number }>(
        `SELECT id, cafeteria_id, meal, start_time, end_time, dedup_mode, sort
           FROM cafeteria_time_slots ORDER BY sort, id`
      ),
      // Today's meal counts per cafeteria + category — the tiny device table joins
      // the large punches table cheaply (it stays fully cached).
      query<{ cafeteria_id: number; category: Category; meals: number }>(
        `SELECT d.cafeteria_id, d.category, count(*)::int AS meals
           FROM punches p JOIN cafeteria_devices d ON d.device_id = p.device_id
          WHERE p.punched_at >= $1 AND p.punched_at < $2
          GROUP BY d.cafeteria_id, d.category`,
        [today.from, today.to]
      ),
    ]);

    const rows = cafeterias.map((c) => ({
      ...c,
      devices: devices.filter((d) => d.cafeteria_id === c.id),
      slots: slots.filter((s) => s.cafeteria_id === c.id),
      todayMeals: counts
        .filter((m) => m.cafeteria_id === c.id)
        .reduce((acc, m) => ((acc[m.category] = m.meals), acc), {} as Record<string, number>),
    }));
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
});

// ---- cafeterias CRUD ----
cafeteriasRouter.post("/cafeterias", ADMIN, async (req, res) => {
  try {
    const name = String(req.body.name ?? "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "Cafeteria name is required" });
    const row = await one<{ id: number }>(
      `INSERT INTO cafeterias (name) VALUES ($1)
       RETURNING id, name, active, created_at`,
      [name]
    );
    // Give the new cafeteria the default meal slots (editable afterwards).
    if (row) await query(`SELECT seed_cafeteria_time_slots($1)`, [row.id]);
    await audit(req, "CAFETERIA_CREATED", { detail: `Created cafeteria ${name}` });
    ok(res, row);
  } catch (e: any) {
    if (e?.code === "23505")
      return res.status(409).json({ ok: false, error: "A cafeteria with that name already exists" });
    fail(res, e);
  }
});

cafeteriasRouter.patch("/cafeterias/:id", ADMIN, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = typeof req.body.name === "string" ? req.body.name.trim() : null;
    const active = typeof req.body.active === "boolean" ? req.body.active : null;
    const row = await one(
      `UPDATE cafeterias
          SET name   = COALESCE($2, name),
              active = COALESCE($3, active)
        WHERE id = $1
        RETURNING id, name, active, created_at`,
      [id, name, active]
    );
    if (!row) return res.status(404).json({ ok: false, error: "Cafeteria not found" });
    await audit(req, "CAFETERIA_UPDATED", { detail: `Updated cafeteria #${id}` });
    ok(res, row);
  } catch (e: any) {
    if (e?.code === "23505")
      return res.status(409).json({ ok: false, error: "A cafeteria with that name already exists" });
    fail(res, e);
  }
});

cafeteriasRouter.delete("/cafeterias/:id", ADMIN, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await one(`DELETE FROM cafeterias WHERE id = $1 RETURNING name`, [id]);
    if (!row) return res.status(404).json({ ok: false, error: "Cafeteria not found" });
    await audit(req, "CAFETERIA_DELETED", { detail: `Deleted cafeteria ${row.name} (#${id})` });
    ok(res, { deleted: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---- devices: assign a raw device id to a cafeteria + meal category ----
cafeteriasRouter.post("/devices", ADMIN, async (req, res) => {
  try {
    const device_id = String(req.body.device_id ?? "").trim();
    const cafeteria_id = Number(req.body.cafeteria_id);
    const category = req.body.category;
    const label = String(req.body.label ?? "").trim() || null;
    if (!device_id) return res.status(400).json({ ok: false, error: "Device ID is required" });
    if (!Number.isFinite(cafeteria_id))
      return res.status(400).json({ ok: false, error: "A cafeteria must be selected" });
    if (!isCategory(category))
      return res.status(400).json({ ok: false, error: "Invalid meal category" });
    const row = await one(
      `INSERT INTO cafeteria_devices (device_id, cafeteria_id, category, label)
       VALUES ($1, $2, $3, $4)
       RETURNING device_id, cafeteria_id, category, label`,
      [device_id, cafeteria_id, category, label]
    );
    await audit(req, "DEVICE_ASSIGNED", { detail: `Device ${device_id} -> cafeteria #${cafeteria_id} (${category})` });
    ok(res, row);
  } catch (e: any) {
    if (e?.code === "23505")
      return res.status(409).json({ ok: false, error: "That device ID is already assigned" });
    if (e?.code === "23503")
      return res.status(400).json({ ok: false, error: "Selected cafeteria no longer exists" });
    fail(res, e);
  }
});

cafeteriasRouter.patch("/devices/:deviceId", ADMIN, async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    const cafeteria_id =
      req.body.cafeteria_id != null ? Number(req.body.cafeteria_id) : null;
    const category = req.body.category;
    const label = typeof req.body.label === "string" ? req.body.label.trim() : null;
    if (category != null && !isCategory(category))
      return res.status(400).json({ ok: false, error: "Invalid meal category" });
    const row = await one(
      `UPDATE cafeteria_devices
          SET cafeteria_id = COALESCE($2, cafeteria_id),
              category     = COALESCE($3, category),
              label        = COALESCE($4, label)
        WHERE device_id = $1
        RETURNING device_id, cafeteria_id, category, label`,
      [deviceId, cafeteria_id, category ?? null, label]
    );
    if (!row) return res.status(404).json({ ok: false, error: "Device not found" });
    await audit(req, "DEVICE_UPDATED", { detail: `Updated device ${deviceId}` });
    ok(res, row);
  } catch (e: any) {
    if (e?.code === "23503")
      return res.status(400).json({ ok: false, error: "Selected cafeteria no longer exists" });
    fail(res, e);
  }
});

cafeteriasRouter.delete("/devices/:deviceId", ADMIN, async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId);
    const row = await one(`DELETE FROM cafeteria_devices WHERE device_id = $1 RETURNING device_id`, [deviceId]);
    if (!row) return res.status(404).json({ ok: false, error: "Device not found" });
    await audit(req, "DEVICE_REMOVED", { detail: `Removed device ${deviceId}` });
    ok(res, { deleted: true });
  } catch (e) {
    fail(res, e);
  }
});

// ---- per-cafeteria meal time-slots: edit the start/end of each slot ----
cafeteriasRouter.put("/cafeterias/:id/time-slots", ADMIN, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const slots = Array.isArray(req.body.slots) ? req.body.slots : [];
    const cafe = await one(`SELECT id FROM cafeterias WHERE id = $1`, [id]);
    if (!cafe) return res.status(404).json({ ok: false, error: "Cafeteria not found" });

    const time = /^\d{2}:\d{2}(:\d{2})?$/;
    for (const s of slots) {
      if (!time.test(String(s.start_time)) || !time.test(String(s.end_time)))
        return res.status(400).json({ ok: false, error: "Times must be HH:MM" });
      // Only the slot's own start/end are editable; rows are scoped to this cafeteria.
      await query(
        `UPDATE cafeteria_time_slots
            SET start_time = $3, end_time = $4
          WHERE id = $1 AND cafeteria_id = $2`,
        [Number(s.id), id, s.start_time, s.end_time]
      );
    }
    await audit(req, "TIME_SLOTS_UPDATED", { detail: `Updated meal time-slots for cafeteria #${id}` });
    const rows = await query(
      `SELECT id, cafeteria_id, meal, start_time, end_time, dedup_mode, sort
         FROM cafeteria_time_slots WHERE cafeteria_id = $1 ORDER BY sort, id`,
      [id]
    );
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
});
