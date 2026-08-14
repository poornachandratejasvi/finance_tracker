import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import { fetchCurrentUser, logout as apiLogout } from "../api/auth";
import { loginRequest, restoreSession } from "../api/client";
import { User } from "../types";

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
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (serverUrl: string, username: string, password: string) => {
    await loginRequest(serverUrl, username, password);
    const me = await fetchCurrentUser();
    setUser(me);
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const refreshUser = async () => {
    const me = await fetchCurrentUser();
    setUser(me);
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
