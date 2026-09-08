import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { fetchCurrentUser, logout as apiLogout } from "../api/auth";
import { getPreferences } from "../api/users";
import { loginRequest, restoreSession, cacheUser, getCachedUser } from "../api/client";
import { User } from "../types";
import { requestAndroidPermissions } from "../utils/androidPermissions";
import { registerForPushNotificationsAsync } from "../utils/pushNotifications";
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
          registerForPushNotificationsAsync();
          loadDisplayPrefs();
        } catch (err: any) {
          if (err?.response?.status === 401 || err?.response?.status === 403) {
            // The token (or its refresh, transparently attempted by the
            // interceptor) was genuinely rejected -- logging out is correct.
            setUser(null);
          } else {
            // No response at all (offline/unreachable), or a non-auth error
            // (500, 429, a flaky connection mid-refresh, ...) -- none of these
            // mean the session is actually invalid. Fall back to the
            // last-known profile so a rough network moment never forces a
            // login screen the user can't even complete without connectivity.
            const cached = await getCachedUser<User>();
            setUser(cached);
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
    registerForPushNotificationsAsync();
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
