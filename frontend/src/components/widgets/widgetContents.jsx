import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, LinearProgress, List, ListItem, ListItemText, Tooltip, Chip } from '@mui/material';
import {
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
  Tooltip as ReTooltip, CartesianGrid,
} from 'recharts';
import {
  getNetWorth, getAnalyticsCashflow, getBudgetStatus, getRewardPoints, getInvestmentsDashboard,
  getTransactions, getDashboardSummary, getAnalyticsHeatmap, getTopMerchants,
  detectRecurringTransactions, getAnomalies, getPredictions,
} from '../../services/api';
import { formatCurrency, formatDate, amountColor } from '../../utils/format';
import { useCategoryMeta } from '../../utils/categories';

// Every widget content component follows the same shape: fetch its own data
// on mount (independent of every other widget -- one widget's slow/failing
// endpoint never blocks another's), show a spinner, then its own visualization.
// They all reuse EXISTING backend endpoints (dashboard/summary, analytics/*,
// investments, reward points) rather than computing anything client-side.

function Loading() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 120 }}>
      <CircularProgress size={28} />
    </Box>
  );
}

// dashboard/summary is unfiltered (all-time) unless given a date range --
// every widget that labels itself "this period" needs to explicitly scope to
// the current month, the same way Dashboard.js does for the main page.
function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start_date: iso(start), end_date: iso(now) };
}

function Empty({ text = 'No data yet.' }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 120 }}>
      <Typography color="text.secondary" variant="body2">{text}</Typography>
    </Box>
  );
}

export function NetWorthContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getNetWorth(90).then(setData).catch(() => setData({ current: null, series: [] })); }, []);
  if (!data) return <Loading />;
  const { current, series } = data;
  if (!current) return <Empty />;
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h4" fontWeight={800} sx={{ color: amountColor(current.net_worth) }}>
        {formatCurrency(current.net_worth, { compact: true })}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        Savings {formatCurrency(current.savings_total, { compact: true })} · Credit owed {formatCurrency(current.credit_total, { compact: true })}
      </Typography>
      {series.length > 1 && (
        <Box sx={{ flex: 1, minHeight: 100 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <Line type="monotone" dataKey="net_worth" stroke="#4c78a8" strokeWidth={2} dot={false} />
              <XAxis dataKey="date" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <ReTooltip formatter={(v) => formatCurrency(v)} labelFormatter={(l) => formatDate(l)} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}

export function IncomeExpenseContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getDashboardSummary(currentMonthRange()).then(setData).catch(() => setData({})); }, []);
  if (!data) return <Loading />;
  const { total_credit = 0, total_debit = 0, net_balance = 0 } = data;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', justifyContent: 'center' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography color="text.secondary">Income</Typography>
        <Typography fontWeight={700} color="success.main">{formatCurrency(total_credit)}</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography color="text.secondary">Expenses</Typography>
        <Typography fontWeight={700} color="error.main">{formatCurrency(total_debit)}</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', borderTop: 1, borderColor: 'divider', pt: 1 }}>
        <Typography fontWeight={700}>Net</Typography>
        <Typography fontWeight={800} sx={{ color: amountColor(net_balance) }}>{formatCurrency(net_balance)}</Typography>
      </Box>
    </Box>
  );
}

export function SpendingByCategoryContent() {
  const [data, setData] = useState(null);
  const { getMeta } = useCategoryMeta();
  useEffect(() => { getDashboardSummary(currentMonthRange()).then(setData).catch(() => setData({})); }, []);
  if (!data) return <Loading />;
  const rows = (data.category_summary || []).slice().sort((a, b) => b.total_amount - a.total_amount).slice(0, 8);
  if (!rows.length) return <Empty text="No spending this period." />;
  const chartData = rows.map((r) => ({ name: r.category, value: Math.abs(r.total_amount), color: getMeta(r.category).color }));
  return (
    <Box sx={{ display: 'flex', gap: 1, height: '100%', alignItems: 'center' }}>
      <Box sx={{ width: '45%', height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={35} outerRadius={70} paddingAngle={2} stroke="none">
              {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <ReTooltip formatter={(v) => formatCurrency(v)} />
          </PieChart>
        </ResponsiveContainer>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', maxHeight: 200 }}>
        {chartData.map((d, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>{d.name}</Typography>
            <Typography variant="body2" fontWeight={600}>{formatCurrency(d.value, { compact: true })}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function CashflowTrendContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getAnalyticsCashflow({ granularity: 'month' }).then(setData).catch(() => setData({ series: [] })); }, []);
  if (!data) return <Loading />;
  const series = data.series || [];
  if (!series.length) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={series}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v, { compact: true })} />
        <ReTooltip formatter={(v) => formatCurrency(v)} />
        <Line type="monotone" dataKey="income" stroke="#54a24b" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="expense" stroke="#e45756" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BalanceTrendContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getNetWorth(180).then(setData).catch(() => setData({ series: [] })); }, []);
  if (!data) return <Loading />;
  const series = data.series || [];
  if (series.length < 2) return <Empty text="Not enough history yet." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={series}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v, { compact: true })} />
        <ReTooltip formatter={(v) => formatCurrency(v)} labelFormatter={(l) => formatDate(l)} />
        <Line type="monotone" dataKey="savings_total" stroke="#4c78a8" strokeWidth={2} dot={false} name="Savings" />
        <Line type="monotone" dataKey="net_worth" stroke="#72b7b2" strokeWidth={2} dot={false} name="Net worth" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BankBalancesContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getDashboardSummary().then(setData).catch(() => setData({})); }, []);
  if (!data) return <Loading />;
  const banks = (data.balances?.banks || []).slice().sort((a, b) => Math.abs(b.current_balance) - Math.abs(a.current_balance));
  if (!banks.length) return <Empty text="No accounts yet." />;
  return (
    <List dense disablePadding sx={{ height: '100%', overflowY: 'auto' }}>
      {banks.map((b) => (
        <ListItem key={b.bank_id} disableGutters sx={{ py: 0.5 }}>
          <ListItemText primary={b.bank_name} secondary={b.bank_type} />
          <Typography fontWeight={700} sx={{ color: b.bank_type === 'credit' ? 'error.main' : 'text.primary' }}>
            {formatCurrency(b.current_balance, { compact: true })}
          </Typography>
        </ListItem>
      ))}
    </List>
  );
}

