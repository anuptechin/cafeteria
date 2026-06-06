import { Router } from "express";
import { withActor } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  requireAuth,
  requireRole,
  audit,
  creatableRoles,
  canManageTarget,
  type Role,
} from "./auth.js";
import crypto from "node:crypto";

export const authRouter = Router();

const ok = (res: any, data: unknown) => res.json({ ok: true, data });

// Carries an HTTP status out of a withActor() transaction to the route's catch.
class HttpError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}
const fail = (res: any, e: unknown) => {
  if (e instanceof HttpError) return res.status(e.code).json({ ok: false, error: e.message });
  console.error(e);
  res.status(500).json({ ok: false, error: (e as Error).message });
};
const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const USER_COLS =
  "id, username, name, role, active, created_at, created_by, last_login_at";

// ============================================================
//  Session
// ============================================================
authRouter.post("/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username ?? "").trim().toLowerCase();
    const password = String(req.body.password ?? "");
    if (!username || !password)
      return res.status(400).json({ ok: false, error: "Username and password are required" });

    // User lookup runs in the RLS 'auth' context.
    const u = await withActor("auth", null, (c) =>
      c
        .query(
          `SELECT id, username, name, password_hash, role, active
             FROM users WHERE lower(username) = $1`,
          [username]
        )
        .then((r) => r.rows[0])
    );

    const good = u && u.active && (await verifyPassword(password, u.password_hash));
    if (!good) {
      await audit(req, "LOGIN_FAILED", {
        user: u ? { id: u.id, username: u.username, name: u.name, role: u.role } : { username },
        detail: u ? (u.active ? "Wrong password" : "Account disabled") : "Unknown user",
      });
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const sid = crypto.randomUUID();
    const token = signToken({ id: u.id, username: u.username, name: u.name, role: u.role, sid });
    await withActor("auth", null, (c) =>
      c.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [u.id])
    );
    await audit(req, "LOGIN", {
      user: { id: u.id, username: u.username, name: u.name, role: u.role },
      sessionId: sid,
    });

    ok(res, { token, user: { id: u.id, username: u.username, name: u.name, role: u.role } });
  } catch (e) {
    fail(res, e);
  }
});

authRouter.post("/auth/logout", requireAuth, async (req, res) => {
  await audit(req, "LOGOUT");
  ok(res, { loggedOut: true });
});

authRouter.get("/auth/me", requireAuth, (req, res) => ok(res, { user: req.user }));

authRouter.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const current = String(req.body.current ?? "");
    const next = String(req.body.next ?? "");
    if (!STRONG.test(next))
      return res.status(400).json({
        ok: false,
        error: "Password must be 8+ chars with upper, lower, number and symbol",
      });

    const me = req.user!;
    const result = await withActor(me.role, me.id, async (c) => {
      const row = (await c.query(`SELECT password_hash FROM users WHERE id = $1`, [me.id])).rows[0];
      if (!row || !(await verifyPassword(current, row.password_hash))) return { bad: true };
      await c.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
        me.id,
        await hashPassword(next),
      ]);
      return { bad: false };
    });
    if (result.bad)
      return res.status(401).json({ ok: false, error: "Current password is incorrect" });

    await audit(req, "PASSWORD_CHANGED", { detail: "Self-service password change" });
    ok(res, { changed: true });
  } catch (e) {
    fail(res, e);
  }
});

// ============================================================
//  User management (admin + super_admin)
//  The DB's RLS policies are the real gate: a query only ever sees /
//  touches the rows the actor's role is allowed to. The checks below
//  give friendly errors on top of that.
// ============================================================
authRouter.get("/users", requireAuth, requireRole("admin", "super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const rows = await withActor(me.role, me.id, (c) =>
      c
        .query(
          `SELECT ${USER_COLS} FROM users
            ORDER BY (role = 'super_admin') DESC, (role = 'admin') DESC, created_at ASC`
        )
        .then((r) => r.rows)
    );
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
});

