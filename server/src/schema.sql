-- ============================================================
--  Canteen Management — schema
--  Mirrors the real Hikvision punch export as ONE flat table:
--    punches(emp_id, person_name, first/last, date/time, device_id, image)
--  plus meal_slots, users/audit (RBAC) and a derived employees view.
-- ============================================================

-- App is single-region (India). Make this database interpret timezone-less input
-- and display timestamps as Asia/Kolkata (IST). The external punch push sends
-- "Date and Time" WITHOUT an offset, so the session timezone decides what instant
-- it means — without this it would be read as UTC and land 5h30m off. Persisted on
-- the database (survives restarts); applies to sessions opened after this runs.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Kolkata');
END $$;

-- Single, denormalized scan/punch table. Mirrors the Hikvision punch/access-event
-- export — every meal (face scan) is one row, with the person + device captured
-- inline. Rows are inserted externally (Hikvision / ingestion); the app reads only.
--   punched_at  : authoritative event instant ("Date and Time", timestamptz).
--   punch_date / punch_time : that instant split into local (Asia/Kolkata) date
--     and time of day, maintained by trigger — convenient for grouping/filtering
--     reports by calendar day or meal time without re-deriving the conversion.
--   image       : "Images" — raw face-image bytes (JPEG/PNG) synced inline.
CREATE TABLE IF NOT EXISTS punches (
  id          BIGSERIAL   PRIMARY KEY,
  emp_id      TEXT,                         -- Employee ID
  person_name TEXT,                         -- Person Name
  first_name  TEXT,                         -- First Name
  last_name   TEXT,                         -- Last Name
  punched_at  TIMESTAMPTZ NOT NULL,         -- Date and Time
  punch_date  DATE,                         -- Date
  punch_time  TIME,                         -- Time
  device_id   TEXT,                         -- Device ID
  image       BYTEA                         -- Images (raw image bytes)
);

-- Idempotent for existing databases (CREATE TABLE IF NOT EXISTS skips columns).
ALTER TABLE punches ADD COLUMN IF NOT EXISTS person_name TEXT;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS first_name  TEXT;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS last_name   TEXT;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS punch_date  DATE;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS punch_time  TIME;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS device_id   TEXT;
ALTER TABLE punches ADD COLUMN IF NOT EXISTS image       BYTEA;
-- Frozen meal classification ('Lunch'|'Dinner'|'Tea'|'Biscuit'|NULL), stamped on
-- the row at INSERT by the dedup trigger from the slot windows live AT THAT MOMENT.
-- Stored (not derived at read time) so editing a cafeteria's time-slots later never
-- reclassifies past punches — history is immutable; only new scans use new windows.
ALTER TABLE punches ADD COLUMN IF NOT EXISTS meal        TEXT;
-- If an older run created `image` as TEXT, migrate it to BYTEA (raw image bytes).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'punches'
       AND column_name = 'image' AND data_type <> 'bytea'
  ) THEN
    EXECUTE 'ALTER TABLE punches ALTER COLUMN image TYPE bytea USING image::bytea';
  END IF;
END $$;

-- ---- Heal databases created under the old 3-table model ----------------------
-- Old shape: punches → employees(emp_id) + devices(std_id), with emp_id/std_id
-- NOT NULL FKs. Now everything is inline on punches. These steps are idempotent
-- and no-ops on a fresh database.
-- Drop the old `employees` ONLY if it is a real table (a prior run may have already
-- replaced it with the view below — in which case CREATE OR REPLACE VIEW handles it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'employees' AND table_type = 'BASE TABLE'
  ) THEN
    EXECUTE 'DROP TABLE employees CASCADE';   -- also drops the old FK on punches.emp_id
  END IF;
END $$;
DROP TABLE IF EXISTS devices CASCADE;          -- also drops the old FK on punches.std_id
-- Old per-event linkage columns/indexes are gone; the unique guard is rebuilt on device_id.
ALTER TABLE punches DROP COLUMN IF EXISTS std_id;
ALTER TABLE punches ALTER COLUMN emp_id DROP NOT NULL;
DROP INDEX IF EXISTS idx_punches_std;
DROP INDEX IF EXISTS idx_punches_std_time;
DROP INDEX IF EXISTS uq_punch;                 -- recreated below over (emp_id, device_id, punched_at)