export function InvestmentsSummaryContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getInvestmentsDashboard().then(setData).catch(() => setData({ categories: [], total_value: 0 })); }, []);
  if (!data) return <Loading />;
  if (!data.categories?.length) return <Empty text="No investments tracked yet." />;
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>{formatCurrency(data.total_value, { compact: true })}</Typography>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {data.categories.map((c) => (
          <Box key={c.category} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>{c.category.replace('_', ' ')}</Typography>
            <Typography variant="body2" fontWeight={600}>{formatCurrency(c.total_value, { compact: true })}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function RewardPointsSummaryContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getRewardPoints().then(setData).catch(() => setData({ summaries: [] })); }, []);
  if (!data) return <Loading />;
  const summaries = data.summaries || [];
  if (!summaries.length) return <Empty text="No credit cards tracked yet." />;
  const total = summaries.reduce((s, x) => s + (x.balance || 0), 0);
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>{total.toLocaleString()} pts</Typography>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {summaries.map((s) => (
          <Box key={s.bank_id} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" noWrap>{s.bank_name}</Typography>
            <Typography variant="body2" fontWeight={600}>{(s.balance || 0).toLocaleString()}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function RecentTransactionsContent() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    getTransactions({ limit: 6, sort_by: 'date', sort_dir: 'desc' }).then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, []);
  if (!items) return <Loading />;
  if (!items.length) return <Empty text="No transactions yet." />;
  return (
    <List dense disablePadding sx={{ height: '100%', overflowY: 'auto' }}>
      {items.map((t) => (
        <ListItem key={t.id} disableGutters sx={{ py: 0.5 }}>
          <ListItemText
            primary={t.description}
            secondary={`${formatDate(t.transaction_date)} · ${t.category || 'Uncategorized'}`}
            primaryTypographyProps={{ noWrap: true }}
          />
          <Typography fontWeight={700} sx={{ color: t.transaction_type === 'credit' ? 'success.main' : 'error.main', flexShrink: 0, pl: 1 }}>
            {t.transaction_type === 'credit' ? '+' : '-'}{formatCurrency(t.amount, { compact: true })}
          </Typography>
        </ListItem>
      ))}
    </List>
  );
}

export function BudgetProgressContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getBudgetStatus().then(setData).catch(() => setData({ budgets: [] })); }, []);
  if (!data) return <Loading />;
  const budgets = data.budgets || [];
  if (!budgets.length) return <Empty text="No budgets set up yet." />;
  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      {budgets.map((b) => (
        <Box key={b.id} sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2">{b.category}</Typography>
            <Typography variant="body2" color={b.over ? 'error.main' : 'text.secondary'}>
              {formatCurrency(b.spent, { compact: true })} / {formatCurrency(b.monthly_limit, { compact: true })}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, b.pct)}
            color={b.over ? 'error' : b.pct > (b.alert_at_pct || 80) ? 'warning' : 'primary'}
            sx={{ height: 6, borderRadius: 3 }}
          />
        </Box>
      ))}
    </Box>
  );
}

