import React from "react";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";

import { restoreSession } from "../api/client";
import { fetchDashboardSummary } from "../api/dashboard";
import { BalanceWidget } from "./BalanceWidget";

const WIDGET_NAME = "Balance";

// Runs as a headless JS task, independent of whether the app is foregrounded
// -- triggered on add/resize/periodic-update/click. Best-effort: a network or
// auth failure just renders the "open the app" fallback rather than crashing
// the widget, same defensive style as AuthContext's cached-profile fallback.
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;

  if (props.widgetAction === "WIDGET_CLICK" || props.widgetAction === "WIDGET_DELETED") {
    return;
  }

  let savingsTotal: number | null = null;
  let spendThisMonth: number | null = null;
  let signedIn = false;

  try {
    signedIn = await restoreSession();
    if (signedIn) {
      const summary = await fetchDashboardSummary();
      savingsTotal = summary.balances.savings_total - summary.balances.credit_total;
      spendThisMonth = summary.total_debit;
    }
  } catch {
    // leave nulls -- BalanceWidget renders its own fallback text
  }

  props.renderWidget(
    React.createElement(BalanceWidget, { savingsTotal, spendThisMonth, signedIn })
  );
}
