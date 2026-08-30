import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchDashboardSummary } from "../api/dashboard";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { DashboardSummary } from "../types";
import { formatCurrency } from "../utils/format";
import DashboardWidgets from "./widgets/DashboardWidgets";
import FloatingAddButton from "../components/FloatingAddButton";

// A distinct color per account type -- used for the colored square icon on
// the horizontal account-card row, matching the reference app's per-account
// colored icons (this app has no per-bank custom icon/logo upload, so the
// type-based color is the closest equivalent without new backend work).
const BANK_TYPE_COLORS: Record<string, string> = {
  savings: "#1e88e5",
  checking: "#1e88e5",
  credit: "#e53935",
  loan: "#e53935",
  investment: "#8e24aa",
  cash: "#43a047",
  wallet: "#fb8c00",
};
function bankTypeColor(type: string | null): string {
  return BANK_TYPE_COLORS[(type || "").toLowerCase()] || "#546e7a";
}

export default function DashboardScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only used for the account carousel now -- the "Net this period"/
  // "Balances"/"Top categories" cards this used to also feed were dropped in
  // favor of the widget feed below (income_expense/spending_by_category
  // widgets cover the same ground and are seeded by default), matching the
  // reference app's single unified feed instead of duplicating content above
  // it.
  const load = useCallback(async () => {
    setError(null);
    try {
      setSummary(await fetchDashboardSummary());
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't load the dashboard.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error && <Text style={styles.error}>{error}</Text>}

      {summary && summary.balances.banks.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.accountRow}
          contentContainerStyle={styles.accountRowContent}
        >
          {summary.balances.banks.map((b) => (
            <View key={b.bank_id} style={styles.accountCard}>
              <View style={[styles.accountIcon, { backgroundColor: bankTypeColor(b.bank_type) }]}>
                <Text style={styles.accountIconText}>{(b.bank_name || "?").charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.accountName} numberOfLines={1}>{b.bank_name}</Text>
              <Text
                style={[styles.accountBalance, { color: b.current_balance < 0 ? colors.danger : colors.text }]}
                numberOfLines={1}
              >
                {formatCurrency(b.current_balance)}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <DashboardWidgets />
    </ScrollView>
      <FloatingAddButton />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 32, backgroundColor: c.background },
    error: { color: c.danger, marginBottom: 12 },
    // Fixed height + flexGrow/flexShrink:0 on the row, alignItems on its content --
    // same fix as the transactions range-chip row: without these, a horizontal
    // ScrollView's children can stretch to fill all available vertical space
    // instead of sizing to each card's own content.
    accountRow: { height: 100, marginBottom: 16, marginHorizontal: -16, flexGrow: 0, flexShrink: 0 },
    accountRowContent: { paddingHorizontal: 16, gap: 10, alignItems: "flex-start" },
    accountCard: {
      width: 130,
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 12,
    },
    accountIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 10,
    },
    accountIconText: { color: "#fff", fontWeight: "700", fontSize: 14 },
    accountName: { fontSize: 12, color: c.textSecondary, marginBottom: 2 },
    accountBalance: { fontSize: 15, fontWeight: "700" },
  });
