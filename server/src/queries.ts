import { query, one } from "./db.js";
import { env } from "./env.js";
import { todayWindow } from "./ranges.js";

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
              WHERE x.emp_id = p.emp_id AND x.person_name IS NOT NULL
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
  meal: string | null;
  cafeteria_name: string | null;
  has_image: boolean;
  punched_at: string;
};

const FACE_COLS = `id, emp_id, person_name AS name, device_id, meal, cafeteria_name,
            (person_name IS NOT NULL AND person_name <> '') AS has_image, punched_at`;

export async function recentFaces(
  limit = 10,
  cafes: number[] | null = null,
  meal: string | null = null,
  from: string | null = null,
  to: string | null = null
) {
  return query<FaceRow>(
    `SELECT ${FACE_COLS}
       FROM punch_meals
      WHERE ($2::int[] IS NULL OR cafeteria_id = ANY($2))
        AND ($3::text IS NULL OR meal = $3)
        AND ($4::timestamptz IS NULL OR punched_at >= $4)
        AND ($5::timestamptz IS NULL OR punched_at <  $5)
      ORDER BY punched_at DESC, id DESC      -- true most-recent by event time, not insert order
      LIMIT $1`,
    [limit, cafes, meal, from, to]
  );
}

export async function punchesSince(lastId: number) {
  return query<FaceRow>(
    `SELECT ${FACE_COLS}
       FROM punch_meals
      WHERE id > $1
      ORDER BY id ASC
      LIMIT 100`,
    [lastId]
  );
}

// ---- cafeteria / meal aware dashboard queries (over the punch_meals view) ----
export async function cafeteriasList(allowed: number[] | null = null) {
  return query<{ id: number; name: string }>(
    `SELECT id, name FROM cafeterias
      WHERE active AND ($1::int[] IS NULL OR id = ANY($1))
      ORDER BY name`,
    [allowed]
  );
}

export async function summaryC(from: string, to: string, cafes: number[] | null, meal: string | null) {
  const row = await one<{ meals: number; employees: number }>(
    `SELECT count(*)::int AS meals, count(DISTINCT emp_id)::int AS employees
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR meal = $4)`,
    [from, to, cafes, meal]
  );
  return row ?? { meals: 0, employees: 0 };
}

// Per-day trend, pivoted by meal so the UI dropdown switches series client-side.
export async function trendC(from: string, to: string, cafes: number[] | null) {
  return query<{ d: string; total: number; lunch: number; dinner: number; tea: number; biscuit: number }>(
    `SELECT to_char((punched_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS d,
            count(*)::int                                  AS total,
            count(*) FILTER (WHERE meal = 'Lunch')::int    AS lunch,
            count(*) FILTER (WHERE meal = 'Dinner')::int   AS dinner,
            count(*) FILTER (WHERE meal = 'Tea')::int      AS tea,
            count(*) FILTER (WHERE meal = 'Biscuit')::int  AS biscuit
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($4::int[] IS NULL OR cafeteria_id = ANY($4))
      GROUP BY 1 ORDER BY 1`,
    [from, to, TZ, cafes]
  );
}

export async function byCafeteria(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{ name: string; meals: number }>(
    `SELECT COALESCE(cafeteria_name, 'Unmapped') AS name, count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR meal = $4)
      GROUP BY 1 ORDER BY meals DESC`,
    [from, to, cafes, meal]
  );
}

export async function byMeal(from: string, to: string, cafes: number[] | null) {
  return query<{ meal: string; meals: number }>(
    `SELECT meal, count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2 AND meal IS NOT NULL
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
      GROUP BY meal`,
    [from, to, cafes]
  );
}

export async function byDeviceC(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{ device_id: string; category: string | null; meals: number }>(
    `SELECT COALESCE(device_id, '—') AS device_id,
            max(device_category)     AS category,
            count(*)::int            AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR meal = $4)
      GROUP BY device_id ORDER BY meals DESC`,
    [from, to, cafes, meal]
  );
}

