import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";

interface Props {
  savingsTotal: number | null;
  spendThisMonth: number | null;
  signedIn: boolean;
}

const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

// Android home-screen widget -- a small, always-visible balance/spend
// summary. Kept deliberately simple (no chart, no per-category breakdown):
// widget rendering happens via native RemoteViews under the hood, not a real
// browser/JS view, so it's plain text + flex layout, not the rich charts the
// in-app Analytics screen has.
export function BalanceWidget({ savingsTotal, spendThisMonth, signedIn }: Props) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        justifyContent: "center",
        backgroundColor: "#1c1c1e",
        borderRadius: 20,
        padding: 16,
      }}
    >
      <TextWidget
        text="Finance Tracker"
        style={{ fontSize: 11, color: "#9a9a9e", marginBottom: 8, fontWeight: "600" }}
      />
      {!signedIn || savingsTotal == null ? (
        <TextWidget text="Open the app to sign in" style={{ fontSize: 13, color: "#9a9a9e" }} />
      ) : (
        <>
          <TextWidget text={fmt(savingsTotal)} style={{ fontSize: 26, fontWeight: "800", color: "#ffffff" }} />
          <TextWidget text="Total balance" style={{ fontSize: 10, color: "#9a9a9e", marginBottom: 10 }} />
          {spendThisMonth != null && (
            <TextWidget
              text={`Spent this month: ${fmt(spendThisMonth)}`}
              style={{ fontSize: 12, color: "#3ddc97", fontWeight: "700" }}
            />
          )}
        </>
      )}
    </FlexWidget>
  );
}