-- Derive punch_date/punch_time from punched_at in the app timezone. A trigger is
-- used rather than GENERATED columns because AT TIME ZONE is STABLE, not IMMUTABLE.
CREATE OR REPLACE FUNCTION punches_set_local_datetime() RETURNS trigger AS $$
BEGIN
  -- The punch source (HikCentral) sends local IST wall-clock WITHOUT an offset,
  -- so Postgres parses it using the INSERTING SESSION's timezone — which has
  -- changed under us before (a reconnect flipped UTC→IST and every punch landed
  -- 5h30m in the past, so the off-timeline guard dropped all Lunch/Dinner scans).
  -- Deterministic re-anchor: undo exactly the label the session applied
  -- (current_setting('TimeZone') IS that session's zone — this recovers the
  -- wall-clock the device sent, for ANY session timezone and ANY push delay),
  -- then re-anchor that wall-clock as Asia/Kolkata. On a session already running
  -- Asia/Kolkata (the database default) this is a no-op, so manual psql inserts
  -- and the punches_rejected recovery replay stay correct.
  IF TG_OP = 'INSERT' THEN
    NEW.punched_at := (NEW.punched_at AT TIME ZONE current_setting('TimeZone'))
                      AT TIME ZONE 'Asia/Kolkata';
  END IF;
  NEW.punch_date := (NEW.punched_at AT TIME ZONE 'Asia/Kolkata')::date;
  NEW.punch_time := (NEW.punched_at AT TIME ZONE 'Asia/Kolkata')::time;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_punches_local_datetime
  BEFORE INSERT OR UPDATE OF punched_at ON punches
  FOR EACH ROW EXECUTE FUNCTION punches_set_local_datetime();

-- Drop diagnostics. Every BEFORE-INSERT trigger that silently discards a punch
-- (RETURN NULL) first records WHAT it dropped and WHY here — so "HikCentral says
-- sent OK but nothing landed" is visible instead of a black hole. Reasons:
--   'duplicate'                  exact re-send of a scan already held
--   'off-timeline'               mapped device scanned outside every valid window
--   'already-had-meal-this-slot' second Lunch/Dinner scan inside the same slot
--   '1min-repeat'                Tea/Biscuit repeat within the 1-minute guard
CREATE TABLE IF NOT EXISTS punches_rejected (
  id         BIGSERIAL   PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),   -- when the drop happened
  emp_id     TEXT,
  device_id  TEXT,
  punched_at TIMESTAMPTZ,                          -- the event instant as received
  reason     TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_punches_rejected_at ON punches_rejected (at DESC);

-- Idempotent ingestion. The external push (HikCentral "Database Synchronization"
-- with "Auto Push Failed Record" on) re-sends already-synced rows; without this
-- each repeat would raise a duplicate-key error on uq_punch, which HikCentral
-- treats as a failure and retries forever. Skip a scan we already hold (same
-- emp_id + device_id + punched_at) silently — the INSERT succeeds with 0 rows so
-- the pusher sees success. uq_punch remains the hard backstop. This trigger name
-- sorts before trg_punches_local_datetime, so it runs first and short-circuits.
CREATE OR REPLACE FUNCTION punches_skip_duplicate() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM punches
     WHERE emp_id    IS NOT DISTINCT FROM NEW.emp_id
       AND device_id IS NOT DISTINCT FROM NEW.device_id
       AND punched_at = NEW.punched_at
  ) THEN
    INSERT INTO punches_rejected (emp_id, device_id, punched_at, reason)
    VALUES (NEW.emp_id, NEW.device_id, NEW.punched_at, 'duplicate');
    RETURN NULL;          -- already recorded this scan; skip silently
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_punches_dedup
  BEFORE INSERT ON punches
  FOR EACH ROW EXECUTE FUNCTION punches_skip_duplicate();

-- Meal-aware de-duplication guard. The rule depends on the device's category
-- (see cafeteria_devices) and the configured time_slots:
--   * Lunch / Dinner devices  -> ONE meal per person for the WHOLE slot. A repeat
--       scan anywhere inside today's lunch (or dinner) window is dropped.
--   * Tea / Biscuit (and any unmapped device) -> rapid-repeat guard: a repeat scan
--       by the same person on the SAME category within 1 minute is dropped.
-- Runs AFTER trg_punches_local_datetime (name sorts later) so punched_at is the
-- final re-anchored IST instant. Identified employees only; NULL/blank emp_id
-- (unrecognised faces) are never collapsed together.
CREATE OR REPLACE FUNCTION punches_skip_rapid_repeat() RETURNS trigger AS $$
DECLARE
  dev_category  text;
  dev_cafeteria integer;
  local_ts      timestamp;
  local_time    time;
  local_date    date;
  slot          record;
  win_start     timestamptz;
  win_end       timestamptz;
