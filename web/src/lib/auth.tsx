import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setAuthToken, setUnauthorizedHandler, type AuthedUser, type Role } from "./api";

const TOKEN_KEY = "cms_token";
const USER_KEY = "cms_user";

type AuthState = {
  user: AuthedUser | null;
  ready: boolean; // finished restoring from storage
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  isSuperAdmin: boolean;
  can: (...roles: Role[]) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

// Restore token synchronously so the very first API calls are authenticated.
const bootToken = localStorage.getItem(TOKEN_KEY);
if (bootToken) setAuthToken(bootToken);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthedUser) : null;
  });
  const [ready, setReady] = useState(false);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  // Any 401 from the API drops us back to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(clearSession);
  }, [clearSession]);

  // Validate the restored token against the server on first load.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (bootToken) {
        try {
          const { user: u } = await api.me();
          if (alive) {
            setUser(u);
            localStorage.setItem(USER_KEY, JSON.stringify(u));
          }
        } catch {
          if (alive) clearSession();
        }
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [clearSession]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? "Login failed" };
    setAuthToken(res.data.token);
    localStorage.setItem(TOKEN_KEY, res.data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
    setUser(res.data.user);
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* best-effort — clear locally regardless */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      login,
      logout,
      isSuperAdmin: user?.role === "super_admin",
      can: (...roles: Role[]) => !!user && roles.includes(user.role),
    }),
    [user, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
