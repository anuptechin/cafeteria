import { useEffect, useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { Display } from "./pages/Display";
import { Reports } from "./pages/Reports";
import { Employees } from "./pages/Employees";
import { Admin } from "./pages/Admin";
import { Simulator } from "./pages/Simulator";
import { Audit } from "./pages/Audit";
import { Users } from "./pages/Users";
import { Login } from "./pages/Login";
import { useLivePunches, ROLE_LABEL, type Role } from "./lib/api";
import { PhotoProvider } from "./lib/photos";
import { AuthProvider, useAuth } from "./lib/auth";
import { ChangePassword } from "./components/ChangePassword";

type Route =
  | "dashboard"
  | "display"
  | "simulator"
  | "reports"
  | "employees"
  | "admin"
  | "audit"
  | "users";

const NAV: { key: Route; label: string; icon: JSX.Element; roles: Role[] }[] = [
  { key: "dashboard", label: "Dashboard", icon: <IconGrid />, roles: ["super_admin", "admin"] },
  { key: "display", label: "Live Display", icon: <IconScreen />, roles: ["super_admin", "admin", "manager"] },
  { key: "simulator", label: "Simulator", icon: <IconBolt />, roles: ["super_admin", "admin", "manager"] },
  { key: "reports", label: "Reports", icon: <IconDoc />, roles: ["super_admin", "admin", "manager"] },
  { key: "employees", label: "Employees", icon: <IconUsers />, roles: ["super_admin", "admin"] },
  { key: "admin", label: "Admin", icon: <IconGear />, roles: ["super_admin", "admin"] },
  { key: "users", label: "Users & Access", icon: <IconShieldUser />, roles: ["super_admin", "admin"] },
  { key: "audit", label: "Audit Log", icon: <IconHistory />, roles: ["super_admin"] },
];

const ROUTES = NAV.map((n) => n.key);

// Pages a role may open, in sidebar order. First entry is that role's landing page.
function allowedRoutes(role: Role): Route[] {
  return NAV.filter((n) => n.roles.includes(role)).map((n) => n.key);
}
const canAccess = (role: Role, route: Route) =>
  NAV.find((n) => n.key === route)?.roles.includes(role) ?? false;

function useHashRoute(fallback: Route): [Route, (r: Route) => void] {
  const parse = (): Route => {
    const h = window.location.hash.replace("#/", "") as Route;
    return ROUTES.includes(h) ? h : fallback;
  };
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nav = (r: Route) => {
    window.location.hash = `/${r}`;
  };
  return [route, nav];
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

// Decides between the loading splash, the login screen, and the app.
function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return <Splash />;
  if (!user) return <Login />;
  return (
    <PhotoProvider>
      <AppShell />
    </PhotoProvider>
  );
}

function Splash() {
  return (
    <div className="grid min-h-screen place-content-center bg-surface-bege">
      <img src="/ddecor-logo.webp" alt="D'DECOR" className="h-12 w-auto animate-pulse object-contain" />
    </div>
  );
}

function AppShell() {
  const { user } = useAuth();
  const role = user!.role;
  const home = allowedRoutes(role)[0] ?? "reports";
  const [route, nav] = useHashRoute(home);

  // Never render a page the role isn't allowed to see — bounce to their home.
  useEffect(() => {
    if (!canAccess(role, route)) nav(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, role]);
  if (!canAccess(role, route)) return null;

  // Full-screen mode for the cafeteria TV display.
  if (route === "display") return <Display onExit={() => nav(home)} />;

  return (
    <div className="flex min-h-screen bg-surface-bege text-ink">
      <Sidebar route={route} nav={nav} />
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-[1400px] px-6 py-6 lg:px-10">
          {route === "dashboard" && <Dashboard />}
          {route === "simulator" && <Simulator goLive={() => nav("display")} />}
          {route === "reports" && <Reports />}
          {route === "employees" && <Employees />}
          {route === "admin" && <Admin />}
          {route === "users" && <Users />}
          {route === "audit" && <Audit />}
        </div>
      </main>
    </div>
  );
}

function Sidebar({ route, nav }: { route: Route; nav: (r: Route) => void }) {
  const { user, logout } = useAuth();
  const [pulse, setPulse] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const connected = useLivePunches(() => {
    setPulse(true);
    setTimeout(() => setPulse(false), 600);
  });
  return (
    <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r bg-surface-white">
      <div className="px-6 pb-6 pt-7">
        <img src="/ddecor-logo.webp" alt="D'DECOR" className="h-16 w-auto object-contain object-left" />
        <div className="mt-1.5 text-xs font-medium tracking-wide text-ink-secondary">Cafeteria Intelligence</div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV.filter((n) => (user ? n.roles.includes(user.role) : false)).map((n) => (
          <button
            key={n.key}
            onClick={() => nav(n.key)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              route === n.key ? "bg-black text-white" : "text-ink-secondary hover:bg-black/5 hover:text-black"
            }`}
          >
            <span className="h-5 w-5">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>
      <div className="space-y-3 border-t px-3 py-4">
        <div className="flex items-center gap-2 px-2 text-xs text-ink-secondary">
          <span
            className={`h-2 w-2 rounded-full transition-all ${
              connected ? "bg-success" : "bg-alert"
            } ${pulse ? "scale-150" : ""}`}
          />
          {connected ? "Live · receiving scans" : "Connecting…"}
        </div>

        {user && (
          <div className="rounded-xl bg-black/[0.03] p-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`grid h-9 w-9 shrink-0 place-content-center rounded-full text-xs font-bold text-white ${
                  user.role === "super_admin" ? "bg-black" : "bg-ink-secondary"
                }`}
              >
                {avatarInitials(user.name || user.username)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{user.name}</div>
                <div className="truncate text-[11px] text-ink-secondary">{ROLE_LABEL[user.role]}</div>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="grid h-8 w-8 shrink-0 place-content-center rounded-lg text-ink-secondary transition-colors hover:bg-error/10 hover:text-error"
              >
                <IconLogout />
              </button>
            </div>
            <button
              onClick={() => setPwOpen(true)}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-black/5 hover:text-black"
            >
              <IconKey /> Change password
            </button>
          </div>
        )}
      </div>

      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </aside>
  );
}

function avatarInitials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/* --- inline icons --- */
function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconScreen() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <path d="M6 2.5h8l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M14 2.5V7h4M8.5 12h7M8.5 16h7" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.6 2.7-5.5 5.5-5.5s5.5 1.9 5.5 5.5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M17.5 20c0-3-1.5-4.8-3.3-5.4" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" strokeLinejoin="round" />
    </svg>
  );
}
function IconGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6" />
    </svg>
  );
}
function IconShieldUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <path d="M12 2.5l7.5 2.8v5.7c0 4.7-3.2 7.6-7.5 8.5-4.3-.9-7.5-3.8-7.5-8.5V5.3L12 2.5Z" />
      <circle cx="12" cy="10" r="2.3" />
      <path d="M8.3 16.2c.6-1.8 2-2.7 3.7-2.7s3.1.9 3.7 2.7" strokeLinecap="round" />
    </svg>
  );
}
function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-full w-full">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9H8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M9 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconKey() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M17 4l3 3M15 6l2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