authRouter.post("/users", requireAuth, requireRole("admin", "super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const username = String(req.body.username ?? "").trim().toLowerCase();
    const name = String(req.body.name ?? "").trim();
    const password = String(req.body.password ?? "");
    const role = String(req.body.role ?? "manager") as Role;
    if (!username || !name)
      return res.status(400).json({ ok: false, error: "Name and username are required" });
    if (!STRONG.test(password))
      return res.status(400).json({
        ok: false,
        error: "Password must be 8+ chars with upper, lower, number and symbol",
      });
    if (!creatableRoles(me.role).includes(role))
      return res.status(403).json({ ok: false, error: `You are not allowed to create a ${role}` });

    const hash = await hashPassword(password);
    try {
      const row = await withActor(me.role, me.id, (c) =>
        c
          .query(
            `INSERT INTO users (username, name, password_hash, role, created_by)
             VALUES ($1,$2,$3,$4,$5) RETURNING ${USER_COLS}`,
            [username, name, hash, role, me.username]
          )
          .then((r) => r.rows[0])
      );
      await audit(req, "USER_CREATED", { detail: `Created ${role} ${username}` });
      ok(res, row);
    } catch (e: any) {
      if (e?.code === "23505")
        return res.status(409).json({ ok: false, error: "Username already exists" });
      throw e;
    }
  } catch (e) {
    fail(res, e);
  }
});

// Friendly error when the actor can't manage a given target role.
function manageDenial(targetRole: Role): string {
  return targetRole === "super_admin"
    ? "The super admin can never be modified"
    : "You don't have permission to manage this account";
}

authRouter.patch("/users/:id", requireAuth, requireRole("admin", "super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const id = Number(req.params.id);
    const active = typeof req.body.active === "boolean" ? req.body.active : null;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : null;

    const out = await withActor(me.role, me.id, async (c) => {
      // RLS already limits what we can see; this also yields a friendly 403/404.
      const t = (await c.query(`SELECT id, username, role FROM users WHERE id = $1`, [id])).rows[0];
      if (!t) throw new HttpError(404, "User not found");
      if (!canManageTarget(me.role, t.role)) throw new HttpError(403, manageDenial(t.role));
      const row = (
        await c.query(
          `UPDATE users SET active = COALESCE($2, active), name = COALESCE($3, name)
            WHERE id = $1 RETURNING ${USER_COLS}`,
          [id, active, name]
        )
      ).rows[0];
      return { t, row };
    });

    await audit(req, active === false ? "USER_DISABLED" : "USER_UPDATED", {
      detail: `${out.t.username}${active === false ? " disabled" : active === true ? " enabled" : " updated"}`,
    });
    ok(res, out.row);
  } catch (e) {
    fail(res, e);
  }
});

authRouter.post(
  "/users/:id/reset-password",
  requireAuth,
  requireRole("admin", "super_admin"),
  async (req, res) => {
    try {
      const me = req.user!;
      const id = Number(req.params.id);
      const password = String(req.body.password ?? "");
      if (!STRONG.test(password))
        return res.status(400).json({
          ok: false,
          error: "Password must be 8+ chars with upper, lower, number and symbol",
        });
      const hash = await hashPassword(password);

      const out = await withActor(me.role, me.id, async (c) => {
        const t = (await c.query(`SELECT id, username, role FROM users WHERE id = $1`, [id])).rows[0];
        if (!t) throw new HttpError(404, "User not found");
        if (!canManageTarget(me.role, t.role)) throw new HttpError(403, manageDenial(t.role));
        await c.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, hash]);
        return { t };
      });

      await audit(req, "PASSWORD_RESET", { detail: `Reset password for ${out.t.username}` });
      ok(res, { reset: true });
    } catch (e) {
      fail(res, e);
    }
  }
);