BEGIN
  local_ts   := NEW.punched_at AT TIME ZONE 'Asia/Kolkata';
  local_time := local_ts::time;
  local_date := local_ts::date;

  SELECT category, cafeteria_id INTO dev_category, dev_cafeteria
    FROM cafeteria_devices WHERE device_id = NEW.device_id;

  -- Off-timeline guard: a scan on a MAPPED device that falls OUTSIDE this
  -- cafeteria's valid meal windows is ignored entirely (not recorded). A
  -- Lunch/Dinner device is valid only inside a once_per_slot window; a Tea/
  -- Biscuit device only inside a Tea/Snack window. Windows may wrap midnight.
  IF dev_category IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM cafeteria_time_slots s
       WHERE s.cafeteria_id = dev_cafeteria AND s.active
         AND (CASE WHEN dev_category = 'lunch_dinner'
                   THEN s.dedup_mode = 'once_per_slot'
                   ELSE s.meal = 'Tea/Snack' END)
         AND ((s.start_time <= s.end_time AND local_time BETWEEN s.start_time AND s.end_time)
           OR (s.start_time >  s.end_time AND (local_time >= s.start_time OR local_time <= s.end_time)))
    ) THEN
      INSERT INTO punches_rejected (emp_id, device_id, punched_at, reason)
      VALUES (NEW.emp_id, NEW.device_id, NEW.punched_at, 'off-timeline');
      RETURN NULL;     -- outside any valid meal window for this device → drop
    END IF;
  END IF;

  -- Freeze the meal classification onto the row NOW, from the windows in effect at
  -- this instant. Mirrors the punch_meals derivation but is computed once and
  -- stored, so a later slot edit can never rewrite this punch's meal.
  IF dev_category = 'tea' THEN
    NEW.meal := 'Tea';
  ELSIF dev_category = 'biscuits' THEN
    NEW.meal := 'Biscuit';
  ELSIF dev_category = 'lunch_dinner' THEN
    SELECT s.meal INTO NEW.meal
      FROM cafeteria_time_slots s
     WHERE s.cafeteria_id = dev_cafeteria AND s.dedup_mode = 'once_per_slot' AND s.active
       AND local_time BETWEEN s.start_time AND s.end_time
     ORDER BY s.sort LIMIT 1;
  ELSE
    NEW.meal := NULL;   -- unmapped device
  END IF;

  -- De-duplication below applies to identified employees only.
  IF NEW.emp_id IS NULL OR NEW.emp_id = '' THEN
    RETURN NEW;
  END IF;

  -- Lunch / Dinner: one punch per person across the whole slot window, using
  -- THIS cafeteria's configured slots.
  IF dev_category = 'lunch_dinner' THEN
    FOR slot IN
      SELECT start_time, end_time FROM cafeteria_time_slots
       WHERE cafeteria_id = dev_cafeteria AND dedup_mode = 'once_per_slot' AND active
    LOOP
      IF local_time >= slot.start_time AND local_time <= slot.end_time THEN
        win_start := (local_date + slot.start_time) AT TIME ZONE 'Asia/Kolkata';
        win_end   := (local_date + slot.end_time)   AT TIME ZONE 'Asia/Kolkata';
        IF EXISTS (
          SELECT 1 FROM punches p
            JOIN cafeteria_devices d
              ON d.device_id = p.device_id
             AND d.category = 'lunch_dinner'
             AND d.cafeteria_id = dev_cafeteria
           WHERE p.emp_id = NEW.emp_id
             AND p.punched_at >= win_start AND p.punched_at <= win_end
        ) THEN
          INSERT INTO punches_rejected (emp_id, device_id, punched_at, reason)
          VALUES (NEW.emp_id, NEW.device_id, NEW.punched_at, 'already-had-meal-this-slot');
          RETURN NULL;        -- already had this meal in this slot today
        END IF;
        RETURN NEW;           -- first punch of the slot — keep it
      END IF;
    END LOOP;
  END IF;

  -- Tea / Biscuit / unmapped: drop a repeat by the same person on the same
  -- device category within 1 minute.
  IF EXISTS (
    SELECT 1 FROM punches p
      LEFT JOIN cafeteria_devices d ON d.device_id = p.device_id
     WHERE p.emp_id = NEW.emp_id
       AND COALESCE(d.category, '') = COALESCE(dev_category, '')
       AND p.punched_at BETWEEN NEW.punched_at - interval '1 minute'
                            AND NEW.punched_at + interval '1 minute'
  ) THEN
    INSERT INTO punches_rejected (emp_id, device_id, punched_at, reason)
    VALUES (NEW.emp_id, NEW.device_id, NEW.punched_at, '1min-repeat');
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_punches_window_dedup
  BEFORE INSERT ON punches
  FOR EACH ROW EXECUTE FUNCTION punches_skip_rapid_repeat();

