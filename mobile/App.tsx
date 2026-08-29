import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "./src/context/AuthContext";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import { AppLockProvider, useAppLock } from "./src/context/AppLockContext";
import { OfflineProvider } from "./src/offline/OfflineProvider";
import RootNavigator from "./src/navigation/RootNavigator";
import AppLockScreen from "./src/components/AppLockScreen";

function AppInner() {
  const { colors } = useTheme();
  const { isLocked } = useAppLock();
  return (
    <>
      {isLocked ? <AppLockScreen /> : <RootNavigator />}
      <StatusBar style={colors.statusBarStyle} />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <AppLockProvider>
            <OfflineProvider>
              <AppInner />
            </OfflineProvider>
          </AppLockProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
