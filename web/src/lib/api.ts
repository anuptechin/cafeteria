import { useCallback, useEffect, useRef, useState } from "react";

export type DashboardData = {
  range: string;
  totals: { meals: number };
  uniqueEmployees: number;
  activeDevices: number;
  avgPerDay: number;
  today: { meals: number; employees: number };
  trend: { d: string; meals: number }[];
  devices: { device_id: string; meals: number }[];
  topEmployees: { emp_id: string; name: string; meals: number; last_seen: string | null; image_id: number | null }[];
  slots: { name: string; meals: number }[];
  hourly: { hour: number; meals: number }[];
};

export type Face = {
  id: number;
  emp_id: string | null;
  name: string | null;
  has_image: boolean;
  device_id: string | null;
  punched_at: string;
};

// ---- auth token bridge (set by the AuthProvider) ----
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setAuthToken = (t: string | null) => {
  authToken = t;
};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};
export const getAuthToken = () => authToken;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

// Authenticated fetch — injects the bearer token and trips the global 401 handler.
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: authHeaders(init.headers as Record<string, string>) });
  if (res.status === 401) onUnauthorized?.();
  return res;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await authedFetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return json.data as T;
}

async function sendJSON<T = any>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await authedFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

// ---- auth / RBAC types ----
export type Role = "super_admin" | "admin" | "hr_manager" | "canteen_manager";
export type AuthedUser = { id: number; username: string; name: string; role: Role };

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hr_manager: "HR Manager",
  canteen_manager: "Canteen Manager",
};

// Client mirror of the server RBAC policy (server remains the enforcer).
export function creatableRoles(actor: Role): Role[] {
  if (actor === "super_admin") return ["admin", "hr_manager", "canteen_manager"];
  if (actor === "admin") return ["hr_manager", "canteen_manager"];
  return [];
}
export function canManageTarget(actor: Role, target: Role): boolean {
  if (target === "super_admin") return false;
  if (target === "admin") return actor === "super_admin";
  if (target === "hr_manager" || target === "canteen_manager")
    return actor === "super_admin" || actor === "admin";
  return false;
}
export type ManagedUser = AuthedUser & {
  active: boolean;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
};
export type AuditRow = {
  id: number;
  at: string;
  username: string | null;
  name: string | null;
  role: string | null;
  action: string;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  session_id: string | null;
};
export type SessionRow = {
  session_id: string;
  username: string;
  name: string;
  role: string;
  ip: string;
  user_agent: string;
  login_at: string;
  logout_at: string | null;
  duration_sec: number;
  active: boolean;
};

// Time-range selection used across pages.
export type RangeState = { key: string; from: string; to: string };
const rq = (r: RangeState) =>
  `range=${r.key}${r.from ? `&from=${r.from}` : ""}${r.to ? `&to=${r.to}` : ""}`;

export const api = {
  dashboard: (r: RangeState) => getJSON<DashboardData>(`/api/dashboard?${rq(r)}`),
  recentFaces: (limit = 10) => getJSON<Face[]>(`/api/recent-faces?limit=${limit}`),
  employees: (r: RangeState, search = "") =>
    getJSON<any[]>(`/api/employees?${rq(r)}&search=${encodeURIComponent(search)}&limit=120`),
  deviceReport: (r: RangeState) => getJSON<any>(`/api/reports/device?${rq(r)}`),
  employeesReport: (r: RangeState) => getJSON<any>(`/api/reports/employees?${rq(r)}`),
  employeeReport: (empId: string, r: RangeState) =>
    getJSON<any>(`/api/reports/employee/${empId}?${rq(r)}`),

  // ---- auth ----
  login: (username: string, password: string) =>
    sendJSON<{ ok: boolean; error?: string; data?: { token: string; user: AuthedUser } }>(
      `/api/auth/login`,
      "POST",
      { username, password }
    ),
  logout: () => sendJSON(`/api/auth/logout`, "POST"),
  me: () => getJSON<{ user: AuthedUser }>(`/api/auth/me`),
  changePassword: (current: string, next: string) =>
    sendJSON(`/api/auth/change-password`, "POST", { current, next }),

  // ---- user management ----
  users: () => getJSON<ManagedUser[]>(`/api/users`),
  createUser: (body: { username: string; name: string; password: string; role: Role }) =>
    sendJSON<{ ok: boolean; error?: string; data?: ManagedUser }>(`/api/users`, "POST", body),
  updateUser: (id: number, body: { active?: boolean; name?: string }) =>
    sendJSON(`/api/users/${id}`, "PATCH", body),
  resetUserPassword: (id: number, password: string) =>
    sendJSON(`/api/users/${id}/reset-password`, "POST", { password }),
  deleteUser: (id: number) => sendJSON(`/api/users/${id}`, "DELETE"),

  // ---- audit ----
  audit: (params: { action?: string; search?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.action) q.set("action", params.action);
    if (params.search) q.set("search", params.search);
    if (params.limit) q.set("limit", String(params.limit));
    return getJSON<AuditRow[]>(`/api/audit?${q.toString()}`);
  },
  auditSessions: (limit = 100) => getJSON<SessionRow[]>(`/api/audit/sessions?limit=${limit}`),
  auditStats: () =>
    getJSON<{ totalLogins: number; failed7d: number; activeSessions: number; loginsToday: number }>(
      `/api/audit/stats`
    ),
};

// Generic polling fetch hook.
export function usePoll<T>(fn: () => Promise<T>, deps: any[], intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setLoading(true);
    load();
    if (!intervalMs) return;
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs]);

  return { data, error, loading, reload: load };
}

// Live punch stream via SSE.
export function useLivePunches(onPunch: (f: Face) => void) {
  const cb = useRef(onPunch);
  cb.current = onPunch;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.href.includes("nostream")) return;
    // EventSource can't send Authorization headers — pass the session token as a query param.
    const t = getAuthToken();
    const es = new EventSource(`/api/live/stream${t ? `?token=${encodeURIComponent(t)}` : ""}`);
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("punch", (e) => {
      try {
        cb.current(JSON.parse((e as MessageEvent).data));
      } catch {}
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);
  return connected;
}