-- Backfill any rows that predate the columns/trigger.
UPDATE punches
   SET punch_date = (punched_at AT TIME ZONE 'Asia/Kolkata')::date,
       punch_time = (punched_at AT TIME ZONE 'Asia/Kolkata')::time
 WHERE punch_date IS NULL OR punch_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_punches_punched_at ON punches (punched_at DESC);
CREATE INDEX IF NOT EXISTS idx_punches_punch_date ON punches (punch_date);
CREATE INDEX IF NOT EXISTS idx_punches_emp        ON punches (emp_id);
CREATE INDEX IF NOT EXISTS idx_punches_device     ON punches (device_id);
CREATE INDEX IF NOT EXISTS idx_punches_device_time ON punches (device_id, punched_at DESC);
-- Speeds the "latest face image for an employee" lookup used across reports.
CREATE INDEX IF NOT EXISTS idx_punches_emp_named ON punches (emp_id, punched_at DESC) WHERE person_name IS NOT NULL;
-- Speeds the per-employee range roll-ups (directory / reports group by emp over a window).
CREATE INDEX IF NOT EXISTS idx_punches_emp_time ON punches (emp_id, punched_at);
-- Guard against duplicate identical scans.
CREATE UNIQUE INDEX IF NOT EXISTS uq_punch ON punches (emp_id, device_id, punched_at);

-- Derived employee directory — a read-only roll-up of the punch table keyed by
-- Employee ID (no separate employees master anymore).
CREATE OR REPLACE VIEW employees AS
SELECT emp_id,
       max(person_name) AS name,
       count(*)         AS meals,
       max(punched_at)  AS last_seen
  FROM punches
 WHERE emp_id IS NOT NULL AND emp_id <> ''
 GROUP BY emp_id;

-- ------------------------------------------------------------------
-- Employee master directory, imported from the Hikvision "Person
-- Information" export (Emp_ID, Emp_Name, Department). This is the
-- authoritative roster (every enrolled person), independent of whether
-- they have punched — unlike the derived `employees` view above which
-- only rolls up people seen in `punches`. Loaded by db:import-emp.
CREATE TABLE IF NOT EXISTS emp_data (
  emp_id     TEXT PRIMARY KEY,   -- "Emp_ID"     (column A)
  emp_name   TEXT,               -- "Emp_Name"   (column B)
  department TEXT                -- "Department" (column C)
);

CREATE INDEX IF NOT EXISTS idx_emp_data_department ON emp_data (department);

