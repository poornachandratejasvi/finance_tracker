import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { useAuth } from "../context/AuthContext";
import { syncNow } from "./syncEngine";
import { getPendingWriteCount } from "./db";

interface OfflineContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  pendingWriteCount: number;
  triggerSync: () => void;
}

const OfflineContext = createContext<OfflineContextValue | undefined>(undefined);

// Owns network/foreground detection and kicks off syncNow() on: NetInfo
// reconnect, AppState foreground, and provider mount (covers a cold start
// that's already online with a stale queue from a previous session).
// Deliberately NOT relying on a periodic background task as the real sync
// path -- expo-background-task is OS-throttled and unreliable, especially on
// iOS; foreground/reconnect triggers are the robust baseline.
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingWriteCount, setPendingWriteCount] = useState(0);
  const wasOffline = useRef(false);

  const refreshPendingCount = async () => {
    try {
      setPendingWriteCount(await getPendingWriteCount());
    } catch {
      // ignore -- non-critical badge count
    }
  };

  const runSync = async () => {
    if (!isAuthenticated) return;
    setIsSyncing(true);
    try {
      await syncNow();
      setLastSyncedAt(new Date().toISOString());
    } finally {
      setIsSyncing(false);
      refreshPendingCount();
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    runSync(); // covers cold start with a stale queue
    refreshPendingCount();

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected;
      setIsOnline(online);
      if (online && wasOffline.current) runSync();
      wasOffline.current = !online;
    });

    const appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") runSync();
    });

    return () => {
      unsubscribeNetInfo();
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const value = useMemo(
    () => ({ isOnline, isSyncing, lastSyncedAt, pendingWriteCount, triggerSync: runSync }),
    [isOnline, isSyncing, lastSyncedAt, pendingWriteCount]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error("useOffline must be used within an OfflineProvider");
  }
  return ctx;
}
