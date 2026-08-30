import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { RouteProp, useRoute } from "@react-navigation/native";

import { fetchBalanceTrend, fetchCashflow, fetchComparison } from "../api/analytics";
import { fetchDashboardSummary } from "../api/dashboard";
import { getPredictions } from "../api/ai";
import { ThemeColors, useTheme } from "../context/ThemeContext";
import { formatCurrency, formatDate } from "../utils/format";
import { RootStackParamList } from "../navigation/RootNavigator";
import PeriodPager, { ResolvedPeriod } from "../components/PeriodPager";

type Route = RouteProp<RootStackParamList, "MetricDetail">;

const CHART_HEIGHT = 100;

// Tapping any Statistics metric card lands here -- one screen, branching by
// metric key, reusing the exact same period-scoped endpoints AnalyticsScreen
// already calls (comparison for category breakdowns, cashflow/balance-trend
// for the charts, dashboard summary for account balances, predictions for
// Outlook). Matches the reference app's per-metric drill-down (Cash Flow,
// Credit, Reports screens) at one level deep -- it stops short of the
// reference's further category -> sub-category drill, which would be a
// separate, larger feature.
export default function MetricDetailScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { params } = useRoute<Route>();
  const { metric } = params;

  const [period, setPeriod] = useState<ResolvedPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashflow, setCashflow] = useState<Awaited<ReturnType<typeof fetchCashflow>> | null>(null);
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof fetchComparison>> | null>(null);
  const [balanceTrend, setBalanceTrend] = useState<Awaited<ReturnType<typeof fetchBalanceTrend>> | null>(null);
  const [banks, setBanks] = useState<Awaited<ReturnType<typeof fetchDashboardSummary>>["balances"]["banks"]>([]);
  const [predictions, setPredictions] = useState<Awaited<ReturnType<typeof getPredictions>> | null>(null);

  const load = useCallback(async (p: ResolvedPeriod) => {
    setLoading(true);
    try {
      const start = new Date(`${p.start_date}T00:00:00Z`);
      const end = new Date(`${p.end_date}T00:00:00Z`);
      const prevEnd = new Date(start.getTime());
      const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      const needsComparison = metric === "spending" || metric === "cashflow" || metric === "income";
      const needsBalance = metric === "balance" || metric === "credit";
      const needsOutlook = metric === "outlook";

      const [cf, cmp, bt, sm, pred] = await Promise.all([
        fetchCashflow(p.start_date, p.end_date, p.granularity),
        needsComparison ? fetchComparison(p.start_date, p.end_date, iso(prevStart), iso(prevEnd)) : Promise.resolve(null),
        needsBalance ? fetchBalanceTrend(p.start_date, p.end_date, p.granularity) : Promise.resolve(null),
        needsBalance ? fetchDashboardSummary() : Promise.resolve(null),
        needsOutlook ? getPredictions(30).catch(() => null) : Promise.resolve(null),
      ]);
      setCashflow(cf);
      setComparison(cmp);
      setBalanceTrend(bt);
      setBanks(sm?.balances.banks || []);
      setPredictions(pred);
    } catch {
      // keep prior data; switching the period pager again can retry
    } finally {
      setLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    if (period) load(period);
  }, [period, load]);

  const title =
    metric === "balance" ? "Balance" :
    metric === "spending" ? "Spending" :
    metric === "cashflow" ? "Cash Flow" :
    metric === "outlook" ? "Outlook" :
    metric === "credit" ? "Credit" : "Income";

  const maxChart = cashflow?.series.reduce((m, p) => Math.max(m, p.income, p.expense), 1) || 1;
  const maxBalance = balanceTrend?.series.reduce((m, p) => Math.max(m, Math.abs(p.balance)), 1) || 1;

  const categoryList =
    metric === "income"
      ? (comparison?.period_a.income_by_category || []).slice().sort((a, b) => b.amount - a.amount)
      : (comparison?.period_a.expense_by_category || []).slice().sort((a, b) => b.amount - a.amount);

  const totalA = metric === "income" ? comparison?.period_a.income_total : comparison?.period_a.expense_total;
  const totalB = metric === "income" ? comparison?.period_b.income_total : comparison?.period_b.expense_total;
  const changePct = totalB != null && totalB > 0 && totalA != null ? Math.round(((totalA - totalB) / totalB) * 100) : null;

  const creditBanks = banks.filter((b) => b.bank_type === "credit");

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{title}</Text>
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {(metric === "spending" || metric === "cashflow" || metric === "income") && (
              <View style={styles.card}>
                <View style={styles.headerRow}>
                  <View>
                    <Text style={styles.meta}>{period?.label}</Text>
                    <Text style={styles.bigValue}>
                      {formatCurrency(
                        metric === "cashflow" ? cashflow?.totals.net ?? 0 : totalA ?? 0
                      )}
                    </Text>
                  </View>
                  {changePct != null && (
                    <View style={[styles.badge, { backgroundColor: changePct < 0 ? colors.danger : colors.primary }]}>
                      <Text style={styles.badgeText}>{changePct >= 0 ? "+" : ""}{changePct}%</Text>
                    </View>
                  )}
                </View>

                <View style={styles.chartRow}>
                  {(cashflow?.series || []).map((p) => (
                    <View key={p.date} style={styles.chartCol}>
                      <View style={styles.barPair}>
                        <View style={[styles.bar, { height: (p.income / maxChart) * CHART_HEIGHT, backgroundColor: colors.primary }]} />
                        <View style={[styles.bar, { height: (p.expense / maxChart) * CHART_HEIGHT, backgroundColor: colors.danger }]} />
                      </View>
                      <Text style={styles.chartLabel}>{formatDate(p.date)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {(metric === "spending" || metric === "income") && categoryList.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>By category</Text>
                {categoryList.slice(0, 10).map((c) => (
                  <View key={c.category} style={styles.listRow}>
                    <Text style={styles.listLabel}>{c.category}</Text>
                    <Text style={styles.listValue}>{formatCurrency(c.amount)}</Text>
                  </View>
                ))}
              </View>
            )}

            {(metric === "balance" || metric === "credit") && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>{metric === "credit" ? "Credit accounts" : "Balance trend"}</Text>
                {metric === "balance" && balanceTrend && (
                  <>
                    <View style={styles.chartRow}>
                      {balanceTrend.series.map((p) => (
                        <View key={p.date} style={styles.chartCol}>
                          <View style={styles.barPair}>
                            <View
                              style={[
                                styles.bar,
                                { height: Math.max(4, (Math.abs(p.balance) / maxBalance) * CHART_HEIGHT), backgroundColor: p.balance >= 0 ? colors.primary : colors.danger },
                              ]}
                            />
                          </View>
                          <Text style={styles.chartLabel}>{formatDate(p.date)}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.meta}>
                      Ending balance {formatCurrency(balanceTrend.ending_balance)} · Net change {formatCurrency(balanceTrend.net_change)}
                    </Text>
                  </>
                )}
                {(metric === "credit" ? creditBanks : banks).map((b) => (
                  <View key={b.bank_id} style={styles.listRow}>
                    <Text style={styles.listLabel}>{b.bank_name}</Text>
                    <Text style={[styles.listValue, { color: b.current_balance < 0 ? colors.danger : colors.text }]}>
                      {formatCurrency(b.current_balance)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {metric === "outlook" && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Expected in the next 30 days</Text>
                <View style={styles.headerRow}>
                  <View>
                    <Text style={styles.meta}>Expected income</Text>
                    <Text style={[styles.bigValue, { color: colors.primary }]}>{formatCurrency(predictions?.expected_income ?? 0)}</Text>
                  </View>
                  <View>
                    <Text style={styles.meta}>Expected expense</Text>
                    <Text style={[styles.bigValue, { color: colors.danger }]}>{formatCurrency(predictions?.expected_expense ?? 0)}</Text>
                  </View>
                </View>
                {(predictions?.predictions || []).slice(0, 10).map((p, i) => (
                  <View key={i} style={styles.listRow}>
                    <Text style={styles.listLabel} numberOfLines={1}>{p.description}</Text>
                    <Text style={styles.listValue}>{formatDate(p.predicted_date)}</Text>
                  </View>
                ))}
                {!predictions?.predictions.length && (
                  <Text style={styles.hint}>Not enough recurring history to forecast yet.</Text>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.pagerDock}>
        <PeriodPager onChange={setPeriod} />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 24 },
    title: { fontSize: 22, fontWeight: "700", color: c.text, marginBottom: 4 },
    hint: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 14 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
    meta: { fontSize: 12, color: c.textSecondary },
    bigValue: { fontSize: 26, fontWeight: "700", color: c.text, marginTop: 4 },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: c.text, marginBottom: 10 },
    chartRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
    chartCol: { alignItems: "center", flex: 1 },
    barPair: { flexDirection: "row", alignItems: "flex-end", height: CHART_HEIGHT, gap: 3 },
    bar: { width: 10, borderRadius: 3, minHeight: 2 },
    chartLabel: { fontSize: 9, color: c.textSecondary, marginTop: 6 },
    listRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    listLabel: { fontSize: 14, color: c.text, flex: 1, marginRight: 8 },
    listValue: { fontSize: 14, fontWeight: "600", color: c.text },
    pagerDock: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
  });