-- Meal slots (used to label/filter punches: Breakfast / Lunch / Tea / Dinner).
CREATE TABLE IF NOT EXISTS meal_slots (
  id         SERIAL  PRIMARY KEY,
  name       TEXT    NOT NULL,
  start_time TIME    NOT NULL,
  end_time   TIME    NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- Default slots, seeded once (replaces what the old seed script did). Idempotent:
-- only inserts when the table is empty, so manual edits are never clobbered.
INSERT INTO meal_slots (name, start_time, end_time)
SELECT v.n, v.s::time, v.e::time
  FROM (VALUES
    ('Breakfast', '08:00', '10:00'),
    ('Lunch',     '12:30', '15:00'),
    ('Tea',       '16:00', '17:30'),
    ('Dinner',    '19:30', '22:30')
  ) AS v(n, s, e)
 WHERE NOT EXISTS (SELECT 1 FROM meal_slots);

-- ============================================================
--  Cafeterias, their devices, and per-cafeteria meal windows.
--    A "meal" is one face scan on a device. Every device belongs to exactly
--    one cafeteria AND one fixed meal category (lunch_dinner | tea | biscuits) —
--    e.g. the screenshot's "Tea: 121 & 122" is two device rows, same category.
--    Reports roll punches up by joining punches.device_id -> devices; the devices
--    table is tiny (dozens of rows) so Postgres keeps it cached and the join is
--    effectively free. Supersedes the time-only meal_slots concept above.
-- ============================================================
CREATE TABLE IF NOT EXISTS cafeterias (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,      -- e.g. "F61"
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Maps a raw Device ID (from the punch feed) to its cafeteria + meal category.
-- NB: named cafeteria_devices, NOT "devices" — the legacy heal block above drops
-- a table literally called "devices" on every boot, which would wipe this one.
CREATE TABLE IF NOT EXISTS cafeteria_devices (
  device_id    TEXT    PRIMARY KEY,            -- raw "Device ID" on the punch (e.g. "121")
  cafeteria_id INTEGER NOT NULL REFERENCES cafeterias(id) ON DELETE CASCADE,
  category     TEXT    NOT NULL CHECK (category IN ('lunch_dinner','tea','biscuits')),
  label        TEXT,                           -- optional human label
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cafe_devices_cafeteria ON cafeteria_devices (cafeteria_id);
CREATE INDEX IF NOT EXISTS idx_cafe_devices_category  ON cafeteria_devices (category);

-- The previous "per-category meal window" table is replaced by cafeteria_time_slots
-- below. Drop it if an earlier version created it.
DROP TABLE IF EXISTS cafeteria_meal_windows;

-- Per-cafeteria meal time-slots. Each cafeteria has its own editable slots; they
-- all start from the same defaults (seeded by seed_cafeteria_time_slots) but can
-- be tuned per cafeteria from the UI.
--   dedup_mode 'once_per_slot' (Lunch / Dinner): one meal per person across the
--     WHOLE window, per calendar day.
--   dedup_mode '1min' (Tea / Snack): repeat within 1 minute is dropped. The late
--     Tea/Snack slot (e.g. 23:01–11:29) crosses midnight; because counts are by
--     IST calendar day and this is a 1-minute guard, the count resets next day.
CREATE TABLE IF NOT EXISTS cafeteria_time_slots (
  id           SERIAL  PRIMARY KEY,
  cafeteria_id INTEGER NOT NULL REFERENCES cafeterias(id) ON DELETE CASCADE,
  meal         TEXT    NOT NULL,                  -- 'Lunch' | 'Dinner' | 'Tea/Snack'
  start_time   TIME    NOT NULL,
  end_time     TIME    NOT NULL,
  dedup_mode   TEXT    NOT NULL CHECK (dedup_mode IN ('once_per_slot','1min')),
  sort         INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_cafe_slots_cafeteria ON cafeteria_time_slots (cafeteria_id);
-- Speeds the punch_meals Lunch/Dinner slot resolution (filtered per cafeteria + mode).
CREATE INDEX IF NOT EXISTS idx_cafe_slots_lookup ON cafeteria_time_slots (cafeteria_id, dedup_mode);

-- Seed the default slot set for one cafeteria (idempotent per cafeteria).
CREATE OR REPLACE FUNCTION seed_cafeteria_time_slots(p_cafeteria integer) RETURNS void AS $$
  INSERT INTO cafeteria_time_slots (cafeteria_id, meal, start_time, end_time, dedup_mode, sort)
  SELECT p_cafeteria, v.meal, v.s::time, v.e::time, v.mode, v.sort
    FROM (VALUES
      ('Lunch',     '11:30','15:00','once_per_slot', 1),
      ('Tea/Snack', '15:01','19:30','1min',          2),
      ('Dinner',    '20:00','23:00','once_per_slot', 3),
      ('Tea/Snack', '23:01','11:29','1min',          4)
    ) AS v(meal, s, e, mode, sort)
   WHERE NOT EXISTS (SELECT 1 FROM cafeteria_time_slots WHERE cafeteria_id = p_cafeteria);
$$ LANGUAGE sql;

-- Seed the four cafeterias from the configuration sheet, with their devices and
-- default slots. Idempotent: only runs when no cafeteria exists yet, so edits/
-- additions made later from the UI are never clobbered.
DO $$
DECLARE
  cfg     jsonb := '[
    {"name":"F61","lunch_dinner":["111"],"tea":["121","122"],"biscuits":["141"]},
    {"name":"F6", "lunch_dinner":["112"],"tea":["123","124"],"biscuits":["142"]},
    {"name":"F7", "lunch_dinner":["113"],"tea":["125","126"],"biscuits":["143"]},
    {"name":"G15","lunch_dinner":["114"],"tea":["127","128"],"biscuits":["144"]}
  ]'::jsonb;
  c       jsonb;
  cid     integer;
  cat     text;
  dev     text;
BEGIN
  IF EXISTS (SELECT 1 FROM cafeterias) THEN RETURN; END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(cfg) LOOP
    INSERT INTO cafeterias (name) VALUES (c->>'name') RETURNING id INTO cid;
    FOREACH cat IN ARRAY ARRAY['lunch_dinner','tea','biscuits'] LOOP
      FOR dev IN SELECT jsonb_array_elements_text(c->cat) LOOP
        INSERT INTO cafeteria_devices (device_id, cafeteria_id, category) VALUES (dev, cid, cat)
          ON CONFLICT (device_id) DO NOTHING;
      END LOOP;
    END LOOP;
    PERFORM seed_cafeteria_time_slots(cid);
  END LOOP;
END $$;

-- Backfill default slots for any cafeteria that has none yet (e.g. created before
-- this feature existed).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM cafeterias c
            WHERE NOT EXISTS (SELECT 1 FROM cafeteria_time_slots s WHERE s.cafeteria_id = c.id)
  LOOP
    PERFORM seed_cafeteria_time_slots(r.id);
  END LOOP;
END $$;

-- ============================================================
--  Per-cafeteria, per-meal PRICING (Reports only — dashboard/live stay
--  count-only). Each (cafeteria, meal) keeps a HISTORY of rate versions; the
--  rate for any given day is the latest version whose effective_from <= that day.
--  Only Employee Paid + Company Paid are stored; Vendor = their sum (never stored).
--  Editing a price inserts a NEW version effective TODAY, so past reports keep the
--  rate that applied then — history is immutable, exactly like the slot freeze.
-- ============================================================
CREATE TABLE IF NOT EXISTS cafeteria_meal_prices (
  id             SERIAL        PRIMARY KEY,
  cafeteria_id   INTEGER       NOT NULL REFERENCES cafeterias(id) ON DELETE CASCADE,
  meal           TEXT          NOT NULL CHECK (meal IN ('Lunch','Dinner','Tea','Biscuit')),
  emp_paid       NUMERIC(10,2) NOT NULL DEFAULT 0,
  company_paid   NUMERIC(10,2) NOT NULL DEFAULT 0,
  effective_from DATE          NOT NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by     TEXT,
  UNIQUE (cafeteria_id, meal, effective_from)
);
-- Resolves "rate effective on day X" — newest effective_from <= X, in one index hit.
CREATE INDEX IF NOT EXISTS idx_cafe_prices_lookup
  ON cafeteria_meal_prices (cafeteria_id, meal, effective_from DESC);

-- Seed a baseline rate card effective from the far past (so ALL existing history is
-- covered at the original sheet rates) for every cafeteria × meal that has none yet.
-- Idempotent: a meal that already has any version is left untouched.
INSERT INTO cafeteria_meal_prices (cafeteria_id, meal, emp_paid, company_paid, effective_from, created_by)
SELECT c.id, v.meal, v.emp, v.co, DATE '2000-01-01', 'system'
  FROM cafeterias c
  CROSS JOIN (VALUES
    ('Lunch',   27.5, 32.5),
    ('Dinner',  27.5, 32.5),
    ('Tea',      3.5,  3.5),
    ('Biscuit',  2.5,  2.5)
  ) AS v(meal, emp, co)
 WHERE NOT EXISTS (
   SELECT 1 FROM cafeteria_meal_prices p WHERE p.cafeteria_id = c.id AND p.meal = v.meal
 );

-- One-time backfill of the frozen meal for rows that predate the column (meal IS
-- NULL on a MAPPED device). Rows already classified (non-NULL) are NEVER touched
-- again, so a server restart cannot rewrite history. Uses the CURRENT slots as the
-- only available reference for old data — identical to what the view derived before.
UPDATE punches p
   SET meal = CASE
     WHEN d.category = 'tea'      THEN 'Tea'
     WHEN d.category = 'biscuits' THEN 'Biscuit'
     WHEN d.category = 'lunch_dinner' THEN (
       SELECT s.meal FROM cafeteria_time_slots s
        WHERE s.cafeteria_id = d.cafeteria_id AND s.dedup_mode = 'once_per_slot' AND s.active
          AND (p.punched_at AT TIME ZONE 'Asia/Kolkata')::time BETWEEN s.start_time AND s.end_time
        ORDER BY s.sort LIMIT 1)
   END
  FROM cafeteria_devices d
 WHERE d.device_id = p.device_id
   AND p.meal IS NULL;

-- Classified punch view: every scan tagged with its cafeteria and FROZEN meal.
-- Meal is read straight from punches.meal (stamped at insert), NOT re-derived — so
-- the view is a plain join (fast) and slot edits never reclassify history. The
-- cafeteria name/category still reflect the device's CURRENT mapping.
-- Dropped first: CREATE OR REPLACE VIEW cannot add/reorder columns in the middle
-- of an existing view, so a plain replace fails once the column set changes.
DROP VIEW IF EXISTS punch_meals;
CREATE VIEW punch_meals AS
SELECT
  p.id, p.emp_id, p.person_name, p.device_id, p.punched_at, p.punch_date,
  d.cafeteria_id,
  c.name     AS cafeteria_name,
  d.category AS device_category,
  p.meal     AS meal
FROM punches p
LEFT JOIN cafeteria_devices d ON d.device_id = p.device_id
LEFT JOIN cafeterias c        ON c.id = d.cafeteria_id;

-- ============================================================
--  Auth & access control (RBAC)
--    role 'super_admin'      — reserved, exactly one, can never be deleted.
--    role 'admin'            — full access except the audit log.
--    role 'hr_manager'       — everything except user management + audit log.
--    role 'canteen_manager'  — live display only (kiosk).
--  The super admin row is seeded/healed by the API on boot (auth.ts).
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL   PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,         -- login id (email)
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('super_admin','admin','hr_manager','canteen_manager')),
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,                                -- username of creator
  last_login_at TIMESTAMPTZ
);

-- Heal the role set on pre-existing databases (idempotent). The legacy single
-- 'manager' role is migrated to 'canteen_manager' (live-display-only). The
-- UPDATE runs in the 'system' RLS context so it bypasses the users policies and
-- the role-change guard trigger that already exist from a prior run.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
SELECT set_config('app.actor_role', 'system', false);
UPDATE users SET role = 'canteen_manager' WHERE role = 'manager';
SELECT set_config('app.actor_role', '', false);
ALTER TABLE users ADD  CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','admin','hr_manager','canteen_manager'));

-- At most one super admin, enforced at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_super_admin
  ON users ((role)) WHERE role = 'super_admin';

-- Immutable audit trail: logins, logouts, and privileged actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  username    TEXT,                                  -- snapshot (survives user deletion)
  name        TEXT,
  role        TEXT,
  action      TEXT        NOT NULL,                  -- LOGIN / LOGOUT / LOGIN_FAILED / USER_CREATED / ...
  detail      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  session_id  TEXT                                   -- ties a LOGIN to its LOGOUT
);

