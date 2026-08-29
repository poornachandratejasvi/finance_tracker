import React, { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";

import { fetchDashboardSummary, fetchNetWorth } from "../../api/dashboard";
import { fetchCashflow, fetchBalanceTrend, fetchHeatmap, fetchTopMerchants } from "../../api/analytics";
import { getBudgetStatus } from "../../api/budgets";
import { getRewardPoints } from "../../api/rewardPoints";
import { getInvestmentsDashboard } from "../../api/investments";
import { listTransactions } from "../../api/transactions";
import { detectRecurringWatchers } from "../../api/automation";
import { getAnomalies, getPredictions } from "../../api/ai";
import { getZeroSpendStreaks } from "../../api/gamification";
import { listBanks } from "../../api/banks";
import { getWidgetFormulaValue, updateDashboardWidget, FormulaValue } from "../../api/dashboardWidgets";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { formatCurrency, formatDate } from "../../utils/format";
import { Bank, DashboardWidget } from "../../types";

// Every widget content component fetches its own data on mount, independent
// of the others, against an EXISTING endpoint (dashboard/summary,
// analytics/*, investments, reward-points, budget status) -- no new
// aggregation logic here, just presentation. Charts are plain View bars
// (matching AnalyticsScreen.tsx's existing pattern) since this app has no
// chart library dependency and adding one is unnecessary native-dependency
// risk for a bar chart.

const CHART_HEIGHT = 90;

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

// dashboard/summary is unfiltered (all-time) unless given a date range --
// every widget labeled "this period" needs to explicitly scope to the
// current month, the same way DashboardScreen.tsx does for the main screen.
function currentMonthRange(): { start_date: string; end_date: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: iso(start), end_date: iso(now) };
}

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 80 }}>
      <ActivityIndicator />
    </View>
  );
}