authRouter.delete("/users/:id", requireAuth, requireRole("admin", "super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const id = Number(req.params.id);
    if (id === me.id)
      return res.status(400).json({ ok: false, error: "You cannot delete your own account" });

    const out = await withActor(me.role, me.id, async (c) => {
      const t = (await c.query(`SELECT id, username, role FROM users WHERE id = $1`, [id])).rows[0];
      if (!t) throw new HttpError(404, "User not found");
      if (!canManageTarget(me.role, t.role)) throw new HttpError(403, manageDenial(t.role));
      await c.query(`DELETE FROM users WHERE id = $1`, [id]); // trigger also blocks super_admin
      return { t };
    });

    await audit(req, "USER_DELETED", { detail: `Deleted ${out.t.role} ${out.t.username}` });
    ok(res, { deleted: true });
  } catch (e) {
    fail(res, e);
  }
});

// ============================================================
//  Audit log — SUPER ADMIN ONLY (API guard + RLS both enforce it)
// ============================================================
authRouter.get("/audit", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const limit = Math.min(Number(req.query.limit ?? 200), 1000);
    const action = req.query.action ? String(req.query.action) : null;
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
    const rows = await withActor(me.role, me.id, (c) =>
      c
        .query(
          `SELECT id, at, user_id, username, name, role, action, detail, ip, user_agent, session_id
             FROM audit_log
            WHERE ($1::text IS NULL OR action = $1)
              AND ($2::text IS NULL OR username ILIKE $2 OR name ILIKE $2 OR ip ILIKE $2)
            ORDER BY at DESC
            LIMIT $3`,
          [action, search, limit]
        )
        .then((r) => r.rows)
    );
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
});

authRouter.get("/audit/sessions", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const rows = await withActor(me.role, me.id, (c) =>
      c
        .query(
          `SELECT li.session_id,
                  li.username, li.name, li.role, li.ip, li.user_agent,
                  li.at  AS login_at,
                  lo.at  AS logout_at,
                  EXTRACT(EPOCH FROM (COALESCE(lo.at, now()) - li.at))::bigint AS duration_sec,
                  (lo.at IS NULL) AS active
             FROM audit_log li
             LEFT JOIN LATERAL (
                  SELECT at FROM audit_log
                   WHERE action = 'LOGOUT' AND session_id = li.session_id
                   ORDER BY at ASC LIMIT 1
             ) lo ON TRUE
            WHERE li.action = 'LOGIN'
            ORDER BY li.at DESC
            LIMIT $1`,
          [limit]
        )
        .then((r) => r.rows)
    );
    ok(res, rows);
  } catch (e) {
    fail(res, e);
  }
});

authRouter.get("/audit/stats", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    const me = req.user!;
    const data = await withActor(me.role, me.id, async (c) => {
      const totals = (await c.query(`SELECT count(*)::int AS logins FROM audit_log WHERE action = 'LOGIN'`)).rows[0];
      const failed = (
        await c.query(
          `SELECT count(*)::int AS failed FROM audit_log WHERE action = 'LOGIN_FAILED' AND at > now() - interval '7 days'`
        )
      ).rows[0];
      const activeSessions = (
        await c.query(
          `SELECT count(*)::int AS active FROM audit_log li
            WHERE li.action = 'LOGIN'
              AND li.at > now() - interval '12 hours'
              AND NOT EXISTS (
                SELECT 1 FROM audit_log lo
                 WHERE lo.action = 'LOGOUT' AND lo.session_id = li.session_id)`
        )
      ).rows[0];
      const today = (
        await c.query(
          `SELECT count(*)::int AS logins FROM audit_log WHERE action = 'LOGIN' AND at::date = (now() AT TIME ZONE 'Asia/Kolkata')::date`
        )
      ).rows[0];
      return {
        totalLogins: totals?.logins ?? 0,
        failed7d: failed?.failed ?? 0,
        activeSessions: activeSessions?.active ?? 0,
        loginsToday: today?.logins ?? 0,
      };
    });
    ok(res, data);
  } catch (e) {
    fail(res, e);
  }
});