export async function hourlyC(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{ hour: number; meals: number }>(
    `SELECT extract(hour FROM (punched_at AT TIME ZONE $3))::int AS hour, count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($4::int[] IS NULL OR cafeteria_id = ANY($4))
        AND ($5::text IS NULL OR meal = $5)
      GROUP BY 1 ORDER BY 1`,
    [from, to, TZ, cafes, meal]
  );
}

// Count Tea/Snack-session meals (Tea and/or Biscuit) for the CURRENT session.
// The session counter resets 30 minutes BEFORE each Tea/Snack session starts
// (derived from the cafeteria_time_slots), NOT at midnight — so the overnight
// Tea/Snack session (e.g. 23:01→11:29) is counted as one continuous session that
// spans midnight. Counting runs from the most recent reset point (slot_start − 30m
// that has already passed, possibly yesterday's) up to now.
async function teaSessionCount(cafes: number[] | null, meals: string[]) {
  const row = await one<{ meals: number }>(
    `WITH nowist AS (SELECT (now() AT TIME ZONE $3) AS ts),
          resets AS (
            SELECT DISTINCT (start_time - interval '30 minutes') AS rt
              FROM cafeteria_time_slots
             WHERE meal = 'Tea/Snack' AND active
               AND ($1::int[] IS NULL OR cafeteria_id = ANY($1))
          ),
          cands AS (   -- today's and yesterday's occurrence of each reset point
            SELECT (d::date + r.rt) AS ts_local
              FROM resets r
              CROSS JOIN generate_series(((SELECT ts FROM nowist)::date - 1),
                                          (SELECT ts FROM nowist)::date,
                                          interval '1 day') AS d
          ),
          last_reset AS (
            SELECT max(ts_local) AS ts_local
              FROM cands WHERE ts_local <= (SELECT ts FROM nowist)
          )
     SELECT count(*)::int AS meals
       FROM punch_meals pm, last_reset lr
      WHERE lr.ts_local IS NOT NULL
        AND pm.meal = ANY($2)
        AND ($1::int[] IS NULL OR pm.cafeteria_id = ANY($1))
        AND pm.punched_at >= (lr.ts_local AT TIME ZONE $3)`,
    [cafes, meals, TZ]
  );
  return row?.meals ?? 0;
}

// Live meal counter for the kiosk. Reset behaviour per meal:
//  - Lunch / Dinner -> today's calendar-day count (one session/day, midnight reset).
//  - Tea / Biscuit  -> CURRENT Tea/Snack session count, resetting 30 min before the
//    next session and spanning midnight (see teaSessionCount).
//  - "All" + a cafeteria -> follows that cafeteria's ACTIVE slot (Tea/Snack uses the
//    session counter; Lunch/Dinner use today).
//  - "All" + all cafeterias -> today's grand total.
export async function liveMealCount(cafes: number[] | null, activeCafe: number | null, meal: string | null) {
  const today = todayWindow();

  if (meal) {
    if (meal === "Tea" || meal === "Biscuit") {
      return { count: await teaSessionCount(cafes, [meal]), label: meal };
    }
    const s = await summaryC(today.from, today.to, cafes, meal);   // Lunch / Dinner
    return { count: s.meals, label: meal };
  }

  // "All" with no single focused cafeteria -> today's total across the allowed set.
  if (activeCafe == null) {
    const s = await summaryC(today.from, today.to, cafes, null);
    return { count: s.meals, label: "All meals" };
  }

  // Which slot is live right now for the focused cafeteria? (handles windows that
  // wrap past midnight, e.g. the late Tea/Snack 23:01–11:29.)
  const active = await one<{ meal: string }>(
    `SELECT meal FROM cafeteria_time_slots
      WHERE cafeteria_id = $1 AND active
        AND (
          (start_time <= end_time AND (now() AT TIME ZONE $2)::time BETWEEN start_time AND end_time)
          OR
          (start_time >  end_time AND ((now() AT TIME ZONE $2)::time >= start_time
                                     OR (now() AT TIME ZONE $2)::time <= end_time))
        )
      ORDER BY sort
      LIMIT 1`,
    [activeCafe, TZ]
  );
  if (!active) return { count: 0, label: "No active slot" };

  // Tea/Snack -> session counter (Tea + Biscuit); Lunch/Dinner -> today.
  if (active.meal === "Tea/Snack") {
    return { count: await teaSessionCount(cafes, ["Tea", "Biscuit"]), label: active.meal };
  }
  const row = await one<{ meals: number }>(
    `SELECT count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3)) AND meal = $4`,
    [today.from, today.to, cafes, active.meal]
  );
  return { count: row?.meals ?? 0, label: active.meal };
}