CREATE INDEX IF NOT EXISTS idx_audit_at      ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log (session_id);

-- Per-user cafeteria access. super_admin / admin implicitly see ALL cafeterias
-- (no rows here). hr_manager / canteen_manager are restricted to the cafeterias
-- assigned here; the API scopes every cafeteria-wise figure to this set.
CREATE TABLE IF NOT EXISTS user_cafeterias (
  user_id      BIGINT  NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  cafeteria_id INTEGER NOT NULL REFERENCES cafeterias(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, cafeteria_id)
);
CREATE INDEX IF NOT EXISTS idx_user_cafeterias_user ON user_cafeterias (user_id);

-- ============================================================
--  Row-Level Security — defense in depth UNDER the API RBAC.
--  Every request opens a short transaction that sets the actor
--  context via set_config('app.actor_role'/'app.actor_id', …, local).
--  Policies below mean that even a miswired query can never let a
--  manager read/modify admin or super-admin rows, nor read audit.
--  Helpers: current_setting('app.actor_role', true)  -> role or NULL
--           NULLIF(current_setting('app.actor_id', true),'')::bigint
-- ============================================================
ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE users     FORCE  ROW LEVEL SECURITY;   -- apply to the table owner too
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;

-- ---- users ----
DROP POLICY IF EXISTS users_system    ON users;
DROP POLICY IF EXISTS users_auth_sel  ON users;
DROP POLICY IF EXISTS users_auth_upd  ON users;
DROP POLICY IF EXISTS users_self_sel  ON users;
DROP POLICY IF EXISTS users_self_upd  ON users;
DROP POLICY IF EXISTS users_super_sel ON users;
DROP POLICY IF EXISTS users_super_ins ON users;
DROP POLICY IF EXISTS users_super_upd ON users;
DROP POLICY IF EXISTS users_super_del ON users;
DROP POLICY IF EXISTS users_admin_sel ON users;
DROP POLICY IF EXISTS users_admin_ins ON users;
DROP POLICY IF EXISTS users_admin_upd ON users;
DROP POLICY IF EXISTS users_admin_del ON users;

