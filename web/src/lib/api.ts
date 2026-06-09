import { useCallback, useEffect, useRef, useState } from "react";

export type TrendPoint = { d: string; total: number; lunch: number; dinner: number; tea: number; biscuit: number };
export type DashboardData = {
  range: string;
  from: string;
  to: string;
  cafeteria: number | null;
  meal: string | null;
  cafeterias: { id: number; name: string }[];
  totals: { meals: number };
  uniqueEmployees: number;
  activeDevices: number;
  avgPerDay: number;
  today: { meals: number; employees: number };
  trend: TrendPoint[];
  devices: { device_id: string; category: string | null; cafeteria_name: string | null; meals: number }[];
  topEmployees: { emp_id: string; name: string; meals: number; last_seen: string | null; image_id: number | null }[];
  meals: { meal: string; meals: number }[];
  byCafeteria: { name: string; meals: number }[];
  hourly: { hour: number; meals: number }[];
};

export type Face = {
  id: number;
  emp_id: string | null;
  name: string | null;
  has_image: boolean;
  device_id: string | null;
  meal: string | null;
  cafeteria_name: string | null;
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
  cafeterias: number[]; // assigned cafeteria ids (empty for super_admin/admin = all)
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

// ---- cafeterias / devices / meal windows ----
export type MealCategory = "lunch_dinner" | "tea" | "biscuits";
export const CATEGORY_LABEL: Record<MealCategory, string> = {
  lunch_dinner: "Lunch / Dinner",
  tea: "Tea",
  biscuits: "Biscuits",
};
export const CATEGORIES: MealCategory[] = ["lunch_dinner", "tea", "biscuits"];
export type Device = {
  device_id: string;
  cafeteria_id: number;
  category: MealCategory;
  label: string | null;
};
export type TimeSlot = {
  id: number;
  cafeteria_id: number;
  meal: string; // "Lunch" | "Dinner" | "Tea/Snack"
  start_time: string;
  end_time: string;
  dedup_mode: "once_per_slot" | "1min";
  sort: number;
};
// Current rate card row (the version in effect today) for one meal.
export type MealPrice = {
  cafeteria_id: number;
  meal: string; // "Lunch" | "Dinner" | "Tea" | "Biscuit"
  emp_paid: number;
  company_paid: number;
  effective_from: string;
};
export type Cafeteria = {
  id: number;
  name: string;
  active: boolean;
  created_at: string;
  devices: Device[];
  slots: TimeSlot[];
  todayMeals: Record<string, number>;
  prices: MealPrice[];
};

// Time-range selection used across pages.
export type RangeState = { key: string; from: string; to: string };
const rq = (r: RangeState) =>
  `range=${r.key}${r.from ? `&from=${r.from}` : ""}${r.to ? `&to=${r.to}` : ""}`;
// optional cafeteria + meal query suffix
const cm = (cafeteriaId?: number | null, meal?: string | null) =>
  (cafeteriaId ? `&cafeteria=${cafeteriaId}` : "") + (meal ? `&meal=${encodeURIComponent(meal)}` : "");

export const api = {
  dashboard: (r: RangeState, cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<DashboardData>(`/api/dashboard?${rq(r)}` + cm(cafeteriaId, meal)),
  recentFaces: (limit = 10, cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<Face[]>(`/api/recent-faces?limit=${limit}` + cm(cafeteriaId, meal)),
  // Range-bound recent (dashboard) — honors the date picker + cafeteria + meal.
  recentInRange: (r: RangeState, limit = 15, cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<Face[]>(`/api/recent-faces?limit=${limit}&${rq(r)}` + cm(cafeteriaId, meal)),
  liveCafeterias: () => getJSON<{ id: number; name: string }[]>(`/api/live/cafeterias`),
  liveCount: (cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<{ count: number; label: string }>(
      `/api/live/count?1=1` +
        (cafeteriaId ? `&cafeteria=${cafeteriaId}` : "") +
        (meal ? `&meal=${encodeURIComponent(meal)}` : "")
    ),
  employees: (r: RangeState, search = "", cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<any[]>(
      `/api/employees?${rq(r)}&search=${encodeURIComponent(search)}&limit=120` + cm(cafeteriaId, meal)
    ),
  deviceReport: (r: RangeState, cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<any>(`/api/reports/device?${rq(r)}` + cm(cafeteriaId, meal)),
  employeesReport: (r: RangeState, cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<any>(`/api/reports/employees?${rq(r)}` + cm(cafeteriaId, meal)),
  employeeReport: (empId: string, r: RangeState, cafeteriaId?: number | null, meal?: string | null) =>
    getJSON<any>(`/api/reports/employee/${empId}?${rq(r)}` + cm(cafeteriaId, meal)),
  dailyReport: (r: RangeState, cafeteriaId?: number | null) =>
    getJSON<any>(`/api/reports/daily?${rq(r)}` + cm(cafeteriaId, null)),
  settlementReport: (r: RangeState, cafeteriaId?: number | null) =>
    getJSON<any>(`/api/reports/settlement?${rq(r)}` + cm(cafeteriaId, null)),
  // Detailed multi-sheet .xlsx — authed fetch → blob → browser download.
  downloadXlsx: async (r: RangeState, cafeteriaId?: number | null) => {
    const res = await authedFetch(`/api/reports/export.xlsx?${rq(r)}` + cm(cafeteriaId, null));
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = cd.match(/filename="([^"]+)"/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = m ? m[1] : "cafeteria_export.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  },

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
  createUser: (body: { username: string; name: string; password: string; role: Role; cafeterias?: number[] }) =>
    sendJSON<{ ok: boolean; error?: string; data?: ManagedUser }>(`/api/users`, "POST", body),
  updateUser: (id: number, body: { active?: boolean; name?: string; cafeterias?: number[] }) =>
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
  // ---- cafeterias / devices / meal windows ----
  cafeterias: () => getJSON<Cafeteria[]>(`/api/cafeterias`),
  createCafeteria: (name: string) =>
    sendJSON<{ ok: boolean; error?: string; data?: Cafeteria }>(`/api/cafeterias`, "POST", { name }),
  updateCafeteria: (id: number, body: { name?: string; active?: boolean }) =>
    sendJSON(`/api/cafeterias/${id}`, "PATCH", body),
  deleteCafeteria: (id: number) => sendJSON(`/api/cafeterias/${id}`, "DELETE"),
  addDevice: (body: { device_id: string; cafeteria_id: number; category: MealCategory; label?: string }) =>
    sendJSON<{ ok: boolean; error?: string; data?: Device }>(`/api/devices`, "POST", body),
  updateDevice: (
    deviceId: string,
    body: { cafeteria_id?: number; category?: MealCategory; label?: string }
  ) => sendJSON(`/api/devices/${encodeURIComponent(deviceId)}`, "PATCH", body),
  deleteDevice: (deviceId: string) =>
    sendJSON(`/api/devices/${encodeURIComponent(deviceId)}`, "DELETE"),
  saveTimeSlots: (id: number, slots: { id: number; start_time: string; end_time: string }[]) =>
    sendJSON(`/api/cafeterias/${id}/time-slots`, "PUT", { slots }),
  savePrices: (id: number, prices: { meal: string; emp_paid: number; company_paid: number }[]) =>
    sendJSON(`/api/cafeterias/${id}/prices`, "PUT", { prices }),

  auditSessions: (limit = 100) => getJSON<SessionRow[]>(`/api/audit/sessions?limit=${limit}`),
  auditStats: () =>
    getJSON<{ totalLogins: number; failed7d: number; activeSessions: number; loginsToday: number }>(
      `/api/audit/stats`
    ),
};

// Shared meal filter options (value matches punch_meals.meal; null = all).
export const MEAL_FILTERS: { k: string; label: string; val: string | null }[] = [
  { k: "all", label: "All meals", val: null },
  { k: "Lunch", label: "Lunch", val: "Lunch" },
  { k: "Dinner", label: "Dinner", val: "Dinner" },
  { k: "Tea", label: "Tea", val: "Tea" },
  { k: "Biscuit", label: "Biscuit", val: "Biscuit" },
];

// Cafeteria list for filter dropdowns (uses the open live endpoint, so staff
// roles that can't hit the admin cafeterias endpoint still get the list).
export function useCafeterias() {
  const [list, setList] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    api.liveCafeterias().then(setList).catch(() => {});
  }, []);
  return list;
}

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
