import { useState } from "react";
import { api, usePoll, type AuditRow, type SessionRow } from "../lib/api";
import { Card, CardSkeleton, Empty, Stat } from "../components/ui";
import { ago, dateOf, timeOf, initials } from "../lib/format";

type Tab = "sessions" | "activity";

export function Audit() {
  const [tab, setTab] = useState<Tab>("sessions");
  const { data: stats } = usePoll(() => api.auditStats(), [], 15000);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit & Access Log</h1>
          <p className="mt-0.5 text-sm text-ink-secondary">
            A tamper-evident record of every sign-in, sign-out and privileged action.
          </p>
        </div>
        <Tabs tab={tab} setTab={setTab} />
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Logins Today" value={stats?.loginsToday ?? "—"} icon={<IconIn />} accent="#19B924" />
        <Stat label="Active Sessions" value={stats?.activeSessions ?? "—"} icon={<IconPulse />} accent="#000000" />
        <Stat label="Total Logins" value={stats?.totalLogins ?? "—"} icon={<IconKey />} accent="#B99919" />
        <Stat label="Failed · 7d" value={stats?.failed7d ?? "—"} icon={<IconShield />} accent="#B93E19" />
      </div>

      {tab === "sessions" ? <Sessions /> : <Activity />}
    </div>
  );
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const opts: { k: Tab; l: string }[] = [
    { k: "sessions", l: "Sessions" },
    { k: "activity", l: "Activity Log" },
  ];
  return (
    <div className="inline-flex rounded-full border bg-surface-white p-0.5">
      {opts.map((o) => (
        <button
          key={o.k}
          onClick={() => setTab(o.k)}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
            tab === o.k ? "bg-black text-white" : "text-ink-secondary hover:text-black"
          }`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Sessions (login → logout pairs) ---------------- */
function Sessions() {
  const { data, loading } = usePoll(() => api.auditSessions(150), [], 10000);
  if (loading && !data) return <CardSkeleton h={320} />;
  if (!data?.length)
    return (
      <Card>
        <Empty>No sessions recorded yet.</Empty>
      </Card>
    );

  return (
    <Card className="overflow-hidden !p-0">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_0.9fr_0.8fr] gap-3 border-b bg-surface-bege px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
        <span>User</span>
        <span>Signed in</span>
        <span>Signed out</span>
        <span>Duration</span>
        <span className="text-right">Origin</span>
      </div>
      <div className="divide-y">
        {data.map((s) => (
          <SessionRowView key={s.session_id + s.login_at} s={s} />
        ))}
      </div>
    </Card>
  );
}

function SessionRowView({ s }: { s: SessionRow }) {
  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr_0.9fr_0.8fr] items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-black/[0.02]">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={`grid h-9 w-9 shrink-0 place-content-center rounded-full text-xs font-bold text-white ${
            s.role === "super_admin" ? "bg-black" : "bg-ink-secondary"
          }`}
        >
          {initials(s.name || s.username)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{s.name || s.username}</span>
            <RoleTag role={s.role} />
          </div>
          <div className="truncate text-xs text-ink-secondary">{s.username}</div>
        </div>
      </div>

      <div>
        <div className="font-medium tnum">{timeOf(s.login_at)}</div>
        <div className="text-xs text-ink-secondary">{dateOf(s.login_at)}</div>
      </div>

      <div>
        {s.active ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            Active now
          </span>
        ) : (
          <>
            <div className="font-medium tnum">{timeOf(s.logout_at!)}</div>
            <div className="text-xs text-ink-secondary">{dateOf(s.logout_at!)}</div>
          </>
        )}
      </div>

      <div className="tnum text-sm font-medium">{fmtDuration(s.duration_sec)}</div>

      <div className="text-right">
        <div className="tnum text-xs font-medium">{s.ip}</div>
        <div className="truncate text-xs text-ink-secondary">{device(s.user_agent)}</div>
      </div>
    </div>
  );
}

/* ---------------- Activity log (every event) ---------------- */
const ACTIONS = ["", "LOGIN", "LOGOUT", "LOGIN_FAILED", "USER_CREATED", "USER_DELETED", "PASSWORD_RESET"];

function Activity() {
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const { data, loading } = usePoll(
    () => api.audit({ action: action || undefined, search: search || undefined, limit: 300 }),
    [action, search],
    12000
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-surface-white px-3 py-2">
          <IconSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, name or IP…"
            className="w-56 bg-transparent text-sm outline-none placeholder:text-ink-secondary"
          />
        </div>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-xl border bg-surface-white px-3 py-2.5 text-sm outline-none"
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a ? prettyAction(a) : "All actions"}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <CardSkeleton h={320} />
      ) : !data?.length ? (
        <Card>
          <Empty>No matching activity.</Empty>
        </Card>
      ) : (
        <Card className="!p-0">
          <ol className="relative px-5 py-2">
            {data.map((r, i) => (
              <ActivityItem key={r.id} r={r} last={i === data.length - 1} />
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function ActivityItem({ r, last }: { r: AuditRow; last: boolean }) {
  const v = actionStyle(r.action);
  return (
    <li className="relative flex gap-4 py-3">
      {!last && <span className="absolute left-[15px] top-10 h-[calc(100%-1rem)] w-px bg-black/10" />}
      <span
        className="z-10 grid h-8 w-8 shrink-0 place-content-center rounded-full"
        style={{ background: v.bg, color: v.fg }}
      >
        {v.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">{r.name || r.username || "Unknown"}</span>
          <span className="text-sm text-ink-secondary">{verb(r.action)}</span>
          {r.role && <RoleTag role={r.role} />}
        </div>
        {r.detail && <div className="mt-0.5 text-xs text-ink-secondary">{r.detail}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-secondary">
          <span className="tnum">{r.ip ?? "—"}</span>
          <span>·</span>
          <span>{device(r.user_agent ?? "")}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-xs font-medium tnum">{timeOf(r.at)}</div>
        <div className="text-[11px] text-ink-secondary">{ago(r.at)}</div>
      </div>
    </li>
  );
}

function RoleTag({ role }: { role: string }) {
  const sup = role === "super_admin";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        sup ? "bg-black text-white" : "bg-black/[0.06] text-ink-secondary"
      }`}
    >
      {sup ? "Super" : "Admin"}
    </span>
  );
}

