import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";

// Must match app.json's ios.entitlements app group AND targets/widget/
// expo-target.config.js's entitlements (both reference the same value) --
// this is the shared storage the WidgetKit extension (Widget.swift) reads
// from, since it can't make its own authenticated API calls.
const APP_GROUP = "group.com.poornachandratejasvi.financetracker";

// Called from DashboardScreen's load() -- iOS-only (Android's widget instead
// pulls fresh data itself via a headless JS task, see widgetTaskHandler.ts).
export function syncIosWidgetData(savingsTotal: number | null, spendThisMonth: number | null): void {
  if (Platform.OS !== "ios") return;
  const storage = new ExtensionStorage(APP_GROUP);
  if (savingsTotal == null) {
    storage.remove("savingsTotal");
  } else {
    storage.set("savingsTotal", Math.round(savingsTotal));
  }
  if (spendThisMonth == null) {
    storage.remove("spendThisMonth");
  } else {
    storage.set("spendThisMonth", Math.round(spendThisMonth));
  }
  ExtensionStorage.reloadWidget();
}
