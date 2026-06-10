import { query, one } from "./db.js";
import { env } from "./env.js";
import { todayWindow } from "./ranges.js";

const TZ = env.tz;

// Monitoring-only: every figure here is a meal COUNT (did this person eat?).
// No money, no contributions — this is not finance software. Cafeteria/meal-aware
// reads go through the `punch_meals` view; the raw `punches` table is used only
// for the live feed and the avatar-image lookup.

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

// has_image: a camera capture exists (person_name keys the disk file) OR an
// admin uploaded a portrait (emp_photos) — /faces/:id serves the upload first.
const FACE_COLS = `id, emp_id, person_name AS name, device_id, meal, cafeteria_name,
            ((person_name IS NOT NULL AND person_name <> '')
              OR EXISTS(SELECT 1 FROM emp_photos ep WHERE ep.emp_id = punch_meals.emp_id)) AS has_image,
            punched_at`;

// Most-recent punch id that carries a captured face for an employee — the avatar
// source. Correlated subquery; `empExpr` is the (trusted, code-supplied) column
// expression to correlate against, e.g. 'pm.emp_id' or the bind param '$1'.
const latestImageId = (empExpr: string) =>
  `(SELECT x.id FROM punches x
              WHERE x.emp_id = ${empExpr} AND x.person_name IS NOT NULL
              ORDER BY x.punched_at DESC LIMIT 1)`;

// Effective-dated price versions expanded to half-open day ranges:
// each (cafeteria, meal) version covers [effective_from, next effective_from),
// so a punch is priced by the version whose range contains its punch_date. The
// price table is tiny (cafeterias × 4 meals × few edits), so this CTE + the join
// below is effectively free. Reports JOIN punch_meals → these ranges to sum cost.
// Money lives ONLY in reports; the dashboard/live counters never touch this.
const PRICE_RANGES = `price_ranges AS (
    SELECT cafeteria_id, meal, emp_paid, company_paid, effective_from,
           COALESCE(lead(effective_from) OVER (PARTITION BY cafeteria_id, meal
                                               ORDER BY effective_from),
                    DATE '9999-12-31') AS eff_to
      FROM cafeteria_meal_prices
  )`;
// Join clause that attaches the day-correct rate to each punch_meals row (aliased pm).
const PRICE_JOIN = `LEFT JOIN price_ranges pr
       ON pr.cafeteria_id = pm.cafeteria_id AND pr.meal = pm.meal
      AND pm.punch_date >= pr.effective_from AND pm.punch_date < pr.eff_to`;

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

// Per (cafeteria, meal) counts — powers the dashboard "Location Share" donut where
// each segment is e.g. "F7 Lunch" (Lunch & Dinner kept separate, not the combined
// device). Respects the meal filter like the rest of the dashboard.
export async function byCafeteriaMeal(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{ cafeteria_name: string; meal: string; meals: number }>(
    `SELECT cafeteria_name, meal, count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2
        AND meal IS NOT NULL AND cafeteria_id IS NOT NULL
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR meal = $4)
      GROUP BY cafeteria_name, meal
      ORDER BY meals DESC`,
    [from, to, cafes, meal]
  );
}

export async function byMeal(from: string, to: string, cafes: number[] | null, meal: string | null = null) {
  return query<{ meal: string; meals: number }>(
    `SELECT meal, count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2 AND meal IS NOT NULL
        AND ($3::int[] IS NULL OR cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR meal = $4)
      GROUP BY meal`,
    [from, to, cafes, meal]
  );
}

