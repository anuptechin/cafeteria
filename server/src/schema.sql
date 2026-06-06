-- ============================================================
--  Canteen Management — schema
--  Mirrors the real Hikvision-backed source:
--    punches(emp_id, std_id, timeline)  +  emp_id->name map  +  image folder
-- ============================================================

-- Device / cafeteria mapping. std_id is the raw Face Reader device id;
-- cafeteria_name is the editable friendly mapping (e.g. "F6 Cafeteria A").
CREATE TABLE IF NOT EXISTS devices (
  std_id          INTEGER PRIMARY KEY,
  device_label    TEXT    NOT NULL,
  cafeteria_name  TEXT    NOT NULL,
  location        TEXT,                     -- F6 / G15 / F7
  active          BOOLEAN NOT NULL DEFAULT TRUE
);

-- emp_id is the fixed-digit code that is also embedded in the face image filename.
CREATE TABLE IF NOT EXISTS employees (
  emp_id      TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  department  TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Raw scan/punch events.
CREATE TABLE IF NOT EXISTS punches (
  id          BIGSERIAL   PRIMARY KEY,
  emp_id      TEXT        NOT NULL REFERENCES employees(emp_id),
  std_id      INTEGER     NOT NULL REFERENCES devices(std_id),
  punched_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_punches_punched_at ON punches (punched_at DESC);
CREATE INDEX IF NOT EXISTS idx_punches_emp        ON punches (emp_id);
CREATE INDEX IF NOT EXISTS idx_punches_std        ON punches (std_id);
CREATE INDEX IF NOT EXISTS idx_punches_std_time   ON punches (std_id, punched_at DESC);
-- Guard against duplicate identical scans.
CREATE UNIQUE INDEX IF NOT EXISTS uq_punch ON punches (emp_id, std_id, punched_at);

-- Meal slots (used to label/filter punches: Breakfast / Lunch / Tea / Dinner).
CREATE TABLE IF NOT EXISTS meal_slots (
  id         SERIAL  PRIMARY KEY,
  name       TEXT    NOT NULL,
  start_time TIME    NOT NULL,
  end_time   TIME    NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================
--  Auth & access control (RBAC)
--    role 'super_admin' — reserved, exactly one, can never be deleted.
--    role 'admin'       — full access except deleting/altering the super admin.
--  The super admin row is seeded/healed by the API on boot (auth.ts).
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL   PRIMARY KEY,
  username      TEXT        NOT NULL UNIQUE,         -- login id (email)
  name          TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL CHECK (role IN ('super_admin','admin','manager')),
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    TEXT,                                -- username of creator
  last_login_at TIMESTAMPTZ
);

-- Heal the role CHECK on databases created before 'manager' existed (idempotent).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD  CONSTRAINT users_role_check CHECK (role IN ('super_admin','admin','manager'));

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
  WITH CHECK (current_setting('app.actor_role', true) = 'super_admin' AND role IN ('admin','manager'));
CREATE POLICY users_super_upd ON users FOR UPDATE
  USING      (current_setting('app.actor_role', true) = 'super_admin' AND role <> 'super_admin')
  WITH CHECK (current_setting('app.actor_role', true) = 'super_admin' AND role <> 'super_admin');
CREATE POLICY users_super_del ON users FOR DELETE
  USING (current_setting('app.actor_role', true) = 'super_admin' AND role <> 'super_admin');

-- admin: only managers (plus own row for SELECT)
CREATE POLICY users_admin_sel ON users FOR SELECT
  USING (current_setting('app.actor_role', true) = 'admin'
         AND (role = 'manager' OR id = NULLIF(current_setting('app.actor_id', true), '')::bigint));
CREATE POLICY users_admin_ins ON users FOR INSERT
  WITH CHECK (current_setting('app.actor_role', true) = 'admin' AND role = 'manager');
CREATE POLICY users_admin_upd ON users FOR UPDATE
  USING      (current_setting('app.actor_role', true) = 'admin' AND role = 'manager')
  WITH CHECK (current_setting('app.actor_role', true) = 'admin' AND role = 'manager');
CREATE POLICY users_admin_del ON users FOR DELETE
  USING (current_setting('app.actor_role', true) = 'admin' AND role = 'manager');
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