-- bootstrap context (seedSuperAdmin only)
CREATE POLICY users_system ON users FOR ALL
  USING      (current_setting('app.actor_role', true) = 'system')
  WITH CHECK (current_setting('app.actor_role', true) = 'system');

-- authentication context (login + per-request token revalidation)
CREATE POLICY users_auth_sel ON users FOR SELECT
  USING (current_setting('app.actor_role', true) = 'auth');
CREATE POLICY users_auth_upd ON users FOR UPDATE
  USING      (current_setting('app.actor_role', true) = 'auth')
  WITH CHECK (current_setting('app.actor_role', true) = 'auth');

-- self: anyone may see and change-password their own row
CREATE POLICY users_self_sel ON users FOR SELECT
  USING (id = NULLIF(current_setting('app.actor_id', true), '')::bigint);
CREATE POLICY users_self_upd ON users FOR UPDATE
  USING      (id = NULLIF(current_setting('app.actor_id', true), '')::bigint)
  WITH CHECK (id = NULLIF(current_setting('app.actor_id', true), '')::bigint);

-- super admin: sees everyone; may write only non-super rows
CREATE POLICY users_super_sel ON users FOR SELECT
  USING (current_setting('app.actor_role', true) = 'super_admin');
CREATE POLICY users_super_ins ON users FOR INSERT
  WITH CHECK (current_setting('app.actor_role', true) = 'super_admin'
             AND role IN ('admin','hr_manager','canteen_manager'));
