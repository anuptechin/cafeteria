import { query, one } from "./db.js";
import { env } from "./env.js";

const TZ = env.tz;

// Monitoring-only: every figure here is a meal COUNT (did this person eat?).
// No money, no contributions — this is not finance software.

export async function summary(from: string, to: string) {
  const row = await one<{ meals: number; employees: number; cafeterias: number }>(
    `SELECT count(*)::int AS meals,
            count(DISTINCT emp_id)::int AS employees,
            count(DISTINCT std_id)::int AS cafeterias
       FROM punches
      WHERE punched_at >= $1 AND punched_at < $2`,
    [from, to]
  );
  return row ?? { meals: 0, employees: 0, cafeterias: 0 };
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

export async function byCafeteria(from: string, to: string) {
  return query<{
    std_id: number;
    cafeteria_name: string;
    location: string;
    meals: number;
  }>(
    `SELECT d.std_id, d.cafeteria_name, d.location,
            count(p.id)::int AS meals
       FROM devices d
       LEFT JOIN punches p
         ON p.std_id = d.std_id AND p.punched_at >= $1 AND p.punched_at < $2
      GROUP BY d.std_id, d.cafeteria_name, d.location
      ORDER BY meals DESC`,
    [from, to]
  );
}

export async function byEmployee(from: string, to: string, limit = 50, offset = 0) {
  return query<{
    emp_id: string;
    name: string;
    department: string;
    meals: number;
    last_seen: string | null;
  }>(
    `SELECT e.emp_id, e.name, e.department,
            count(p.id)::int AS meals,
            max(p.punched_at) AS last_seen
       FROM employees e
       JOIN punches p ON p.emp_id = e.emp_id
      WHERE p.punched_at >= $1 AND p.punched_at < $2
      GROUP BY e.emp_id, e.name, e.department
      ORDER BY meals DESC, e.emp_id
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

export async function recentFaces(limit = 10) {
  return query<{
    id: number;
    emp_id: string;
    name: string;
    department: string;
    cafeteria_name: string;
    punched_at: string;
  }>(
    `SELECT p.id, p.emp_id, e.name, e.department, d.cafeteria_name, p.punched_at
       FROM punches p
       JOIN employees e ON e.emp_id = p.emp_id
       JOIN devices  d ON d.std_id = p.std_id
      ORDER BY p.id DESC
      LIMIT $1`,
    [limit]
  );
}

export async function punchesSince(lastId: number) {
  return query<{
    id: number;
    emp_id: string;
    name: string;
    department: string;
    cafeteria_name: string;
    punched_at: string;
  }>(
    `SELECT p.id, p.emp_id, e.name, e.department, d.cafeteria_name, p.punched_at
       FROM punches p
       JOIN employees e ON e.emp_id = p.emp_id
       JOIN devices  d ON d.std_id = p.std_id
      WHERE p.id > $1
      ORDER BY p.id ASC
      LIMIT 100`,
    [lastId]
  );
}

export async function maxPunchId(): Promise<number> {
  const r = await one<{ max: number | null }>(`SELECT max(id) AS max FROM punches`);
  return r?.max ?? 0;
}

export async function employeeReport(empId: string, from: string, to: string) {
  const emp = await one<{ emp_id: string; name: string; department: string }>(
    `SELECT emp_id, name, department FROM employees WHERE emp_id = $1`,
    [empId]
  );
  const punches = await query<{ id: number; cafeteria_name: string; punched_at: string }>(
    `SELECT p.id, d.cafeteria_name, p.punched_at
       FROM punches p JOIN devices d ON d.std_id = p.std_id
      WHERE p.emp_id = $1 AND p.punched_at >= $2 AND p.punched_at < $3
      ORDER BY p.punched_at DESC`,
    [empId, from, to]
  );
  return { emp, punches };
}

export async function devicesList() {
  return query(`SELECT * FROM devices ORDER BY location, cafeteria_name`);
}

export async function slotsList() {
  return query(`SELECT * FROM meal_slots ORDER BY start_time`);
}
