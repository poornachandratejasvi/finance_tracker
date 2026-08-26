import { Platform } from "react-native";
import { NativeSmsMessage, SmsCredentials } from "../../modules/financetracker-native/src/FinancetrackerNative.types";

// Thin, Android-only wrapper around the local FinancetrackerNative Expo
// module (see mobile/modules/financetracker-native) -- SMS access has no iOS
// equivalent, so every function here is a safe no-op on iOS instead of every
// call site needing its own Platform.OS check.
function loadNativeModule() {
  if (Platform.OS !== "android") return null;
  // Required lazily -- importing the native module binding on iOS (where the
  // module was never compiled in, per expo-module.config.json) would throw.
  return require("../../modules/financetracker-native/src/FinancetrackerNativeModule").default;
}

export function setSmsCredentials(serverUrl: string, apiKey: string): void {
  loadNativeModule()?.setSmsCredentials(serverUrl, apiKey);
}

export function getSmsCredentials(): SmsCredentials {
  return loadNativeModule()?.getSmsCredentials() ?? { serverUrl: null, apiKey: null };
}

export function clearSmsCredentials(): void {
  loadNativeModule()?.clearSmsCredentials();
}

export function isSmsAutoDetectSupported(): boolean {
  return Platform.OS === "android";
}

export function querySmsInbox(sinceMillis: number, searchText: string, limit: number): NativeSmsMessage[] {
  return loadNativeModule()?.querySmsInbox(sinceMillis, searchText, limit) ?? [];
}
