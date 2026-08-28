import { useEffect } from "react";
import * as QuickActions from "expo-quick-actions";
import { NavigationContainerRefWithCurrent } from "@react-navigation/native";

import { RootStackParamList } from "../navigation/RootNavigator";

// Home Screen quick actions (iOS long-press menu / Android app shortcuts) --
// one expo-quick-actions API covers both platforms. Registered once at
// startup; routing a tap (cold-start via QuickActions.initial, or while
// already running via the listener) is handled by useQuickActionRouter below,
// since this app uses React Navigation (not Expo Router, which is what
// expo-quick-actions/router assumes).
export function registerQuickActions() {
  QuickActions.setItems([
    { id: "add-transaction", title: "Add Transaction", subtitle: "Log an expense or income", icon: "compose" },
    { id: "scan-receipt", title: "Scan Receipt", subtitle: "Photo → auto-filled transaction", icon: "capturePhoto" },
    { id: "search", title: "Search", subtitle: "Find a transaction", icon: "search" },
  ]);
}

function routeFor(actionId: string): keyof RootStackParamList | null {
  if (actionId === "add-transaction") return "Tabs";
  if (actionId === "scan-receipt") return "ScanReceipt";
  if (actionId === "search") return "Search";
  return null;
}

export function useQuickActionRouter(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  isReady: boolean
) {
  useEffect(() => {
    if (!isReady) return;

    const handle = (action: QuickActions.Action | null | undefined) => {
      if (!action) return;
      if (action.id === "add-transaction") {
        navigationRef.navigate("Tabs", { screen: "Add" } as never);
        return;
      }
      const route = routeFor(action.id);
      if (route) navigationRef.navigate(route as never);
    };

    // Cold start: the app was launched BY tapping a quick action.
    handle(QuickActions.initial);
    // Warm start: the app was already running/backgrounded when tapped.
    const sub = QuickActions.addListener(handle);
    return () => sub.remove();
  }, [isReady]);
}
