import React, { useEffect, useState } from "react";
import { ActivityIndicator, View, Text, StyleSheet } from "react-native";

import { fetchDashboardSummary, fetchNetWorth } from "../../api/dashboard";
import { fetchCashflow, fetchBalanceTrend } from "../../api/analytics";
import { getBudgetStatus } from "../../api/budgets";
import { getRewardPoints } from "../../api/rewardPoints";
import { getInvestmentsDashboard } from "../../api/investments";
import { listTransactions } from "../../api/transactions";
import { ThemeColors, useTheme } from "../../context/ThemeContext";
import { formatCurrency } from "../../utils/format";

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
  useEffect(() => { fetchDashboardSummary().then(setData).catch(() => setData(null)); }, []);
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
  useEffect(() => { fetchDashboardSummary().then(setData).catch(() => setData(null)); }, []);
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
