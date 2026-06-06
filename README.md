# D'Decor — Cafeteria Management System

Real-time cafeteria **monitoring** for the Hikvision face-scan readers across the
four D'Decor cafeterias (F6 ×2, G15, F7). Each face scan = one meal consumed. The
app tracks **meal counts only** (who ate, where, when) — no finance/billing.

It ships with a secure auth layer: a single **super admin**, plus **admin** and
**manager** roles, a beautiful login, a full **audit trail**, and database-level
**Row-Level Security** so the role separation is enforced even at the SQL layer.

---

## 1. Architecture

| Part | Tech | Notes |
|------|------|-------|
| `web/` | Vite + React + TypeScript + Tailwind | SPA (hash routing), custom SVG charts, SSE live feed, Hanken Grotesk brand UI |
| `server/` | Express + `pg` + `tsx` | REST + SSE, JWT auth, RBAC middleware, audit logging |
| Database | PostgreSQL 18 | Tables + indexes + RLS policies + a guard trigger |

It's an **npm workspaces** monorepo (`server`, `web`). The server runs TypeScript
directly with `tsx` (no build step); the web is built by Vite.

---

## 2. How to start

There are two ways to run it. **Docker is the easiest** and needs nothing but Docker.

### Option A — Docker (recommended)

Requirements: Docker Desktop.

```bash
docker compose up --build
```

That builds and starts three containers:

| Service | URL | Description |
|---------|-----|-------------|
| `web` | http://localhost:8080 | The app (nginx serving the build, proxying the API) |
| `api` | http://localhost:4000 | Express API |
| `db`  | localhost:5434 | PostgreSQL 18 (optional host access for psql/SSMS) |

On first boot the API automatically: waits for the DB → applies the schema →
seeds demo data (220 employees, ~22k punches, avatars) → seeds the super admin.

**Open http://localhost:8080 and sign in** (see credentials below).

Useful commands:
```bash
docker compose up -d --build     # run in background
docker compose logs -f api       # follow API logs
docker compose down              # stop (keeps the data volume)
docker compose down -v           # stop AND wipe the database/photos volumes
```

> Ports 8080 / 4000 / 5434 must be free. If one is taken, edit the `ports:` in
> `docker-compose.yml` (e.g. change `5434:5432`). To override the super admin
> password or JWT secret, set `JWT_SECRET` / `SUPER_ADMIN_PASSWORD` in a root
> `.env` before `up`.

### Option B — Local dev (hot reload)

Requirements: Node 20+ and a local PostgreSQL 18.

1. Create the database and a `.env` in the repo root (copy `.env.example`):
   ```
   DATABASE_URL=postgres://canteen_app:YOUR_PASSWORD@localhost:5432/canteen
   PORT=4000
   APP_TZ=Asia/Kolkata
   FACES_DIR=./server/faces
   JWT_SECRET=<a long random string>
   SUPER_ADMIN_USER=ambuj.kumar@ddecor.com
   SUPER_ADMIN_NAME=Ambuj Kumar
   SUPER_ADMIN_PASSWORD=Admin@123$
   ```
2. Install, set up the schema, load data, and run:
   ```bash
   npm install
   npm run db:setup     # apply schema.sql (tables, indexes, RLS, trigger) — idempotent
   npm run seed         # OR: npm run import  (see "Data scripts" below)
   npm run photos       # optional: generate sample face photos
   npm run dev          # api on :4000, web on :5173
   ```
3. Open http://localhost:5173. The super admin is seeded automatically when the
   API starts.

---

## 3. Login & roles

The only seeded login account is the **super admin**:

```
Username:  ambuj.kumar@ddecor.com
Password:  Admin@123$
```

(Override via `SUPER_ADMIN_USER` / `SUPER_ADMIN_PASSWORD`. The 220 seeded
employees are face-scan records, **not** login accounts — they have no password.)

Every signed-in user can change their own password from the sidebar
("Change password"). Admins/super admin create other users from **Users & Access**.

| Role | Can access |
|------|-----------|
| **Super Admin** (exactly one, undeletable) | Everything, and is the **only** role that can see the **Audit Log** |
| **Admin** | Everything **except** the Audit Log. Manages **managers** only |
| **Manager** | **Live Display, Simulator and Reports only** |

### Security model (defense in depth)

1. **JWT** bearer tokens (12h), signed with `JWT_SECRET`.
2. **Per-request revalidation** — every request re-reads the user from the DB, so a
   disabled/deleted/demoted user is locked out immediately; the DB role (not the
   token) is authoritative.
