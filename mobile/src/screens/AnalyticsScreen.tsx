import React, { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchBalanceTrend, fetchCashflow, fetchComparison } from "../api/analytics";
import { useTheme, ThemeColors } from "../context/ThemeContext";
import { AnalyticsComparison, BalanceTrendResponse, CashflowResponse } from "../types";
import { formatCurrency } from "../utils/format";

const CHART_HEIGHT = 110;

function monthStart(offsetMonths: number): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
}

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [cashflow, setCashflow] = useState<CashflowResponse | null>(null);
  const [balanceTrend, setBalanceTrend] = useState<BalanceTrendResponse | null>(null);
  const [comparison, setComparison] = useState<AnalyticsComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rangeStart = isoDate(monthStart(-5));
      const rangeEnd = isoDate(monthStart(1));
      const thisMonthStart = isoDate(monthStart(0));
      const thisMonthEnd = isoDate(monthStart(1));
      const lastMonthStart = isoDate(monthStart(-1));
      const lastMonthEnd = isoDate(monthStart(0));

      const [cf, bt, cmp] = await Promise.all([
        fetchCashflow(rangeStart, rangeEnd, "month"),
        fetchBalanceTrend(rangeStart, rangeEnd, "month"),
        fetchComparison(thisMonthStart, thisMonthEnd, lastMonthStart, lastMonthEnd),
      ]);
      setCashflow(cf);
      setBalanceTrend(bt);
      setComparison(cmp);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't load analytics.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        await load();
        setLoading(false);
      })();
    }, [load])
  );

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

  const maxCashflow =
    cashflow?.series.reduce((m, p) => Math.max(m, p.income, p.expense), 1) || 1;
  const maxBalance = balanceTrend?.series.reduce((m, p) => Math.max(m, Math.abs(p.balance)), 1) || 1;

  const topExpenses = (comparison?.period_a.expense_by_category || [])
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Last 6 months</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      {cashflow && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Cash flow</Text>
          <View style={styles.row}>
            <Legend label="Income" color={colors.primary} />
            <Legend label="Expense" color={colors.danger} />
          </View>
          <View style={styles.chartRow}>
            {cashflow.series.map((p) => (
              <View key={p.date} style={styles.chartCol}>
                <View style={styles.barPair}>
                  <View
                    style={[
                      styles.bar,
                      { height: (p.income / maxCashflow) * CHART_HEIGHT, backgroundColor: colors.primary },
                    ]}
                  />
                  <View
                    style={[
                      styles.bar,
                      { height: (p.expense / maxCashflow) * CHART_HEIGHT, backgroundColor: colors.danger },
                    ]}
                  />
                </View>
                <Text style={styles.chartLabel}>{monthLabel(p.date)}</Text>
              </View>
            ))}
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalItem}>Income {formatCurrency(cashflow.totals.income)}</Text>
            <Text style={styles.totalItem}>Expense {formatCurrency(cashflow.totals.expense)}</Text>
            <Text
              style={[styles.totalItem, { color: cashflow.totals.net >= 0 ? colors.primary : colors.danger }]}
            >
              Net {formatCurrency(cashflow.totals.net)}
            </Text>
          </View>
        </View>
      )}

      {balanceTrend && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Balance trend</Text>
          <View style={styles.chartRow}>
            {balanceTrend.series.map((p) => (
              <View key={p.date} style={styles.chartCol}>
                <View style={styles.barPair}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(4, (Math.abs(p.balance) / maxBalance) * CHART_HEIGHT),
                        backgroundColor: p.balance >= 0 ? colors.primary : colors.danger,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.chartLabel}>{monthLabel(p.date)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.meta}>
            Ending balance {formatCurrency(balanceTrend.ending_balance)} · Net change{" "}
            {formatCurrency(balanceTrend.net_change)}
          </Text>
        </View>
      )}

      {topExpenses.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Top expense categories (this month)</Text>
          {topExpenses.map((c) => (
            <View key={c.category} style={styles.listRow}>
              <Text style={styles.listLabel}>{c.category}</Text>
              <Text style={styles.listValue}>{formatCurrency(c.amount)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginRight: 16 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color }}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 32, backgroundColor: c.background },
    title: { fontSize: 20, fontWeight: "700", color: c.text, marginBottom: 12 },
    error: { color: c.danger, marginBottom: 12 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 14 },
    sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 10, color: c.text },
    row: { flexDirection: "row", marginBottom: 8 },
    chartRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
    chartCol: { alignItems: "center", flex: 1 },
    barPair: { flexDirection: "row", alignItems: "flex-end", height: CHART_HEIGHT, gap: 3 },
    bar: { width: 10, borderRadius: 3, minHeight: 2 },
    chartLabel: { fontSize: 10, color: c.textSecondary, marginTop: 6 },
    totalsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 14 },
    totalItem: { fontSize: 12, color: c.text, fontWeight: "600" },
    meta: { fontSize: 12, color: c.textSecondary, marginTop: 10 },
    listRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    listLabel: { fontSize: 14, color: c.text },
    listValue: { fontSize: 14, fontWeight: "600", color: c.text },
  });
