import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

import { useAuth } from "./AuthContext";

const LOCK_ENABLED_KEY = "ft_biometric_lock_enabled";

interface AppLockContextValue {
  supported: boolean;              // device has biometric/passcode hardware enrolled
  enabled: boolean;                // user has turned the lock on
  isLocked: boolean;               // lock screen should currently be shown
  setEnabled: (v: boolean) => Promise<void>;
  unlock: () => Promise<boolean>;  // prompts biometrics; returns whether it succeeded
}

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const appState = useRef(AppState.currentState);
  const loadedEnabled = useRef(false);

  useEffect(() => {
    (async () => {
      const [hasHardware, isEnrolled, storedValue] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        SecureStore.getItemAsync(LOCK_ENABLED_KEY),
      ]);
      setSupported(hasHardware && isEnrolled);
      loadedEnabled.current = true;
      setEnabledState(storedValue === "1");
    })();
  }, []);

  // Arm the lock screen once, right after the user authenticates with the app
  // and the lock feature is on -- protects the "left the app open" case, not
  // just app-relaunch.
  useEffect(() => {
    if (isAuthenticated && enabled && loadedEnabled.current) {
      setIsLocked(true);
    }
    if (!isAuthenticated) {
      setIsLocked(false);
    }
  }, [isAuthenticated, enabled]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      if (wasBackground && next === "active" && isAuthenticated && enabled) {
        setIsLocked(true);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [isAuthenticated, enabled]);

  const setEnabled = async (v: boolean) => {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, v ? "1" : "0");
    setEnabledState(v);
    if (!v) setIsLocked(false);
  };

  const unlock = async (): Promise<boolean> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Finance Tracker",
        disableDeviceFallback: false,
      });
      if (result.success) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const value = useMemo(
    () => ({ supported, enabled, isLocked, setEnabled, unlock }),
    [supported, enabled, isLocked]
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockContextValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) {
    throw new Error("useAppLock must be used within an AppLockProvider");
  }
  return ctx;
}
