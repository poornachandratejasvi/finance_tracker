import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface ThemeColors {
  background: string;
  card: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
  danger: string;
  warning: string;
  chipBg: string;
  inputBg: string;
  inputBorder: string;
  statusBarStyle: "light" | "dark";
}

const LIGHT: ThemeColors = {
  background: "#f2f4f3",
  card: "#f7f7f7",
  text: "#222222",
  textSecondary: "#777777",
  border: "#dddddd",
  primary: "#1b6b4c",
  danger: "#b3261e",
  warning: "#b8860b",
  chipBg: "#f0f0f0",
  inputBg: "#ffffff",
  inputBorder: "#cccccc",
  statusBarStyle: "dark",
};

const DARK: ThemeColors = {
  background: "#0f0f0f",
  card: "#1c1c1e",
  text: "#f2f2f2",
  textSecondary: "#9a9a9a",
  border: "#333333",
  primary: "#3ddc97",
  danger: "#ff6b6b",
  warning: "#e0b341",
  chipBg: "#2a2a2c",
  inputBg: "#1c1c1e",
  inputBorder: "#444444",
  statusBarStyle: "light",
};

export type ThemeMode = "system" | "light" | "dark";
const PREF_KEY = "ft_theme_mode";

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY).then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") {
        setModeState(saved);
      }
    });
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    SecureStore.setItemAsync(PREF_KEY, m).catch(() => {});
  };

  const isDark = mode === "system" ? systemScheme === "dark" : mode === "dark";
  const colors = isDark ? DARK : LIGHT;

  const value = useMemo(
    () => ({ colors, isDark, mode, setMode }),
    [colors, isDark, mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