CREATE POLICY users_super_upd ON users FOR UPDATE
  USING      (current_setting('app.actor_role', true) = 'super_admin' AND role <> 'super_admin')
  WITH CHECK (current_setting('app.actor_role', true) = 'super_admin' AND role <> 'super_admin');
CREATE POLICY users_super_del ON users FOR DELETE
  USING (current_setting('app.actor_role', true) = 'super_admin' AND role <> 'super_admin');

-- admin: only HR + canteen managers (plus own row for SELECT)
CREATE POLICY users_admin_sel ON users FOR SELECT
  USING (current_setting('app.actor_role', true) = 'admin'
         AND (role IN ('hr_manager','canteen_manager')
              OR id = NULLIF(current_setting('app.actor_id', true), '')::bigint));
CREATE POLICY users_admin_ins ON users FOR INSERT
  WITH CHECK (current_setting('app.actor_role', true) = 'admin' AND role IN ('hr_manager','canteen_manager'));
CREATE POLICY users_admin_upd ON users FOR UPDATE
  USING      (current_setting('app.actor_role', true) = 'admin' AND role IN ('hr_manager','canteen_manager'))
  WITH CHECK (current_setting('app.actor_role', true) = 'admin' AND role IN ('hr_manager','canteen_manager'));
CREATE POLICY users_admin_del ON users FOR DELETE
  USING (current_setting('app.actor_role', true) = 'admin' AND role IN ('hr_manager','canteen_manager'));
-- (managers match no users policy at all -> zero access to the users table)

-- ---- audit_log ----
DROP POLICY IF EXISTS audit_insert    ON audit_log;
DROP POLICY IF EXISTS audit_super_sel ON audit_log;
-- writes happen in every context (logins, including failed/unauthenticated)
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (true);
-- ONLY the super admin may ever read the audit trail
CREATE POLICY audit_super_sel ON audit_log FOR SELECT
  USING (current_setting('app.actor_role', true) = 'super_admin');

-- ---- hard guarantees via trigger (independent of policies) ----
CREATE OR REPLACE FUNCTION users_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin' THEN
      RAISE EXCEPTION 'The super admin can never be deleted';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.role = 'super_admin' AND NEW.role <> 'super_admin' THEN
    RAISE EXCEPTION 'The super admin role is immutable';
  END IF;
  IF NEW.role <> OLD.role
     AND COALESCE(current_setting('app.actor_role', true), '') NOT IN ('super_admin', 'system') THEN
    RAISE EXCEPTION 'Only the super admin may change a role';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_guard_trg ON users;
CREATE TRIGGER users_guard_trg BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION users_guard();

-- ---- Uploaded employee photos --------------------------------------------
-- Manually uploaded portraits for employees whose punches carry no HikCentral
-- capture. One photo per employee, stored inline (small JPEGs, client-resized).
-- Takes precedence over the synced /faces files everywhere a face is shown.
-- image = NULL marks "photo hidden by an admin": the synced capture file lives
-- on a read-only volume, so suppression is recorded here instead of deleting it.
CREATE TABLE IF NOT EXISTS emp_photos (
  emp_id      TEXT PRIMARY KEY,
  image       BYTEA,
  mime        TEXT NOT NULL DEFAULT 'image/jpeg',
  uploaded_by TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
