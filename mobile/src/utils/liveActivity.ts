import { Platform } from "react-native";

// Thin, iOS-only wrapper around the local FinancetrackerNative Expo module
// (see mobile/modules/financetracker-native) -- Live Activity/Dynamic Island
// has no Android equivalent, so every function here is a safe no-op on
// Android instead of every call site needing its own Platform.OS check.
// Mirrors mobile/src/utils/smsNative.ts's (inverse) gating pattern exactly.
function loadNativeModule() {
  if (Platform.OS !== "ios") return null;
  // Required lazily -- importing the native module binding on Android (where
  // these functions were never compiled in, per expo-module.config.json)
  // would throw.
  return require("../../modules/financetracker-native/src/FinancetrackerNativeModule").default;
}

export function isLiveActivitySupported(): boolean {
  return loadNativeModule()?.isLiveActivitySupported() ?? false;
}

export function startTodaySpendActivity(spentToday: number, currencySymbol: string): boolean {
  return loadNativeModule()?.startTodaySpendActivity(spentToday, currencySymbol) ?? false;
}

export function updateTodaySpendActivity(spentToday: number, currencySymbol: string): void {
  loadNativeModule()?.updateTodaySpendActivity(spentToday, currencySymbol);
}

export function endTodaySpendActivity(): void {
  loadNativeModule()?.endTodaySpendActivity();
}