function Empty({ colors, text = "No data yet." }: { colors: ThemeColors; text?: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 80 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

export function NetWorthContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchNetWorth>> | null>(null);
  useEffect(() => {
    fetchNetWorth(90).then(setData).catch(() => setData({ series: [], current: null }));
  }, []);
  if (!data) return <Loading />;
  if (!data.current) return <Empty colors={colors} />;
  return (
    <View>
      <Text style={{ fontSize: 26, fontWeight: "800", color: data.current.net_worth >= 0 ? colors.text : colors.danger }}>
        {formatCurrency(data.current.net_worth)}
      </Text>
      <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
        Savings {formatCurrency(data.current.savings_total)} · Credit owed {formatCurrency(data.current.credit_total)}
      </Text>
    </View>
  );
}

export function IncomeExpenseContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchDashboardSummary>> | null>(null);
  useEffect(() => { fetchDashboardSummary(currentMonthRange()).then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  return (
    <View style={{ gap: 8 }}>
      <Row label="Income" value={formatCurrency(data.total_credit)} color={colors.primary} />
      <Row label="Expenses" value={formatCurrency(data.total_debit)} color={colors.danger} />
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6 }}>
        <Row
          label="Net"
          value={formatCurrency(data.net_balance)}
          color={data.net_balance >= 0 ? colors.primary : colors.danger}
          bold
        />
      </View>
    </View>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: colors.textSecondary, fontWeight: bold ? "700" : "400" }}>{label}</Text>
      <Text style={{ color: color || colors.text, fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

export function SpendingByCategoryContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchDashboardSummary>> | null>(null);
  useEffect(() => { fetchDashboardSummary(currentMonthRange()).then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  const rows = [...(data.category_summary || [])].sort((a, b) => Math.abs(b.total_amount) - Math.abs(a.total_amount)).slice(0, 6);
  if (!rows.length) return <Empty colors={colors} text="No spending this period." />;
  const max = Math.max(...rows.map((r) => Math.abs(r.total_amount)), 1);
  return (
    <View style={{ gap: 6 }}>
      {rows.map((r) => (
        <View key={r.category}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{r.category}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{formatCurrency(r.total_amount)}</Text>
          </View>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.chipBg, marginTop: 3 }}>
            <View style={{ height: 5, borderRadius: 3, width: `${(Math.abs(r.total_amount) / max) * 100}%`, backgroundColor: colors.primary }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CashflowTrendContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchCashflow>> | null>(null);
  useEffect(() => {
    fetchCashflow(isoDate(monthStart(-5)), isoDate(monthStart(1)), "month")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return <Loading />;
  if (!data.series.length) return <Empty colors={colors} />;
  const max = Math.max(...data.series.map((p) => Math.max(p.income, p.expense)), 1);
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: CHART_HEIGHT }}>
        {data.series.map((p) => (
          <View key={p.date} style={{ alignItems: "center", flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: CHART_HEIGHT }}>
              <View style={{ width: 6, borderRadius: 2, height: (p.income / max) * CHART_HEIGHT, backgroundColor: colors.primary }} />
              <View style={{ width: 6, borderRadius: 2, height: (p.expense / max) * CHART_HEIGHT, backgroundColor: colors.danger }} />
            </View>
            <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 4 }}>{monthLabel(p.date)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function BalanceTrendContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchBalanceTrend>> | null>(null);
  useEffect(() => {
    fetchBalanceTrend(isoDate(monthStart(-5)), isoDate(monthStart(1)), "month")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return <Loading />;
  if (data.series.length < 2) return <Empty colors={colors} text="Not enough history yet." />;
  const max = Math.max(...data.series.map((p) => Math.abs(p.balance)), 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: CHART_HEIGHT }}>
      {data.series.map((p) => (
        <View key={p.date} style={{ alignItems: "center", flex: 1 }}>
          <View
            style={{
              width: 10, borderRadius: 3,
              height: Math.max(4, (Math.abs(p.balance) / max) * CHART_HEIGHT),
              backgroundColor: p.balance >= 0 ? colors.primary : colors.danger,
            }}
          />
          <Text style={{ fontSize: 9, color: colors.textSecondary, marginTop: 4 }}>{monthLabel(p.date)}</Text>
        </View>
      ))}
    </View>
  );
}

export function BankBalancesContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchDashboardSummary>> | null>(null);
  useEffect(() => { fetchDashboardSummary().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  const banks = [...(data.balances?.banks || [])].sort((a, b) => Math.abs(b.current_balance) - Math.abs(a.current_balance));
  if (!banks.length) return <Empty colors={colors} text="No accounts yet." />;
  return (
    <View style={{ gap: 8 }}>
      {banks.map((b) => (
        <View key={b.bank_id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{b.bank_name}</Text>
          <Text style={{ color: b.bank_type === "credit" ? colors.danger : colors.text, fontWeight: "700", fontSize: 13 }}>
            {formatCurrency(b.current_balance)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function InvestmentsSummaryContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof getInvestmentsDashboard>> | null>(null);
  useEffect(() => { getInvestmentsDashboard().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  if (!data.categories.length) return <Empty colors={colors} text="No investments tracked yet." />;
  return (
    <View>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 8 }}>{formatCurrency(data.total_value)}</Text>
      <View style={{ gap: 6 }}>
        {data.categories.map((c) => (
          <View key={c.category} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "capitalize" }}>{c.category.replace("_", " ")}</Text>
            <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13 }}>{formatCurrency(c.total_value)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function RewardPointsSummaryContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof getRewardPoints>> | null>(null);
  useEffect(() => { getRewardPoints().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  if (!data.summaries.length) return <Empty colors={colors} text="No credit cards tracked yet." />;
  const total = data.summaries.reduce((s, x) => s + (x.balance || 0), 0);
  return (
    <View>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 8 }}>{total.toLocaleString()} pts</Text>
      <View style={{ gap: 6 }}>
        {data.summaries.map((s) => (
          <View key={s.bank_id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1 }} numberOfLines={1}>{s.bank_name}</Text>
            <Text style={{ color: colors.text, fontWeight: "600", fontSize: 13 }}>{s.balance.toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function RecentTransactionsContent() {
  const { colors } = useTheme();
  const [items, setItems] = useState<Awaited<ReturnType<typeof listTransactions>>["items"] | null>(null);
  useEffect(() => {
    listTransactions({ limit: 6 }).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  if (!items) return <Loading />;
  if (!items.length) return <Empty colors={colors} text="No transactions yet." />;
  return (
    <View style={{ gap: 8 }}>
      {items.map((t) => (
        <View key={t.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{t.description}</Text>
          <Text style={{ color: t.transaction_type === "credit" ? colors.primary : colors.danger, fontWeight: "700", fontSize: 13 }}>
            {t.transaction_type === "credit" ? "+" : "-"}{formatCurrency(t.amount)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function BudgetProgressContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof getBudgetStatus>> | null>(null);
  useEffect(() => { getBudgetStatus().then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  if (!data.budgets.length) return <Empty colors={colors} text="No budgets set up yet." />;
  return (
    <View style={{ gap: 10 }}>
      {data.budgets.map((b) => (
        <View key={b.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{b.category}</Text>
            <Text style={{ color: b.over ? colors.danger : colors.textSecondary, fontSize: 12 }}>
              {formatCurrency(b.spent)} / {formatCurrency(b.monthly_limit)}
            </Text>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.chipBg, marginTop: 4 }}>
            <View
              style={{
                height: 6, borderRadius: 3, width: `${Math.min(100, b.pct)}%`,
                backgroundColor: b.over ? colors.danger : b.pct > (b.alert_at_pct || 80) ? colors.warning : colors.primary,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// GitHub-contribution-style calendar: last ~17 weeks of daily spend, colored by
// intensity relative to the busiest day in range. Reuses analytics/heatmap
// (debit-only, already currency-converted) -- no client-side aggregation.
export function SpendingHeatmapContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchHeatmap>> | null>(null);
  useEffect(() => { fetchHeatmap(119).then(setData).catch(() => setData({ days: [], max_amount: 0 })); }, []);
  if (!data) return <Loading />;
  if (!data.days.length) return <Empty colors={colors} />;
  const max = data.max_amount || 1;
  const colorFor = (amt: number) => {
    if (!amt) return colors.chipBg;
    const t = Math.min(1, amt / max);
    const alpha = 0.15 + t * 0.75;
    return `rgba(228, 87, 86, ${alpha.toFixed(2)})`;
  };
  const firstDow = new Date(data.days[0].date + "T00:00:00").getDay();
  const padded: (typeof data.days[number] | null)[] = [...Array(firstDow).fill(null), ...data.days];
  const weeks: (typeof data.days[number] | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return (
    <View>
      <Text style={{ color: colors.textSecondary, fontSize: 11, marginBottom: 8 }}>
        Daily spend, last {data.days.length} days
      </Text>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {weeks.map((week, wi) => (
          <View key={wi} style={{ gap: 3 }}>
            {week.map((d, di) => (
              <View
                key={di}
                style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: d ? colorFor(d.amount) : "transparent" }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// Highest-spend merchants over the period, grouped by description signature
// (same grouping recurring_detection uses) so reference-number noise doesn't
// split one merchant into a dozen near-duplicate rows.
export function TopMerchantsContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchTopMerchants>> | null>(null);
  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = now.toISOString().slice(0, 10);
    fetchTopMerchants(start, end, 8).then(setData).catch(() => setData({ merchants: [] }));
  }, []);
  if (!data) return <Loading />;
  if (!data.merchants.length) return <Empty colors={colors} text="No spending this period." />;
  const max = Math.max(...data.merchants.map((m) => m.total), 1);
  return (
    <View style={{ gap: 10 }}>
      {data.merchants.map((m, i) => (
        <View key={i}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
            <Text style={{ color: colors.text, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>
              {m.sample_description || m.merchant}
            </Text>
            <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>{formatCurrency(m.total)}</Text>
          </View>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.chipBg, overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${(m.total / max) * 100}%`, backgroundColor: colors.primary, borderRadius: 3 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

// Subscriptions/standing-instructions the same detector powers on Settings >
// Watchers -- surfaced here as a read-only glance.
export function RecurringSubscriptionsContent() {
  const { colors } = useTheme();
  const [items, setItems] = useState<Awaited<ReturnType<typeof detectRecurringWatchers>> | null>(null);
  useEffect(() => {
    detectRecurringWatchers()
      .then((r) => setItems((r || []).slice().sort((a, b) => b.amount - a.amount).slice(0, 6)))
      .catch(() => setItems([]));
  }, []);
  if (!items) return <Loading />;
  if (!items.length) return <Empty colors={colors} text="No recurring patterns detected yet." />;
  return (
    <View style={{ gap: 10 }}>
      {items.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{r.sample_description}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{r.frequency}</Text>
          </View>
          <Text style={{ color: colors.text, fontWeight: "700", fontSize: 13 }}>{formatCurrency(r.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

// Statistical (free, no AI call) large-transaction flags -- same endpoint
// Settings > AI's anomaly tab uses, just default (non-AI) mode for a zero-cost widget.
export function SpendingAnomaliesContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof getAnomalies>> | null>(null);
  useEffect(() => { getAnomalies(false).then(setData).catch(() => setData({ anomalies: [], ai: false })); }, []);
  if (!data) return <Loading />;
  if (!data.anomalies.length) return <Empty colors={colors} text="No unusual spending detected." />;
  return (
    <View style={{ gap: 10 }}>
      {data.anomalies.map((a, i) => (
        <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{a.description}</Text>
            <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }} numberOfLines={2}>{a.reason}</Text>
          </View>
          <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 13 }}>{formatCurrency(a.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

// Statistical forecast (average interval between past occurrences of the same
// description) -- same endpoint Settings > AI's predictions tab uses.
export function CashflowForecastContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof getPredictions>> | null>(null);
  useEffect(() => { getPredictions(45).then(setData).catch(() => setData({ predictions: [], expected_income: 0, expected_expense: 0, days_ahead: 45 })); }, []);
  if (!data) return <Loading />;
  if (!data.predictions.length) return <Empty colors={colors} text="Not enough recurring history to forecast yet." />;
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
        <View>
          <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Expected in, next {data.days_ahead}d</Text>
          <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>{formatCurrency(data.expected_income)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Expected out</Text>
          <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 14 }}>{formatCurrency(data.expected_expense)}</Text>
        </View>
      </View>
      <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
        {data.predictions.slice(0, 6).map((p, i) => (
          <View key={i} style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: colors.text, fontSize: 12, flex: 1, marginRight: 8 }} numberOfLines={1}>{p.description}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{formatDate(p.predicted_date)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Zero-spend streak: consecutive days with no debit transaction at all. Pure
// engagement feature computed from existing transaction history, no new data.
export function ZeroSpendStreakContent() {
  const { colors } = useTheme();
  const [data, setData] = useState<Awaited<ReturnType<typeof getZeroSpendStreaks>> | null>(null);
  useEffect(() => { getZeroSpendStreaks(180).then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Loading />;
  return (
    <View style={{ alignItems: "center", justifyContent: "center", flex: 1 }}>
      <Text style={{ fontSize: 34, fontWeight: "800", color: colors.text }}>{data.current_streak}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, marginBottom: 6 }}>day zero-spend streak</Text>
      <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Best: {data.longest_streak} days</Text>
      {data.badges.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 8 }}>
          {data.badges.slice(-3).map((b) => (
            <View key={b} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: colors.primary, fontSize: 10, fontWeight: "600" }}>{b}</Text>
            </View>
          ))}
        </View>
      )}
      {data.next_badge && (
        <Text style={{ color: colors.textSecondary, fontSize: 10, marginTop: 8, textAlign: "center" }}>
          {data.next_badge.days_needed} more day{data.next_badge.days_needed === 1 ? "" : "s"} for "{data.next_badge.label}"
        </Text>
      )}
    </View>
  );
}

const OPERATION_LABELS: Record<string, string> = {
  sum: "Sum",
  difference: "Difference",
  average: "Average",
  percentage: "Percentage",
};
const OPERATION_JOINERS: Record<string, string> = { sum: " + ", difference: " − ", average: ", ", percentage: " ÷ " };

export interface CustomFormulaProps {
  widget?: DashboardWidget;
  onWidgetUpdated?: (w: DashboardWidget) => void;
}

// The one widget whose value isn't a read of an existing endpoint: pick 2+ of
// your own accounts and an operation, get a single derived number back (see
// backend/app/services/custom_widget_service.py). Mirrors the web version --
// takes the full widget (id + config) as a prop since it's stateful about its
// own config, unlike every other widget here.
export function CustomFormulaContent({ widget, onWidgetUpdated }: CustomFormulaProps) {
  const { colors } = useTheme();
  const config = (widget?.config || {}) as { bank_ids?: number[]; operation?: string };
  const configured = !!(config.bank_ids && config.bank_ids.length);
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [editing, setEditing] = useState(!configured);
  const [selectedIds, setSelectedIds] = useState<number[]>(config.bank_ids || []);
  const [operation, setOperation] = useState(config.operation || "sum");
  const [value, setValue] = useState<FormulaValue | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { listBanks().then(setBanks).catch(() => setBanks([])); }, []);

  useEffect(() => {
    if (!configured || !widget) return;
    getWidgetFormulaValue(widget.id).then(setValue).catch(() => setValue({ result: null, operation: "sum", currency_code: null, breakdown: [] }));
  }, [widget?.id, widget?.config, configured]);

  const toggleBank = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    if (!widget) return;
    setSaving(true);
    try {
      const updated = await updateDashboardWidget(widget.id, { config: { bank_ids: selectedIds, operation } });
      onWidgetUpdated?.(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing || !banks) {
    return (
      <View>
        {!banks ? (
          <Loading />
        ) : (
          <>
            <Text style={{ color: colors.textSecondary, fontSize: 11, marginBottom: 4 }}>Pick 2+ accounts and an operation.</Text>
            <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
              {banks.map((b) => {
                const active = selectedIds.includes(b.id);
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}
                    onPress={() => toggleBank(b.id)}
                  >
                    <View
                      style={{
                        width: 18, height: 18, borderRadius: 4, marginRight: 8,
                        borderWidth: 1.5, borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary : "transparent",
                      }}
                    />
                    <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{b.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
              {Object.entries(OPERATION_LABELS).map(([key, label]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setOperation(key)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                    backgroundColor: operation === key ? colors.primary : colors.chipBg,
                  }}
                >
                  <Text style={{ color: operation === key ? "#fff" : colors.text, fontSize: 11, fontWeight: "600" }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              onPress={save}
              disabled={selectedIds.length < 1 || saving}
              style={{
                backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10,
                alignItems: "center", opacity: selectedIds.length < 1 || saving ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>{saving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  if (!value) return <Loading />;
  if (value.result == null) return <Empty colors={colors} text="Pick accounts with a balance to see a result." />;

  return (
    <View>
      <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text }}>
        {value.operation === "percentage" ? `${value.result.toFixed(1)}%` : formatCurrency(value.result)}
      </Text>
      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2, marginBottom: 8 }} numberOfLines={1}>
        {value.breakdown.map((b) => b.bank_name).join(OPERATION_JOINERS[value.operation] || ", ")}
      </Text>
      <TouchableOpacity onPress={() => setEditing(true)}>
        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Edit formula</Text>
      </TouchableOpacity>
    </View>
  );
}