export async function byEmployeeC(from: string, to: string, cafes: number[] | null, limit = 12, meal: string | null = null) {
  return query<{
    emp_id: string;
    name: string;
    meals: number;
    last_seen: string | null;
    image_id: number | null;
  }>(
    `SELECT pm.emp_id,
            max(pm.person_name) AS name,
            count(*)::int       AS meals,
            max(pm.punched_at)  AS last_seen,
            (SELECT x.id FROM punches x
              WHERE x.emp_id = pm.emp_id AND x.person_name IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1) AS image_id
       FROM punch_meals pm
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2
        AND pm.emp_id IS NOT NULL AND pm.emp_id <> ''
        AND ($3::int[] IS NULL OR pm.cafeteria_id = ANY($3))
        AND ($5::text IS NULL OR pm.meal = $5)
      GROUP BY pm.emp_id
      ORDER BY meals DESC, pm.emp_id
      LIMIT $4`,
    [from, to, cafes, limit, meal]
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
              WHERE x.emp_id = $1 AND x.person_name IS NOT NULL
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

// ---- meal/cafeteria-aware report queries (over punch_meals) ----

// Device report: one row per (device, meal). The shared Lunch/Dinner device thus
// appears twice — "113 (Lunch)" and "113 (Dinner)" — split by the time slot.
export async function byDeviceMeal(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{ device_id: string; category: string | null; meal: string | null; meals: number }>(
    `SELECT COALESCE(device_id, '—') AS device_id,
            max(device_category)     AS category,
            meal,
            count(*)::int            AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR meal = $4)
      GROUP BY device_id, meal
      ORDER BY device_id, meal NULLS LAST`,
    [from, to, cafes, meal]
  );
}

export async function employeesReportC(
  from: string, to: string, cafes: number[] | null, meal: string | null, limit = 100000
) {
  return query<{ emp_id: string; name: string; meals: number; last_seen: string | null; image_id: number | null }>(
    `SELECT pm.emp_id,
            max(pm.person_name) AS name,
            count(*)::int       AS meals,
            max(pm.punched_at)  AS last_seen,
            (SELECT x.id FROM punches x
              WHERE x.emp_id = pm.emp_id AND x.person_name IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1) AS image_id
       FROM punch_meals pm
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2
        AND pm.emp_id IS NOT NULL AND pm.emp_id <> ''
        AND ($3::int[] IS NULL OR pm.cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR pm.meal = $4)
      GROUP BY pm.emp_id
      ORDER BY meals DESC, name
      LIMIT $5`,
    [from, to, cafes, meal, limit]
  );
}

// Employee directory, optionally scoped to a set of cafeterias + meal.
//   - No search term: the top `limit` (default 120) employees BY MEAL COUNT in
//     range — i.e. who actually ate (capped list).
//   - With a search term: search the FULL employee master roster (emp_data) so
//     ANYONE can be found, even people who never punched; their meal count is the
//     scoped (cafeteria/meal) count, 0 if none.
export async function employeesDirectory(
  from: string, to: string, search: string, cafes: number[] | null, meal: string | null, limit = 120
) {
  type Row = { emp_id: string; name: string; meals: number; last_seen: string | null; image_id: number | null };

  if (search) {
    const like = `%${search}%`;
    return query<Row>(
      `SELECT ed.emp_id,
              ed.emp_name                  AS name,
              COALESCE(pm.meals, 0)        AS meals,
              pm.last_seen,
              pm.image_id
         FROM emp_data ed
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS meals,
                  max(p.punched_at) AS last_seen,
                  (SELECT x.id FROM punches x
                    WHERE x.emp_id = ed.emp_id AND x.person_name IS NOT NULL
                    ORDER BY x.punched_at DESC LIMIT 1) AS image_id
             FROM punch_meals p
            WHERE p.emp_id = ed.emp_id
              AND p.punched_at >= $1 AND p.punched_at < $2
              AND ($4::int[] IS NULL OR p.cafeteria_id = ANY($4))
              AND ($5::text  IS NULL OR p.meal = $5)
         ) pm ON TRUE
        WHERE ed.emp_id ILIKE $6 OR ed.emp_name ILIKE $6
        ORDER BY meals DESC, name
        LIMIT $3`,
      [from, to, limit, cafes, meal, like]
    );
  }

  // Default capped list — only people seen in range (ordered by meals).
  return query<Row>(
    `SELECT pm.emp_id,
            max(pm.person_name) AS name,
            count(*)::int       AS meals,
            max(pm.punched_at)  AS last_seen,
            (SELECT x.id FROM punches x
              WHERE x.emp_id = pm.emp_id AND x.person_name IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1) AS image_id
       FROM punch_meals pm
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2
        AND pm.emp_id IS NOT NULL AND pm.emp_id <> ''
        AND ($4::int[] IS NULL OR pm.cafeteria_id = ANY($4))
        AND ($5::text IS NULL OR pm.meal = $5)
      GROUP BY pm.emp_id
      ORDER BY meals DESC, name
      LIMIT $3`,
    [from, to, limit, cafes, meal]
  );
}

// Per-employee report with per-meal KPI counts (Lunch/Dinner/Tea/Biscuit) + the
// individual punches (each tagged with its meal + cafeteria).
export async function employeeReportC(
  empId: string, from: string, to: string, cafes: number[] | null, meal: string | null = null
) {
  const emp = await one<{ emp_id: string; name: string; image_id: number | null }>(
    `SELECT emp_id,
            max(person_name) AS name,
            (SELECT x.id FROM punches x
              WHERE x.emp_id = $1 AND x.person_name IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1) AS image_id
       FROM punches
      WHERE emp_id = $1
      GROUP BY emp_id`,
    [empId]
  );
  // KPI + punches scoped to the viewer's cafeteria access.
  const kpiRows = await query<{ meal: string; meals: number }>(
    `SELECT meal, count(*)::int AS meals
       FROM punch_meals
      WHERE emp_id = $1 AND punched_at >= $2 AND punched_at < $3 AND meal IS NOT NULL
        AND ($4::int[] IS NULL OR cafeteria_id = ANY($4))
      GROUP BY meal`,
    [empId, from, to, cafes]
  );
  const kpi: Record<string, number> = { Lunch: 0, Dinner: 0, Tea: 0, Biscuit: 0 };
  for (const r of kpiRows) kpi[r.meal] = r.meals;
  const punches = await query<{ id: number; device_id: string | null; meal: string | null; cafeteria_name: string | null; punched_at: string }>(
    `SELECT id, device_id, meal, cafeteria_name, punched_at
       FROM punch_meals
      WHERE emp_id = $1 AND punched_at >= $2 AND punched_at < $3
        AND ($4::int[] IS NULL OR cafeteria_id = ANY($4))
        AND ($5::text IS NULL OR meal = $5)
      ORDER BY punched_at DESC`,
    [empId, from, to, cafes, meal]
  );
  return { emp, kpi, punches };
}
