import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchDashboardSummary, fetchLatestMonth } from "../api/dashboard";
import { useAuth } from "../context/AuthContext";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { DashboardSummary } from "../types";
import { formatCurrency } from "../utils/format";
import DashboardWidgets from "./widgets/DashboardWidgets";

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
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [monthLabel, setMonthLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const latest = await fetchLatestMonth();
      if (latest.has_data) {
        setMonthLabel(latest.month_label);
        const data = await fetchDashboardSummary({
          start_date: latest.start_date,
          end_date: latest.end_date,
        });
        setSummary(data);
      } else {
        setMonthLabel(null);
        setSummary(await fetchDashboardSummary());
      }
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
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.full_name || user?.username}</Text>
          {monthLabel && <Text style={styles.period}>{monthLabel}</Text>}
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {summary && (
        <>
          {summary.balances.banks.length > 0 && (
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

          <View style={styles.card}>
            <Text style={styles.netLabel}>Net this period</Text>
            <Text
              style={[
                styles.netValue,
                { color: summary.net_balance >= 0 ? colors.primary : colors.danger },
              ]}
            >
              {formatCurrency(summary.net_balance)}
            </Text>
            <View style={styles.row}>
              <Stat label="Income" value={formatCurrency(summary.total_credit)} color={colors.primary} />
              <Stat label="Spent" value={formatCurrency(summary.total_debit)} color={colors.danger} />
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Balances</Text>
            <View style={styles.row}>
              <Stat
                label="Savings"
                value={formatCurrency(summary.balances.savings_total)}
                color={colors.primary}
              />
              <Stat
                label="Credit owed"
                value={formatCurrency(summary.balances.credit_total)}
                color={colors.danger}
              />
            </View>
          </View>

          {summary.category_summary.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Top categories</Text>
              {summary.category_summary
                .slice()
                .sort((a, b) => b.total_amount - a.total_amount)
                .slice(0, 6)
                .map((c) => (
                  <View key={c.category} style={styles.listRow}>
                    <Text style={styles.listLabel}>{c.category}</Text>
                    <Text style={styles.listValue}>{formatCurrency(c.total_amount)}</Text>
                  </View>
                ))}
            </View>
          )}

        </>
      )}

      <DashboardWidgets />
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 32, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 16,
    },
    greeting: { fontSize: 20, fontWeight: "700", color: c.text },
    period: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
    logout: { color: c.danger, fontWeight: "600" },
    error: { color: c.danger, marginBottom: 12 },
    card: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 14,
    },
    netLabel: { fontSize: 13, color: c.textSecondary },
    netValue: { fontSize: 30, fontWeight: "700", marginTop: 4, marginBottom: 12 },
    sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10, color: c.text },
    row: { flexDirection: "row", gap: 16 },
    stat: { flex: 1 },
    statLabel: { fontSize: 12, color: c.textSecondary },
    statValue: { fontSize: 18, fontWeight: "700", marginTop: 2 },
    listRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    listLabel: { fontSize: 14, color: c.text },
    listValue: { fontSize: 14, fontWeight: "600", color: c.text },
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