// GitHub-contribution-style calendar: last ~17 weeks of daily spend, colored by
// intensity relative to the busiest day in range. Reuses analytics/heatmap
// (debit-only, already currency-converted) -- no client-side aggregation.
export function SpendingHeatmapContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getAnalyticsHeatmap({ days: 119 }).then(setData).catch(() => setData({ days: [], max_amount: 0 })); }, []);
  if (!data) return <Loading />;
  const days = data.days || [];
  if (!days.length) return <Empty />;
  const max = data.max_amount || 1;
  const colorFor = (amt) => {
    if (!amt) return 'rgba(128,128,128,0.12)';
    const t = Math.min(1, amt / max);
    const alpha = 0.15 + t * 0.75;
    return `rgba(228, 87, 86, ${alpha.toFixed(2)})`;
  };
  // Pad to a full first week so the grid always starts on the same weekday column.
  const firstDow = new Date(days[0].date + 'T00:00:00').getDay();
  const padded = [...Array(firstDow).fill(null), ...days];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        Daily spend, last {days.length} days
      </Typography>
      <Box sx={{ display: 'flex', gap: '3px', flex: 1, overflowX: 'auto' }}>
        {weeks.map((week, wi) => (
          <Box key={wi} sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {week.map((d, di) => (
              <Tooltip key={di} title={d ? `${formatDate(d.date)}: ${formatCurrency(d.amount)}` : ''} arrow>
                <Box sx={{ width: 12, height: 12, borderRadius: '2px', bgcolor: d ? colorFor(d.amount) : 'transparent' }} />
              </Tooltip>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// Highest-spend merchants over the period, grouped by description signature
// (same grouping recurring_detection uses) so reference-number noise doesn't
// split one merchant into a dozen near-duplicate rows.
export function TopMerchantsContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getTopMerchants(currentMonthRange()).then(setData).catch(() => setData({ merchants: [] })); }, []);
  if (!data) return <Loading />;
  const merchants = data.merchants || [];
  if (!merchants.length) return <Empty text="No spending this period." />;
  const max = Math.max(...merchants.map((m) => m.total), 1);
  return (
    <Box sx={{ height: '100%', overflowY: 'auto' }}>
      {merchants.map((m, i) => (
        <Box key={i} sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
            <Typography variant="body2" noWrap sx={{ maxWidth: '65%' }}>
              {m.sample_description || m.merchant}
            </Typography>
            <Typography variant="body2" fontWeight={700}>{formatCurrency(m.total, { compact: true })}</Typography>
          </Box>
          <Box sx={{ height: 5, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${(m.total / max) * 100}%`, bgcolor: 'primary.main', borderRadius: 3 }} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// Subscriptions/standing-instructions the same detector powers on the Watchers
// page -- surfaced here as a read-only glance so you don't have to visit
// Settings to see what's recurring.
export function RecurringSubscriptionsContent() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    detectRecurringTransactions().then((r) => setItems((r || []).slice().sort((a, b) => b.amount - a.amount).slice(0, 6)))
      .catch(() => setItems([]));
  }, []);
  if (!items) return <Loading />;
  if (!items.length) return <Empty text="No recurring patterns detected yet." />;
  return (
    <List dense disablePadding sx={{ height: '100%', overflowY: 'auto' }}>
      {items.map((r, i) => (
        <ListItem key={i} disableGutters sx={{ py: 0.5 }}>
          <ListItemText
            primary={r.sample_description}
            secondary={<Chip label={r.frequency} size="small" variant="outlined" sx={{ height: 18, fontSize: 11 }} />}
            primaryTypographyProps={{ noWrap: true }}
          />
          <Typography fontWeight={700} sx={{ flexShrink: 0, pl: 1 }}>{formatCurrency(r.amount, { compact: true })}</Typography>
        </ListItem>
      ))}
    </List>
  );
}

// Statistical (free, no AI call) large-transaction flags -- same endpoint the
// Ask AI page's anomaly tab uses, just default (non-AI) mode for a zero-cost widget.
export function SpendingAnomaliesContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getAnomalies(false).then(setData).catch(() => setData({ anomalies: [] })); }, []);
  if (!data) return <Loading />;
  const anomalies = data.anomalies || [];
  if (!anomalies.length) return <Empty text="No unusual spending detected." />;
  return (
    <List dense disablePadding sx={{ height: '100%', overflowY: 'auto' }}>
      {anomalies.map((a, i) => (
        <ListItem key={i} disableGutters sx={{ py: 0.5, alignItems: 'flex-start' }}>
          <ListItemText
            primary={a.description}
            secondary={a.reason}
            primaryTypographyProps={{ noWrap: true }}
            secondaryTypographyProps={{ variant: 'caption', color: 'warning.main' }}
          />
          <Typography fontWeight={700} color="error.main" sx={{ flexShrink: 0, pl: 1 }}>
            {formatCurrency(a.amount, { compact: true })}
          </Typography>
        </ListItem>
      ))}
    </List>
  );
}

// Statistical forecast (average interval between past occurrences of the same
// description) -- same endpoint AskAI's predictions tab uses.
export function CashflowForecastContent() {
  const [data, setData] = useState(null);
  useEffect(() => { getPredictions(45).then(setData).catch(() => setData({ predictions: [] })); }, []);
  if (!data) return <Loading />;
  const predictions = data.predictions || [];
  if (!predictions.length) return <Empty text="Not enough recurring history to forecast yet." />;
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Expected in, next {data.days_ahead}d</Typography>
          <Typography fontWeight={700} color="success.main">{formatCurrency(data.expected_income, { compact: true })}</Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">Expected out</Typography>
          <Typography fontWeight={700} color="error.main">{formatCurrency(data.expected_expense, { compact: true })}</Typography>
        </Box>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', borderTop: 1, borderColor: 'divider', pt: 0.5 }}>
        {predictions.slice(0, 6).map((p, i) => (
          <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
            <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>{p.description}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatDate(p.predicted_date)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
