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
  -- but its DB driver pins the session to UTC, so Postgres reads that wall-clock
  -- as UTC and the event lands 5h30m ahead once shown in IST. On INSERT, re-anchor:
  -- take the wall-clock and relabel it Asia/Kolkata so punched_at is the true
  -- instant — independent of whatever timezone the ingesting session uses.
  IF TG_OP = 'INSERT' THEN
    NEW.punched_at := (NEW.punched_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata';
  END IF;
  NEW.punch_date := (NEW.punched_at AT TIME ZONE 'Asia/Kolkata')::date;
  NEW.punch_time := (NEW.punched_at AT TIME ZONE 'Asia/Kolkata')::time;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_punches_local_datetime
  BEFORE INSERT OR UPDATE OF punched_at ON punches
  FOR EACH ROW EXECUTE FUNCTION punches_set_local_datetime();

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
    RETURN NULL;          -- already recorded this scan; skip silently
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_punches_dedup
  BEFORE INSERT ON punches
  FOR EACH ROW EXECUTE FUNCTION punches_skip_duplicate();

-- Accidental double-tap guard. A meal is one event: if the same employee is
-- scanned again within 1 minute (reader double-fired, or they tapped repeatedly
-- by mistake), those extra scans are NOT separate meals. Skip the insert silently
-- so counts reflect one meal per person per minute. This trigger's name sorts
-- AFTER trg_punches_local_datetime, so it runs once punched_at is the final
-- re-anchored IST instant — compared apples-to-apples against stored rows.
-- Identified employees only; NULL/blank emp_id (unrecognised faces) are never
-- collapsed together.
CREATE OR REPLACE FUNCTION punches_skip_rapid_repeat() RETURNS trigger AS $$
BEGIN
  IF NEW.emp_id IS NOT NULL AND NEW.emp_id <> '' AND EXISTS (
    SELECT 1 FROM punches
     WHERE emp_id = NEW.emp_id
       AND punched_at BETWEEN NEW.punched_at - interval '1 minute'
                          AND NEW.punched_at + interval '1 minute'
  ) THEN
    RETURN NULL;          -- already counted within the last minute; skip
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