export async function byDeviceC(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{ device_id: string; category: string | null; cafeteria_name: string | null; meals: number }>(
    `SELECT COALESCE(device_id, '—') AS device_id,
            max(device_category)     AS category,
            max(cafeteria_name)      AS cafeteria_name,
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

// Count the CURRENT session's meals for a given slot, resetting 30 minutes BEFORE
// that slot starts (derived from cafeteria_time_slots), NOT at midnight — so a
// session that crosses midnight (e.g. the late Tea/Snack 23:01→11:29, or a dinner
// window that runs past 00:00) is counted as one continuous session. Counting runs
// from the most recent reset point (slot_start − 30m that has already passed,
// possibly yesterday's) up to now.
//   slotMeal   = the cafeteria_time_slots.meal whose start defines the reset point
//                ('Tea/Snack' | 'Lunch' | 'Dinner').
//   countMeals = the punch_meals.meal values tallied within the session (Tea/Snack
//                spans both 'Tea' and 'Biscuit'; Lunch/Dinner just themselves).
// The reset instant is computed as (date + start_time) − 30m on a full TIMESTAMP,
// not on a TIME — so a slot starting just after midnight (e.g. 00:15 → 23:45 the
// prior day) folds back correctly instead of wrapping within the day.
// Each cafeteria resets on ITS OWN slot start, so staggered start times across
// cafeterias (e.g. F61 Lunch 11:30 vs F6 Lunch 12:30) are each honored when the
// scope spans multiple cafeterias — every cafeteria's punches are tallied from its
// own reset, then summed (no shared cutoff that would clip the earlier cafeteria).
async function sessionMealCount(cafes: number[] | null, slotMeal: string, countMeals: string[]) {
  const row = await one<{ meals: number }>(
    `WITH nowist AS (SELECT (now() AT TIME ZONE $4) AS ts),
          starts AS (
            SELECT cafeteria_id, start_time AS st
              FROM cafeteria_time_slots
             WHERE meal = $2 AND active
               AND ($1::int[] IS NULL OR cafeteria_id = ANY($1))
          ),
          cands AS (   -- per-cafeteria reset instants (start − 30m), yesterday & today
            SELECT s.cafeteria_id,
                   ((d::date + s.st) - interval '30 minutes') AS ts_local
              FROM starts s
              CROSS JOIN generate_series(((SELECT ts FROM nowist)::date - 1),
                                          (SELECT ts FROM nowist)::date,
                                          interval '1 day') AS d
          ),
          last_reset AS (   -- the most recent reset that has passed, per cafeteria
            SELECT cafeteria_id, max(ts_local) AS ts_local
              FROM cands WHERE ts_local <= (SELECT ts FROM nowist)
              GROUP BY cafeteria_id
          )
     SELECT count(*)::int AS meals
       FROM punch_meals pm
       JOIN last_reset lr ON lr.cafeteria_id = pm.cafeteria_id
      WHERE pm.meal = ANY($3)
        AND pm.punched_at >= (lr.ts_local AT TIME ZONE $4)`,
    [cafes, slotMeal, countMeals, TZ]
  );
  return row?.meals ?? 0;
}

// Live meal counter for the kiosk. Every per-meal counter is a SESSION count that
// resets 30 min before that meal's own slot starts (see sessionMealCount), NOT at
// midnight — so sessions that cross midnight stay continuous:
//  - Lunch / Dinner -> current Lunch / Dinner session (reset 30 min before the slot).
//  - Tea / Biscuit  -> current Tea/Snack session (Tea + Biscuit), reset 30 min before.
//  - "All" + a cafeteria -> follows that cafeteria's ACTIVE slot's session counter.
//  - "All" + all cafeterias -> today's calendar-day grand total (mixed meals).
export async function liveMealCount(cafes: number[] | null, activeCafe: number | null, meal: string | null) {
  const today = todayWindow();

  if (meal) {
    if (meal === "Tea" || meal === "Biscuit") {
      return { count: await sessionMealCount(cafes, "Tea/Snack", [meal]), label: meal };
    }
    // Lunch / Dinner -> session count resetting 30 min before that meal's slot.
    return { count: await sessionMealCount(cafes, meal, [meal]), label: meal };
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

  // Every active slot is a session counter resetting 30 min before its start:
  // Tea/Snack tallies Tea + Biscuit; Lunch/Dinner tally themselves.
  const countMeals = active.meal === "Tea/Snack" ? ["Tea", "Biscuit"] : [active.meal];
  return { count: await sessionMealCount(cafes, active.meal, countMeals), label: active.meal };
}

export async function byEmployeeC(from: string, to: string, cafes: number[] | null, limit = 12, meal: string | null = null) {
  return query<{
    emp_id: string;
    name: string;
    meals: number;
    last_seen: string | null;
    image_id: number | null;
    has_photo: boolean;
  }>(
    `SELECT pm.emp_id,
            max(pm.person_name) AS name,
            count(*)::int       AS meals,
            max(pm.punched_at)  AS last_seen,
            ${latestImageId("pm.emp_id")} AS image_id,
            EXISTS(SELECT 1 FROM emp_photos ep WHERE ep.emp_id = pm.emp_id) AS has_photo
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

// ---- meal/cafeteria-aware report queries (over punch_meals) ----

// Location report: one row per (cafeteria, meal) with cost — e.g. "F7 · Lunch",
// "F7 · Dinner" kept separate (not the combined Lunch/Dinner device). Shows the
// cafeteria name instead of a raw device id.
export async function byLocationMeal(from: string, to: string, cafes: number[] | null, meal: string | null) {
  return query<{
    cafeteria_name: string; meal: string | null; meals: number;
    emp_paid: number; company_paid: number;
  }>(
    `WITH ${PRICE_RANGES}
     SELECT COALESCE(pm.cafeteria_name, 'Unmapped') AS cafeteria_name,
            pm.meal,
            count(*)::int                      AS meals,
            sum(COALESCE(pr.emp_paid, 0))::numeric     AS emp_paid,
            sum(COALESCE(pr.company_paid, 0))::numeric AS company_paid
       FROM punch_meals pm
       ${PRICE_JOIN}
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2
        AND pm.cafeteria_id IS NOT NULL
        AND ($3::int[] IS NULL OR pm.cafeteria_id = ANY($3))
        AND ($4::text IS NULL OR pm.meal = $4)
      GROUP BY pm.cafeteria_name, pm.meal
      ORDER BY pm.cafeteria_name, pm.meal NULLS LAST`,
    [from, to, cafes, meal]
  );
}

export async function employeesReportC(
  from: string, to: string, cafes: number[] | null, meal: string | null, limit = 100000
) {
  // Cost is summed server-side using each punch's day-correct rate (rates differ
  // by cafeteria AND by date), so totals are correct even when a person's meals
  // span cafeterias or a rate changed mid-range. Vendor = emp + company (client).
  return query<{
    emp_id: string; name: string; meals: number;
    emp_paid: number; company_paid: number;
    last_seen: string | null; image_id: number | null; has_photo: boolean;
  }>(
    `WITH ${PRICE_RANGES}
     SELECT pm.emp_id,
            max(pm.person_name) AS name,
            count(*)::int       AS meals,
            sum(COALESCE(pr.emp_paid, 0))::numeric     AS emp_paid,
            sum(COALESCE(pr.company_paid, 0))::numeric AS company_paid,
            max(pm.punched_at)  AS last_seen,
            ${latestImageId("pm.emp_id")} AS image_id,
            EXISTS(SELECT 1 FROM emp_photos ep WHERE ep.emp_id = pm.emp_id) AS has_photo
       FROM punch_meals pm
       ${PRICE_JOIN}
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

// Total Employee/Company cost for a scope (optionally one employee), using each
// punch's day-correct rate. NOT meal-filtered — mirrors mealKpiC so the cost tiles
// line up with the all-meals KPI breakdown shown beside them.
export async function costTotalC(
  from: string, to: string, cafes: number[] | null, empId: string | null = null
) {
  const row = await one<{ emp_paid: number; company_paid: number }>(
    `WITH ${PRICE_RANGES}
     SELECT sum(COALESCE(pr.emp_paid, 0))::numeric     AS emp_paid,
            sum(COALESCE(pr.company_paid, 0))::numeric AS company_paid
       FROM punch_meals pm
       ${PRICE_JOIN}
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2 AND pm.meal IS NOT NULL
        AND ($3::text IS NULL OR pm.emp_id = $3)
        AND ($3::text IS NOT NULL OR (pm.emp_id IS NOT NULL AND pm.emp_id <> ''))
        AND ($4::int[] IS NULL OR pm.cafeteria_id = ANY($4))`,
    [from, to, empId, cafes]
  );
  return { emp_paid: row?.emp_paid ?? 0, company_paid: row?.company_paid ?? 0 };
}

// Per-meal totals (Lunch/Dinner/Tea/Biscuit) over a range, scoped to
// cafeterias. With `empId` → one employee's breakdown (the lookup detail box);
// without → the aggregate across ALL employees (the "By Employee" header box).
// Intentionally NOT scoped to the meal filter so all meals always show.
export async function mealKpiC(
  from: string, to: string, cafes: number[] | null, empId: string | null = null
) {
  const rows = await query<{ meal: string; meals: number }>(
    `SELECT meal, count(*)::int AS meals
       FROM punch_meals
      WHERE punched_at >= $1 AND punched_at < $2 AND meal IS NOT NULL
        AND ($3::text IS NULL
             OR emp_id = $3)
        AND ($3::text IS NOT NULL
             OR (emp_id IS NOT NULL AND emp_id <> ''))
        AND ($4::int[] IS NULL OR cafeteria_id = ANY($4))
      GROUP BY meal`,
    [from, to, empId, cafes]
  );
  const kpi: Record<string, number> = { Lunch: 0, Dinner: 0, Tea: 0, Biscuit: 0 };
  for (const r of rows) kpi[r.meal] = r.meals;
  return kpi;
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
  type Row = { emp_id: string; name: string; meals: number; last_seen: string | null; image_id: number | null; has_photo: boolean };

  if (search) {
    const like = `%${search}%`;
    return query<Row>(
      `SELECT ed.emp_id,
              ed.emp_name                  AS name,
              COALESCE(pm.meals, 0)        AS meals,
              pm.last_seen,
              pm.image_id,
              EXISTS(SELECT 1 FROM emp_photos ep WHERE ep.emp_id = ed.emp_id) AS has_photo
         FROM emp_data ed
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS meals,
                  max(p.punched_at) AS last_seen,
                  ${latestImageId("ed.emp_id")} AS image_id
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
            ${latestImageId("pm.emp_id")} AS image_id,
            EXISTS(SELECT 1 FROM emp_photos ep WHERE ep.emp_id = pm.emp_id) AS has_photo
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
  const emp = await one<{ emp_id: string; name: string; image_id: number | null; has_photo: boolean }>(
    `SELECT emp_id,
            max(person_name) AS name,
            ${latestImageId("$1")} AS image_id,
            EXISTS(SELECT 1 FROM emp_photos ep WHERE ep.emp_id = $1) AS has_photo
       FROM punches
      WHERE emp_id = $1
      GROUP BY emp_id`,
    [empId]
  );
  // KPI + cost + punches scoped to the viewer's cafeteria access. KPI and cost are
  // all-meals (not meal-filtered) so the cost tiles match the per-meal KPI tiles.
  const kpi = await mealKpiC(from, to, cafes, empId);
  const cost = await costTotalC(from, to, cafes, empId);
  const punches = await query<{ id: number; device_id: string | null; meal: string | null; cafeteria_name: string | null; punched_at: string }>(
    `SELECT id, device_id, meal, cafeteria_name, punched_at
       FROM punch_meals
      WHERE emp_id = $1 AND punched_at >= $2 AND punched_at < $3
        AND ($4::int[] IS NULL OR cafeteria_id = ANY($4))
        AND ($5::text IS NULL OR meal = $5)
      ORDER BY punched_at DESC`,
    [empId, from, to, cafes, meal]
  );
  return { emp, kpi, cost, punches };
}

// Detailed export source (XLSX): one grouped row per (employee, meal, day) with
// the day-correct cost. The workbook builder pivots this into an Employees summary
// sheet + one employee×date grid sheet per meal type. Scoped to cafeterias + range.
export type ExportDetailRow = {
  emp_id: string; name: string; cafeteria_id: number; cafeteria_name: string;
  meal: string; d: string; cnt: number; emp_paid: number; company_paid: number;
};
export async function exportDetail(from: string, to: string, cafes: number[] | null) {
  return query<ExportDetailRow>(
    `WITH ${PRICE_RANGES}
     SELECT pm.emp_id,
            max(pm.person_name)                     AS name,
            pm.cafeteria_id,
            pm.cafeteria_name,
            pm.meal,
            to_char(pm.punch_date, 'YYYY-MM-DD')    AS d,
            count(*)::int                           AS cnt,
            sum(COALESCE(pr.emp_paid, 0))::numeric     AS emp_paid,
            sum(COALESCE(pr.company_paid, 0))::numeric AS company_paid
       FROM punch_meals pm
       ${PRICE_JOIN}
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2
        AND pm.emp_id IS NOT NULL AND pm.emp_id <> '' AND pm.meal IS NOT NULL
        AND ($3::int[] IS NULL OR pm.cafeteria_id = ANY($3))
      GROUP BY pm.emp_id, pm.cafeteria_id, pm.cafeteria_name, pm.meal, pm.punch_date
      ORDER BY pm.emp_id, pm.cafeteria_name, pm.punch_date`,
    [from, to, cafes]
  );
}

// ---- Vendor/Company SETTLEMENT report (PDF source) ----
// One section per cafeteria: day-wise meal counts + day-correct cost, the
// cafeteria's period totals, and its current rate card. NO employee/device detail
// (this is a billing document). Day-wise rows feed both the table and the 4-line
// (Lunch/Dinner/Tea/Biscuit) trend chart. All money uses each day's effective rate.
export type SettlementDay = {
  d: string; lunch: number; dinner: number; tea: number; biscuit: number;
  total: number; emp_paid: number; company_paid: number; vendor: number;
};
export async function settlementReport(from: string, to: string, cafes: number[] | null) {
  const rows = await query<{
    cafeteria_id: number; cafeteria_name: string; d: string;
    lunch: number; dinner: number; tea: number; biscuit: number; total: number;
    emp_paid: number; company_paid: number;
  }>(
    `WITH ${PRICE_RANGES}
     SELECT pm.cafeteria_id, pm.cafeteria_name,
            to_char(pm.punch_date, 'YYYY-MM-DD')               AS d,
            count(*) FILTER (WHERE pm.meal = 'Lunch')::int      AS lunch,
            count(*) FILTER (WHERE pm.meal = 'Dinner')::int     AS dinner,
            count(*) FILTER (WHERE pm.meal = 'Tea')::int        AS tea,
            count(*) FILTER (WHERE pm.meal = 'Biscuit')::int    AS biscuit,
            count(*)::int                                       AS total,
            sum(COALESCE(pr.emp_paid, 0))::numeric             AS emp_paid,
            sum(COALESCE(pr.company_paid, 0))::numeric         AS company_paid
       FROM punch_meals pm
       ${PRICE_JOIN}
      WHERE pm.punched_at >= $1 AND pm.punched_at < $2
        AND pm.cafeteria_id IS NOT NULL AND pm.meal IS NOT NULL
        AND ($3::int[] IS NULL OR pm.cafeteria_id = ANY($3))
      GROUP BY pm.cafeteria_id, pm.cafeteria_name, pm.punch_date
      ORDER BY pm.cafeteria_name, pm.punch_date`,
    [from, to, cafes]
  );

  // Current effective rate card per cafeteria × meal (for the transparency footer).
  const rateRows = await query<{ cafeteria_id: number; meal: string; emp_paid: number; company_paid: number }>(
    `SELECT DISTINCT ON (cafeteria_id, meal) cafeteria_id, meal, emp_paid, company_paid
       FROM cafeteria_meal_prices
      WHERE effective_from <= (now() AT TIME ZONE $1)::date
        AND ($2::int[] IS NULL OR cafeteria_id = ANY($2))
      ORDER BY cafeteria_id, meal, effective_from DESC`,
    [TZ, cafes]
  );

  type Cafe = {
    id: number; name: string; days: SettlementDay[];
    totals: { lunch: number; dinner: number; tea: number; biscuit: number; meals: number; emp_paid: number; company_paid: number; vendor: number };
    rates: { meal: string; emp_paid: number; company_paid: number }[];
  };
  const byId = new Map<number, Cafe>();
  for (const r of rows) {
    let c = byId.get(r.cafeteria_id);
    if (!c) {
      c = { id: r.cafeteria_id, name: r.cafeteria_name, days: [],
            totals: { lunch: 0, dinner: 0, tea: 0, biscuit: 0, meals: 0, emp_paid: 0, company_paid: 0, vendor: 0 }, rates: [] };
      byId.set(r.cafeteria_id, c);
    }
    const vendor = r.emp_paid + r.company_paid;
    c.days.push({ d: r.d, lunch: r.lunch, dinner: r.dinner, tea: r.tea, biscuit: r.biscuit,
                  total: r.total, emp_paid: r.emp_paid, company_paid: r.company_paid, vendor });
    const t = c.totals;
    t.lunch += r.lunch; t.dinner += r.dinner; t.tea += r.tea; t.biscuit += r.biscuit; t.meals += r.total;
    t.emp_paid += r.emp_paid; t.company_paid += r.company_paid; t.vendor += vendor;
  }
  for (const rr of rateRows) byId.get(rr.cafeteria_id)?.rates.push({ meal: rr.meal, emp_paid: rr.emp_paid, company_paid: rr.company_paid });

  const cafeterias = [...byId.values()];
  const grand = cafeterias.reduce(
    (a, c) => ({ meals: a.meals + c.totals.meals, emp_paid: a.emp_paid + c.totals.emp_paid,
                 company_paid: a.company_paid + c.totals.company_paid, vendor: a.vendor + c.totals.vendor }),
    { meals: 0, emp_paid: 0, company_paid: 0, vendor: 0 }
  );
  return { cafeterias, grand };
}