3. **API RBAC** — `requireRole(...)` guards each route.
4. **Postgres Row-Level Security** on `users` and `audit_log`: each request opens a
   short transaction that sets an actor context (`app.actor_role` / `app.actor_id`),
   and policies ensure a manager can never read/modify admin or super-admin rows,
   and only the super admin can read the audit log — even if a query were miswired.
5. **Guard trigger** — the super-admin row can never be deleted or demoted, by anyone.

---

## 4. Database schema & "migrations"

This project uses a **single declarative, idempotent schema file** rather than a
sequential migration framework — re-running it is always safe.

| File | What it does |
|------|--------------|
| `server/src/schema.sql` | **The schema.** All `CREATE TABLE IF NOT EXISTS`, indexes, RLS enable/policies, and the super-admin guard trigger. Idempotent (safe to re-run; it also heals older DBs, e.g. the role `CHECK` constraint). |
| `server/src/setup.ts` | Applies `schema.sql`. Run via **`npm run db:setup`**. |

Tables created: `devices`, `employees`, `punches`, `meal_slots`, `users`,
`audit_log` (+ all indexes, RLS policies, and the `users_guard` trigger).

The **super admin** is not in the SQL — it's seeded/healed on API startup by
`seedSuperAdmin()` in `server/src/auth.ts` (created only if absent, never clobbered).

### Data scripts (server workspace)

| Command | File | Purpose |
|---------|------|---------|
| `npm run db:setup` | `setup.ts` | Apply the schema (run this first) |
| `npm run seed` | `seed.ts` | Generate demo data: 220 employees, 4 cafeterias, ~60 days of punches, SVG avatars |
| `npm run import` | `import-master.ts` | Import the **real** employee master (CSV) instead of demo data |
| `npm run photos [N]` | `gen-photos.ts` | Generate N sample A4 face photos (default 30) into `FACES_DIR` |

> Going live with real data: run `npm run import` instead of `seed`, and point
> `FACES_DIR` at the real Hikvision image folder (files named with the `emp_id` in
> the filename are auto-indexed). Nothing in the UI/API changes.

---

## 5. Environment variables

| Variable | Default | Used by | Notes |
|----------|---------|---------|-------|
| `DATABASE_URL` | — (required) | server | Postgres connection string |
| `PORT` | `4000` | server | API port |
| `APP_TZ` | `Asia/Kolkata` | server | Day/slot bucketing timezone |
| `FACES_DIR` | `./server/faces` | server | Where face images live |
| `JWT_SECRET` | dev fallback | server | **Set a strong value in production** |
| `SUPER_ADMIN_USER` | `ambuj.kumar@ddecor.com` | server | Super admin login (seeded on boot) |
| `SUPER_ADMIN_NAME` | `Ambuj Kumar` | server | Super admin display name |
| `SUPER_ADMIN_PASSWORD` | `Admin@123$` | server | Super admin password (seeded on boot) |
| `SIMULATE` | `false` (compose sets `true`) | server | Auto-inject punches so the live feed/dashboard move |

In Docker these are set in `docker-compose.yml`. Locally they come from the root `.env`.

---

## 6. Screens

- **Dashboard** — meal-count KPIs, trend, cafeteria share, slots, top consumers _(admin/super)_
- **Live Display** — CCTV-style FIFO wall of the last scanned faces _(all roles)_
- **Simulator** — inject punches into the live stream for testing _(all roles)_
- **Reports** — cafeteria-wise / by-employee / lookup, with CSV export _(all roles)_
- **Employees** — directory & search _(admin/super)_
- **Admin** — device→cafeteria mapping + meal slots _(admin/super)_
- **Users & Access** — create/enable/disable/delete users, reset passwords _(admin/super)_
- **Audit Log** — login/logout sessions + full activity timeline _(super admin only)_

---

## 7. Project scripts (root)

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API (:4000) and web (:5173) together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run db:setup` | Apply the schema |
| `npm run seed` / `npm run import` / `npm run photos` | Data scripts (above) |
| `npm run build` | Production build of the web app |
| `npm run start` | Start the API (production) |

---

## 8. Troubleshooting

- **Port already in use** (`4000`, `8080`, `5434`, `5173`): something else is using it.
  Stop that process, or change the port (compose `ports:` / Vite/`PORT`).
- **Login says "Invalid credentials"** on a fresh DB: confirm the API logged
  `Super admin → … (seeded)` at startup, and use `Admin@123$`.
- **Audit Log empty / not visible**: only the **super admin** can see it by design.
- **Reset everything (Docker):** `docker compose down -v && docker compose up --build`.
