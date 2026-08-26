import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, LinearProgress, List, ListItem, ListItemText } from '@mui/material';
import {
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
  Tooltip as ReTooltip, CartesianGrid,
} from 'recharts';
import { getNetWorth, getAnalyticsCashflow, getBudgetStatus, getRewardPoints, getInvestmentsDashboard, getTransactions, getDashboardSummary } from '../../services/api';
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
