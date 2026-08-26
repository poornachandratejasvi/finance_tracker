import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "./src/context/AuthContext";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import { OfflineProvider } from "./src/offline/OfflineProvider";
import RootNavigator from "./src/navigation/RootNavigator";

function AppInner() {
  const { colors } = useTheme();
  return (
    <>
      <RootNavigator />
      <StatusBar style={colors.statusBarStyle} />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <OfflineProvider>
            <AppInner />
          </OfflineProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