/* ---------------- helpers ---------------- */
function fmtDuration(sec: number) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function device(ua: string) {
  if (!ua) return "—";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl/.test(ua) ? "curl" : "";
  return [br, os].filter(Boolean).join(" · ") || "Unknown";
}

const prettyAction = (a: string) =>
  a.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function verb(a: string) {
  switch (a) {
    case "LOGIN": return "signed in";
    case "LOGOUT": return "signed out";
    case "LOGIN_FAILED": return "failed to sign in";
    case "USER_CREATED": return "created an admin";
    case "USER_DELETED": return "deleted an admin";
    case "USER_DISABLED": return "disabled an admin";
    case "USER_UPDATED": return "updated an admin";
    case "PASSWORD_RESET": return "reset a password";
    case "PASSWORD_CHANGED": return "changed their password";
    default: return prettyAction(a).toLowerCase();
  }
}

function actionStyle(a: string): { bg: string; fg: string; icon: string } {
  if (a === "LOGIN") return { bg: "rgba(25,185,36,0.12)", fg: "#19B924", icon: "→" };
  if (a === "LOGOUT") return { bg: "rgba(0,0,0,0.06)", fg: "#5C5A52", icon: "←" };
  if (a === "LOGIN_FAILED") return { bg: "rgba(185,62,25,0.12)", fg: "#B93E19", icon: "!" };
  if (a.startsWith("PASSWORD")) return { bg: "rgba(185,153,25,0.14)", fg: "#B99919", icon: "*" };
  if (a === "USER_DELETED") return { bg: "rgba(185,62,25,0.12)", fg: "#B93E19", icon: "×" };
  return { bg: "rgba(0,0,0,0.85)", fg: "#fff", icon: "+" };
}

/* ---------------- icons ---------------- */
const IconIn = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconPulse = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h4l2 6 4-14 2 8h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const IconKey = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="8" cy="8" r="4" /><path d="M11 11l9 9M17 17l2-2M14 14l2-2" strokeLinecap="round" /></svg>
);
const IconShield = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" /></svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-secondary" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" strokeLinecap="round" /></svg>
);
