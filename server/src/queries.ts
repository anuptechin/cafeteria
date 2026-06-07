import { query, one } from "./db.js";
import { env } from "./env.js";

const TZ = env.tz;

// Monitoring-only: every figure here is a meal COUNT (did this person eat?).
// No money, no contributions — this is not finance software. All reads run
// against the single flat `punches` table (employee + device captured inline).

export async function summary(from: string, to: string) {
  const row = await one<{ meals: number; employees: number; devices: number }>(
    `SELECT count(*)::int AS meals,
            count(DISTINCT emp_id)::int AS employees,
            count(DISTINCT device_id)::int AS devices
       FROM punches
      WHERE punched_at >= $1 AND punched_at < $2`,
    [from, to]
  );
  return row ?? { meals: 0, employees: 0, devices: 0 };
}

export async function trend(from: string, to: string) {
  return query<{ d: string; meals: number }>(
    `SELECT to_char((punched_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS d,
            count(*)::int AS meals
       FROM punches
      WHERE punched_at >= $1 AND punched_at < $2
      GROUP BY 1 ORDER BY 1`,
    [from, to, TZ]
  );
}

// Meals grouped by raw Device ID (there is no device→cafeteria mapping anymore).
export async function byDevice(from: string, to: string) {
  return query<{ device_id: string; meals: number }>(
    `SELECT COALESCE(device_id, '—') AS device_id,
            count(*)::int AS meals
       FROM punches
      WHERE punched_at >= $1 AND punched_at < $2
      GROUP BY device_id
      ORDER BY meals DESC`,
    [from, to]
  );
}

export async function byEmployee(from: string, to: string, limit = 50, offset = 0) {
  return query<{
    emp_id: string;
    name: string;
    meals: number;
    last_seen: string | null;
    image_id: number | null;
  }>(
    `SELECT p.emp_id,
            max(p.person_name) AS name,
            count(*)::int      AS meals,
            max(p.punched_at)  AS last_seen,
            (SELECT x.id FROM punches x
              WHERE x.emp_id = p.emp_id AND x.image IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1) AS image_id
       FROM punches p
      WHERE p.punched_at >= $1 AND p.punched_at < $2
        AND p.emp_id IS NOT NULL AND p.emp_id <> ''
      GROUP BY p.emp_id
      ORDER BY meals DESC, p.emp_id
      LIMIT $3 OFFSET $4`,
    [from, to, limit, offset]
  );
}

export async function bySlot(from: string, to: string) {
  return query<{ name: string; meals: number }>(
    `SELECT s.name, count(*)::int AS meals
       FROM punches p
       JOIN meal_slots s
         ON (p.punched_at AT TIME ZONE $3)::time >= s.start_time
        AND (p.punched_at AT TIME ZONE $3)::time <  s.end_time
        AND s.active
      WHERE p.punched_at >= $1 AND p.punched_at < $2
      GROUP BY s.name
      ORDER BY meals DESC`,
    [from, to, TZ]
  );
}

export async function hourly(from: string, to: string) {
  return query<{ hour: number; meals: number }>(
    `SELECT extract(hour FROM (punched_at AT TIME ZONE $3))::int AS hour,
            count(*)::int AS meals
       FROM punches
      WHERE punched_at >= $1 AND punched_at < $2
      GROUP BY 1 ORDER BY 1`,
    [from, to, TZ]
  );
}

// Live feed row shape — read straight off the flat table (no joins). The image
// bytes are NOT selected here (they'd bloat the JSON/SSE payload); `has_image`
// tells the client whether to request /faces/<id>.
type FaceRow = {
  id: number;
  emp_id: string | null;
  name: string | null;
  device_id: string | null;
  has_image: boolean;
  punched_at: string;
};

export async function recentFaces(limit = 10) {
  return query<FaceRow>(
    `SELECT id, emp_id, person_name AS name, device_id,
            (image IS NOT NULL) AS has_image, punched_at
       FROM punches
      ORDER BY id DESC
      LIMIT $1`,
    [limit]
  );
}

export async function punchesSince(lastId: number) {
  return query<FaceRow>(
    `SELECT id, emp_id, person_name AS name, device_id,
            (image IS NOT NULL) AS has_image, punched_at
       FROM punches
      WHERE id > $1
      ORDER BY id ASC
      LIMIT 100`,
    [lastId]
  );
}

export async function maxPunchId(): Promise<number> {
  const r = await one<{ max: number | null }>(`SELECT max(id) AS max FROM punches`);
  return r?.max ?? 0;
}

export async function employeeReport(empId: string, from: string, to: string) {
  const emp = await one<{ emp_id: string; name: string; image_id: number | null }>(
    `SELECT emp_id,
            max(person_name) AS name,
            (SELECT x.id FROM punches x
              WHERE x.emp_id = $1 AND x.image IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1) AS image_id
       FROM punches
      WHERE emp_id = $1
      GROUP BY emp_id`,
    [empId]
  );
  const punches = await query<{ id: number; device_id: string | null; punched_at: string }>(
    `SELECT id, device_id, punched_at
       FROM punches
      WHERE emp_id = $1 AND punched_at >= $2 AND punched_at < $3
      ORDER BY punched_at DESC`,
    [empId, from, to]
  );
  return { emp, punches };
}

export async function slotsList() {
  return query(`SELECT * FROM meal_slots ORDER BY start_time`);
}
