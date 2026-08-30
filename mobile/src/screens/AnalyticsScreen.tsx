import React, { useCallback, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { fetchBalanceTrend, fetchCashflow, fetchComparison } from "../api/analytics";
import { fetchDashboardSummary } from "../api/dashboard";
import { getPredictions } from "../api/ai";
import { useTheme, ThemeColors } from "../context/ThemeContext";
import { AnalyticsComparison, BalanceTrendResponse, CashflowResponse, DashboardSummary } from "../types";
import { formatCurrency } from "../utils/format";
import PeriodPager, { ResolvedPeriod } from "../components/PeriodPager";
import { RootStackParamList, MetricKey } from "../navigation/RootNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

// The comparison period immediately preceding the selected one, of equal
// length -- e.g. selecting "30 days" compares against the 30 days before that.
function previousPeriod(period: ResolvedPeriod): { start: string; end: string } {
  const start = new Date(`${period.start_date}T00:00:00Z`);
  const end = new Date(`${period.end_date}T00:00:00Z`);
  const spanMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - spanMs);
  return { start: isoDate(prevStart), end: isoDate(prevEnd) };
}

export default function AnalyticsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  // This screen is a tab; MetricDetail lives on the root stack (see
  // RootNavigator), so getParent() is needed to reach it.
  const tabNavigation = useNavigation<Nav>();
  const rootNavigation = tabNavigation.getParent<Nav>() || tabNavigation;

  const [period, setPeriod] = useState<ResolvedPeriod | null>(null);
  const [periodCashflow, setPeriodCashflow] = useState<CashflowResponse | null>(null);
  const [periodComparison, setPeriodComparison] = useState<AnalyticsComparison | null>(null);
  const [cashflow, setCashflow] = useState<CashflowResponse | null>(null);
  const [balanceTrend, setBalanceTrend] = useState<BalanceTrendResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [outlook, setOutlook] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The "last 6 months" trend charts further down are independent of the
  // period selector (long-term context regardless of what period the metric
  // cards above are focused on).
  const load = useCallback(async () => {
    setError(null);
    try {
      const rangeStart = isoDate(monthStart(-5));
      const rangeEnd = isoDate(monthStart(1));

      const [cf, bt, sm, pred] = await Promise.all([
        fetchCashflow(rangeStart, rangeEnd, "month"),
        fetchBalanceTrend(rangeStart, rangeEnd, "month"),
        fetchDashboardSummary(),
        getPredictions(30).catch(() => null),
      ]);
      setCashflow(cf);
      setBalanceTrend(bt);
      setSummary(sm);
      setOutlook(pred ? pred.expected_expense - pred.expected_income : null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Couldn't load analytics.");
    }
  }, []);

  // Re-fetched whenever the period selector changes -- drives the Spending/
  // Cash Flow/Income metric cards (Balance/Credit/Outlook stay period-
  // independent "current state" cards, matching the reference app).
  const loadPeriod = useCallback(async (p: ResolvedPeriod) => {
    try {
      const prev = previousPeriod(p);
      const [cf, cmp] = await Promise.all([
        fetchCashflow(p.start_date, p.end_date, p.granularity),
        fetchComparison(p.start_date, p.end_date, prev.start, prev.end),
      ]);
      setPeriodCashflow(cf);
      setPeriodComparison(cmp);
    } catch {
      // keep prior period data; the pager can be swiped again to retry
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
    await Promise.all([load(), period ? loadPeriod(period) : Promise.resolve()]);
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

  const topExpenses = (periodComparison?.period_a.expense_by_category || [])
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const incomeA = periodComparison?.period_a.income_total ?? 0;
  const incomeB = periodComparison?.period_b.income_total ?? 0;
  const incomeChangePct = incomeB > 0 ? Math.round(((incomeA - incomeB) / incomeB) * 100) : null;
  const cashflowNet = periodCashflow?.totals.net ?? 0;

  const metrics: Array<{ key: MetricKey; label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string; badge?: string }> = [
    { key: "balance", label: "Balance", value: formatCurrency(balanceTrend?.ending_balance ?? 0), icon: "analytics-outline", color: "#1565c0" },
    { key: "spending", label: "Spending", value: formatCurrency(periodCashflow?.totals.expense ?? 0), icon: "pie-chart-outline", color: "#c62828" },
    { key: "cashflow", label: "Cash Flow", value: formatCurrency(cashflowNet), icon: "swap-vertical-outline", color: cashflowNet >= 0 ? "#2e7d32" : "#c62828" },
    { key: "outlook", label: "Outlook (30d)", value: outlook != null ? formatCurrency(outlook) : "—", icon: "time-outline", color: "#757575" },
    { key: "credit", label: "Credit", value: formatCurrency(summary?.balances.credit_total ?? 0), icon: "card-outline", color: "#c62828" },
    {
      key: "income",
      label: "Income vs last period",
      value: formatCurrency(incomeA),
      icon: "trending-up-outline",
      color: "#2e7d32",
      badge: incomeChangePct != null ? `${incomeChangePct >= 0 ? "+" : ""}${incomeChangePct}%` : undefined,
    },
  ];

  return (
    <View style={styles.flex}>
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>Statistics</Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.metricGrid}>
        {metrics.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={styles.metricCard}
            activeOpacity={0.7}
            onPress={() => rootNavigation.navigate("MetricDetail", { metric: m.key })}
          >
            <View style={styles.metricTop}>
              <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
              <View style={[styles.metricIcon, { backgroundColor: m.color }]}>
                <Ionicons name={m.icon} size={14} color="#fff" />
              </View>
            </View>
            <Text style={styles.metricValue} numberOfLines={1}>{m.value}</Text>
            {m.badge && (
              <Text style={[styles.metricBadge, { color: m.badge.startsWith("-") ? colors.danger : colors.primary }]}>
                {m.badge} vs previous
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.title}>Last 6 months</Text>

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
          <Text style={styles.sectionTitle}>Top expense categories ({period?.label?.toLowerCase() || "this period"})</Text>
          {topExpenses.map((c) => (
            <View key={c.category} style={styles.listRow}>
              <Text style={styles.listLabel}>{c.category}</Text>
              <Text style={styles.listValue}>{formatCurrency(c.amount)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>

      <View style={styles.pagerDock}>
        <PeriodPager
          onChange={(p) => {
            setPeriod(p);
            loadPeriod(p);
          }}
        />
      </View>
    </View>
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
    flex: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.background },
    pagerDock: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
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
    metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
    metricCard: { width: "47%", backgroundColor: c.card, borderRadius: 12, padding: 12 },
    metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    metricLabel: { fontSize: 11, color: c.textSecondary, textTransform: "uppercase", fontWeight: "600", flexShrink: 1 },
    metricIcon: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
    metricValue: { fontSize: 17, fontWeight: "700", color: c.text },
    metricBadge: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  });
