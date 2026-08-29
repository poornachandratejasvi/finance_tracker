import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { fetchCurrentUser, logout as apiLogout } from "../api/auth";
import { getPreferences } from "../api/users";
import { loginRequest, restoreSession, cacheUser, getCachedUser } from "../api/client";
import { User } from "../types";
import { requestAndroidPermissions } from "../utils/androidPermissions";
import { setHideDecimals } from "../utils/format";

// Best-effort -- applies "Hide decimals within amounts" app-wide once at
// startup/login; a failure here (offline first launch) just leaves the
// default (show decimals), never blocks auth.
function loadDisplayPrefs(): void {
  getPreferences()
    .then((p) => setHideDecimals(!!p?.hide_decimals))
    .catch(() => {});
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (serverUrl: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const restored = await restoreSession();
      if (restored) {
        try {
          const me = await fetchCurrentUser();
          setUser(me);
          await cacheUser(me);
          await requestAndroidPermissions();
          loadDisplayPrefs();
        } catch (err: any) {
          if (!err?.response) {
            // No server response at all -- offline/unreachable, not a rejected
            // token. Fall back to the last-known profile so a no-internet launch
            // still lands in the app (cached data) instead of forcing a login
            // screen the user can't actually complete without connectivity.
            const cached = await getCachedUser<User>();
            setUser(cached);
          } else {
            // A real response came back (401/403) -- the token is genuinely
            // invalid/revoked, so logging out is correct here.
            setUser(null);
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (serverUrl: string, username: string, password: string) => {
    await loginRequest(serverUrl, username, password);
    const me = await fetchCurrentUser();
    setUser(me);
    await cacheUser(me);
    await requestAndroidPermissions();
    loadDisplayPrefs();
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const refreshUser = async () => {
    const me = await fetchCurrentUser();
    setUser(me);
    await cacheUser(me);
  };

  const value = useMemo(
    () => ({ user, loading, isAuthenticated: !!user, login, logout, refreshUser }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
