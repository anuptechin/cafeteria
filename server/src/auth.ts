import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "./env.js";
import { query, withActor } from "./db.js";

export type Role = "super_admin" | "admin" | "hr_manager" | "canteen_manager";

// ---- central RBAC policy (single source of truth) ----
// Which roles a creator is allowed to mint.
export function creatableRoles(actor: Role): Role[] {
  if (actor === "super_admin") return ["admin", "hr_manager", "canteen_manager"];
  if (actor === "admin") return ["hr_manager", "canteen_manager"];
  return [];
}

// Can `actor` enable/disable/reset/delete a user whose role is `target`?
// The super admin row is the system root — untouchable by everyone here.
export function canManageTarget(actor: Role, target: Role): boolean {
  if (target === "super_admin") return false;
  if (target === "admin") return actor === "super_admin";
  if (target === "hr_manager" || target === "canteen_manager")
    return actor === "super_admin" || actor === "admin";
  return false;
}

export type AuthUser = {
  id: number;
  username: string;
  name: string;
  role: Role;
  sid: string; // session id — pairs a LOGIN with its LOGOUT in the audit trail
  // Cafeteria access: null = ALL (super_admin / admin); array = restricted set.
  cafeterias: number[] | null;
};

const TOKEN_TTL = "12h";

// ---- password hashing ----
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// ---- token ----
export function signToken(u: Omit<AuthUser, "sid"> & { sid?: string }): string {
  const sid = u.sid ?? crypto.randomUUID();
  return jwt.sign({ id: u.id, username: u.username, name: u.name, role: u.role, sid }, env.jwtSecret, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const p = jwt.verify(token, env.jwtSecret) as any;
    // cafeterias is re-resolved from the DB on every request (see requireAuth).
    return { id: p.id, username: p.username, name: p.name, role: p.role, sid: p.sid, cafeterias: null };
  } catch {
    return null;
  }
}

// ---- request helpers ----
function tokenFromReq(req: Request): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7);
  // EventSource (SSE) can't set headers — allow a token query param as a fallback.
  if (typeof req.query.token === "string") return req.query.token;
  return null;
}

export function clientIp(req: Request): string {
  const xf = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xf) ? xf[0] : xf?.split(",")[0];
  return (raw || req.socket.remoteAddress || "").replace(/^::ffff:/, "") || "unknown";
}

// Augment Express Request with the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Authenticate AND re-validate against the database on every request: the JWT
// is only a claim — the DB is the source of truth for role + active status, so
// a demoted/disabled/deleted user is locked out immediately (no waiting for the
// token to expire), and a manager can never carry an elevated role in a token.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = tokenFromReq(req);
    const claim = token ? verifyToken(token) : null;
    if (!claim) return res.status(401).json({ ok: false, error: "Not authenticated" });

    const rows = await withActor("auth", null, (c) =>
      c
        .query("SELECT id, username, name, role, active FROM users WHERE id = $1", [claim.id])
        .then((r) => r.rows)
    );
    const fresh = rows[0];
    if (!fresh || !fresh.active)
      return res.status(401).json({ ok: false, error: "Session is no longer valid" });

    // Cafeteria access: super_admin / admin see all (null); others are limited to
    // their assigned set. Resolved from the DB each request, like role/active.
    let cafeterias: number[] | null = null;
    if (fresh.role !== "super_admin" && fresh.role !== "admin") {
      const crows = await query<{ cafeteria_id: number }>(
        "SELECT cafeteria_id FROM user_cafeterias WHERE user_id = $1",
        [fresh.id]
      );
      cafeterias = crows.map((r) => r.cafeteria_id);
    }

    // DB role wins over whatever the token says.
    req.user = {
      id: fresh.id,
      username: fresh.username,
      name: fresh.name,
      role: fresh.role,
      sid: claim.sid,
      cafeterias,
    };
    next();
  } catch (e) {
    console.error("[auth] requireAuth error:", (e as Error).message);
    res.status(500).json({ ok: false, error: "Authentication check failed" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ ok: false, error: "Insufficient permissions" });
    next();
  };
}

// ---- audit trail ----
export async function audit(
  req: Request,
  action: string,
  opts: {
    user?: { id?: number; username?: string; name?: string; role?: string } | null;
    detail?: string;
    sessionId?: string;
  } = {}
) {
  const u = opts.user ?? req.user ?? null;
  try {
    await query(
      `INSERT INTO audit_log (user_id, username, name, role, action, detail, ip, user_agent, session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        u?.id ?? null,
        u?.username ?? null,
        u?.name ?? null,
        u?.role ?? null,
        action,
        opts.detail ?? null,
        clientIp(req),
        String(req.headers["user-agent"] ?? "").slice(0, 400),
        opts.sessionId ?? req.user?.sid ?? null,
      ]
    );
  } catch (e) {
    console.error("[audit] failed to record:", (e as Error).message);
  }
}

// ---- super admin bootstrap ----
// Guarantees exactly one super admin exists. Created on first boot with the
// configured password; never overwritten or deleted afterwards.
export async function seedSuperAdmin() {
  // Runs under the RLS 'system' context so the bootstrap insert is permitted.
  await withActor("system", null, async (c) => {
    const existing = (
      await c.query<{ id: number; username: string }>(
        `SELECT id, username FROM users WHERE role = 'super_admin'`
      )
    ).rows[0];
    if (existing) {
      console.log(`  Super admin   → ${existing.username} (existing)`);
      return;
    }
    const hash = await hashPassword(env.superAdminPassword);
    await c.query(
      `INSERT INTO users (username, name, password_hash, role, created_by)
       VALUES ($1,$2,$3,'super_admin','system')`,
      [env.superAdminUser, env.superAdminName, hash]
    );
    console.log(`  Super admin   → ${env.superAdminUser} (seeded)`);
  });
}
