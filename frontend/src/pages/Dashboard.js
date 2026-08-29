import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Paper, Grid, Typography, IconButton, CircularProgress, LinearProgress,
  Alert, ToggleButton, ToggleButtonGroup, Button, Chip, useTheme,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Add, Refresh, AutoAwesome,
  WarningAmber, Summarize, CreditCard, Savings, AccountBalance, AccountBalanceWallet,
  Whatshot,
} from '@mui/icons-material';
import {
  ResponsiveContainer, PieChart, Pie, Cell, ComposedChart, Bar, Area,
  XAxis, YAxis, Tooltip as ReTooltip, CartesianGrid,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import CategoryIcon from '../components/CategoryIcon.jsx';
import RecurringTransactionsCard from '../components/RecurringTransactionsCard.jsx';
import DashboardWidgets from '../components/widgets/DashboardWidgets.jsx';
import { formatCurrency, formatDate, signedAccountBalance, timeAgo } from '../utils/format';
import { useCategoryMeta } from '../utils/categories';
import api, {
  getBanks, getTransactions, getAnalyticsComparison, getAnalyticsCashflow,
  getPredictions, getAIInsights, getAnomalies, getAISummary, getAIRoast, getNetWorth,
} from '../services/api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Local YYYY-MM-DD (avoids the UTC shift that toISOString() introduces).
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Day-of-month tick for the day-granularity comparison chart.
const dayTick = (d) => {
  if (!d) return '';
  const p = String(d).split('-');
  return p[2] || String(d);
};

// Accent color for an account: its own color, else a type-based default.
const bankColor = (bank) => {
  if (bank?.color) return bank.color;
  const t = (bank?.bank_type || '').toLowerCase();
  if (t === 'credit') return '#b07aa1';
  if (t === 'savings') return '#4e79a7';
  return '#59a14f';
};

// Type-based icon for an account tile.
const BankTypeIcon = ({ bank, ...props }) => {
  const t = (bank?.bank_type || '').toLowerCase();
  if (t === 'credit') return <CreditCard {...props} />;
  if (t === 'savings') return <Savings {...props} />;
  if (t === 'wallet' || t === 'cash') return <AccountBalanceWallet {...props} />;
  return <AccountBalance {...props} />;
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
const NEUTRAL = '#bab0ac';

// Simple SVG semicircular arc gauge (top half). fraction in [0,1].
function Gauge({ fraction, color, track }) {
  const size = 160;
  const sw = 14;
  const r = (size - sw) / 2;
  const cx = size / 2;
  const cy = r + sw / 2;
  const polar = (deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const f = clamp01(fraction);
  const p0 = polar(180);
  const p1 = polar(360);
  const pf = polar(180 + f * 180);
  const bg = `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y}`;
  const fg = `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${pf.x} ${pf.y}`;
  return (
    <svg
      viewBox={`0 0 ${size} ${cy + sw / 2 + 2}`}
      width="100%"
      style={{ maxWidth: 180, display: 'block', margin: '0 auto' }}
    >
      <path d={bg} fill="none" stroke={track} strokeWidth={sw} strokeLinecap="round" />
      {f > 0.001 && (
        <path d={fg} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      )}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="22" fontWeight="700" fill={color}>
        {Math.round(f * 100)}%
      </text>
    </svg>
  );
}

function Dashboard() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { getMeta } = useCategoryMeta();

  const now = new Date();
  const [monthDate, setMonthDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));

  const [banks, setBanks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [cashflow, setCashflow] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cmpMetric, setCmpMetric] = useState('net'); // net | expense | income

  // Upcoming predictions (statistical, works without any AI key) + AI insights.
  const [predictions, setPredictions] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Unusual activity (works without an AI key — statistical fallback) + monthly AI summary.
  const [anomalies, setAnomalies] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // "Roast Me" — opt-in, blunt AI commentary on spending habits.
  const [roast, setRoast] = useState(null);
  const [roastLoading, setRoastLoading] = useState(false);

  // Net worth trend (daily balance snapshots, period-independent).
  const [netWorth, setNetWorth] = useState(null);

  // Derived period boundaries (current + previous month) + labels.
  const periods = useMemo(() => {
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const curStart = new Date(y, m, 1);
    const curEnd = new Date(y, m + 1, 0);
    const prevStart = new Date(y, m - 1, 1);
    const prevEnd = new Date(y, m, 0);
    return {
      curStart: toISO(curStart),
      curEnd: toISO(curEnd),
      prevStart: toISO(prevStart),
      prevEnd: toISO(prevEnd),
      curLabel: `${MONTHS[m]} ${y}`,
      prevLabel: `${MONTHS[(m + 11) % 12]} ${prevStart.getFullYear()}`,
    };
  }, [monthDate]);

  // Accounts are period-independent, loaded once.
  useEffect(() => {
    getBanks()
      .then((b) => setBanks(Array.isArray(b) ? b : []))
      .catch(() => setBanks([]));
  }, []);

  // Net worth trend is also period-independent (its own 180-day window).
  useEffect(() => {
    getNetWorth(180)
      .then((d) => setNetWorth(d))
      .catch(() => setNetWorth(null));
  }, []);

  // Period-dependent data.
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sumRes, cmp, cf, txns] = await Promise.all([
        api
          .get('/api/dashboard/summary', {
            params: { start_date: periods.curStart, end_date: periods.curEnd },
          })
          .then((r) => r.data)
          .catch(() => null),
        getAnalyticsComparison({
          start_a: periods.curStart,
          end_a: periods.curEnd,
          start_b: periods.prevStart,
          end_b: periods.prevEnd,
          label_a: periods.curLabel,
          label_b: periods.prevLabel,
        }).catch(() => null),
        getAnalyticsCashflow({
          start_date: periods.curStart,
          end_date: periods.curEnd,
          granularity: 'day',
        }).catch(() => null),
        getTransactions({ limit: 8, start_date: periods.curStart, end_date: periods.curEnd })
          .catch(() => ({ items: [] })),
      ]);
      setSummary(sumRes);
      setComparison(cmp);
      setCashflow(cf);
      setRecent(Array.isArray(txns?.items) ? txns.items : (Array.isArray(txns) ? txns : []));
    } catch (_) {
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [periods]);

  useEffect(() => { load(); }, [load]);

  // Predicted upcoming transactions (statistical — no AI key required).
  useEffect(() => {
    getPredictions(45)
      .then((d) => setPredictions(d || { predictions: [] }))
      .catch(() => setPredictions({ predictions: [] }));
  }, []);

  // AI insights — cached on mount (no provider call); the card's button (re)generates.
  const loadInsights = useCallback((generate = false) => {
    setInsightsLoading(true);
    getAIInsights(generate)
      .then((d) => setInsights(d || { insight: '', ai: false }))
      .catch(() => setInsights({ insight: 'Unable to load AI insights right now.', ai: false }))
      .finally(() => setInsightsLoading(false));
  }, []);

  useEffect(() => { loadInsights(false); }, [loadInsights]);

  // Unusual activity — statistical fallback works with no AI key, so not gated on AI config.
  useEffect(() => {
    getAnomalies()
      .then((d) => setAnomalies(d || { anomalies: [] }))
      .catch(() => setAnomalies({ anomalies: [] }));
  }, []);

  // Monthly AI summary — cached on mount (no provider call); the card's button (re)generates.
  const loadSummary = useCallback((generate = false) => {
    setSummaryLoading(true);
    getAISummary(generate)
      .then((d) => setAiSummary(d || { summary: '', ai: false }))
      .catch(() => setAiSummary({ summary: '', ai: false }))
      .finally(() => setSummaryLoading(false));
  }, []);

  useEffect(() => { loadSummary(false); }, [loadSummary]);

  // "Roast Me" — opt-in blunt AI commentary on spending. Cached on mount (no
  // provider call); the card's button (re)generates.
  const loadRoast = useCallback((generate = false) => {
    setRoastLoading(true);
    getAIRoast(generate)
      .then((d) => setRoast(d || { roast: '', ai: false }))
      .catch(() => setRoast({ roast: '', ai: false }))
      .finally(() => setRoastLoading(false));
  }, []);

  useEffect(() => { loadRoast(false); }, [loadRoast]);

  // Base currency for aggregate money (echoed by the comparison endpoint).
  const baseCcy = useMemo(
    () => comparison?.base_currency || { code: 'INR', symbol: '₹' },
    [comparison]
  );
  const money = useCallback(
    (v, opts = {}) => formatCurrency(v, { symbol: baseCcy.symbol, currency: baseCcy.code, ...opts }),
    [baseCcy]
  );
  const moneyC = useCallback((v) => money(v, { compact: true }), [money]);

  const shiftMonth = (delta) =>
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  // ── Derived values ──
  const balances = summary?.balances || {};
  const savingsTotal = Number(balances.savings_total || 0);
  const creditTotal = Number(balances.credit_total || 0);
  const totalDebit = Number(summary?.total_debit || 0);
  const totalCredit = Number(summary?.total_credit || 0);

  const cfTotals = cashflow?.totals || {};
  const income = Number(cfTotals.income != null ? cfTotals.income : totalCredit);
  const expense = Number(cfTotals.expense != null ? cfTotals.expense : totalDebit);
  const cashNet = Number(
    cfTotals.net != null ? cfTotals.net : (summary?.net_balance != null ? summary.net_balance : income - expense)
  );

  // Gauge fill fractions (all clamped 0..1, defensive against no income).
  const worthBase = Math.abs(savingsTotal) + Math.abs(creditTotal);
  const balanceFrac = worthBase > 0 ? clamp01(savingsTotal / worthBase) : (savingsTotal !== 0 ? 1 : 0);
  const cashFrac = income > 0 ? clamp01(cashNet / income) : (cashNet > 0 ? 1 : 0);
  const spendFrac = income > 0 ? clamp01(expense / income) : (expense > 0 ? 1 : 0);

  // Expenses structure donut (top 8 by category color, rest → "Other").
  const expenseCats = (comparison?.period_a?.expense_by_category || [])
    .filter((c) => Math.abs(c.amount || 0) > 0);
  const donutTop = expenseCats.slice(0, 8).map((c) => ({
    name: c.category || 'Unknown',
    value: Math.abs(c.amount || 0),
    color: getMeta(c.category).color || NEUTRAL,
  }));
  const restSum = expenseCats.slice(8).reduce((s, c) => s + Math.abs(c.amount || 0), 0);
  const donutData = restSum > 0
    ? [...donutTop, { name: 'Other', value: restSum, color: NEUTRAL }]
    : donutTop;

  // VS previous period spending delta.
  const curExp = Number(comparison?.period_a?.expense_total || 0);
  const prevExp = Number(comparison?.period_b?.expense_total || 0);
  const deltaPct = prevExp > 0 ? ((curExp - prevExp) / prevExp) * 100 : (curExp > 0 ? 100 : 0);
  const spendingUp = curExp > prevExp + 0.005;
  const spendingDown = curExp < prevExp - 0.005;

  // Period comparison chart.
  const cmpSeries = cashflow?.series || [];
  const cmpColor = cmpMetric === 'expense'
    ? theme.palette.error.main
    : cmpMetric === 'income'
      ? theme.palette.success.main
      : theme.palette.primary.main;
  const cmpLabel = cmpMetric === 'expense' ? 'Expense' : cmpMetric === 'income' ? 'Income' : 'Cash flow';

  // Upcoming predictions: nearest-date first, capped to a readable handful.
  const predList = useMemo(() => {
    const arr = Array.isArray(predictions?.predictions) ? predictions.predictions : [];
    return [...arr]
      .sort((a, b) => String(a.predicted_date || '').localeCompare(String(b.predicted_date || '')))
      .slice(0, 8);
  }, [predictions]);
  const expectedIncome = Number(predictions?.expected_income || 0);
  const expectedExpense = Number(predictions?.expected_expense || 0);
  const insightLines = String(insights?.insight || '').split('\n');

  const anomalyList = Array.isArray(anomalies?.anomalies) ? anomalies.anomalies : [];
  const summaryLines = String(aiSummary?.summary || '').split('\n');
  const roastLines = String(roast?.roast || '').split('\n');

  const track = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const tooltipStyle = {
    borderRadius: 8,
    border: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    background: theme.palette.background.paper,
  };

  // bank_type='investment' rows exist only so CAS/PPF statement emails can be
  // auto-downloaded (see the Add Bank form) -- they're not real balance-bearing
  // accounts, so they're excluded from this accounts-at-a-glance list.
  const visibleBanks = banks.filter((b) => !b.is_archived && b.bank_type !== 'investment');

  const gauges = [
    {
      key: 'bal',
      title: 'Balance',
      frac: balanceFrac,
      color: theme.palette.primary.main,
      value: savingsTotal,
      valColor: savingsTotal < 0 ? 'error.main' : 'text.primary',
      prefix: '',
    },
    {
      key: 'cf',
      title: 'Cash Flow',
      frac: cashFrac,
      color: cashNet >= 0 ? theme.palette.success.main : theme.palette.error.main,
      value: cashNet,
      valColor: cashNet >= 0 ? 'success.main' : 'error.main',
      prefix: cashNet > 0 ? '+' : '',
    },
    {
      key: 'spend',
      title: 'Spending',
      frac: spendFrac,
      color: theme.palette.warning.main,
      value: expense,
      valColor: 'text.primary',
      prefix: '',
    },
  ];

  if (loading && !summary) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* ── Account tiles grid (compact, wraps to multiple rows) ── */}
      <Grid container spacing={1.5} sx={{ mb: 3 }}>
        {visibleBanks.map((b) => {
          const c = bankColor(b);
          const signed = signedAccountBalance(b);
          return (
            <Grid item xs={6} sm={4} md={3} lg={2.4} key={b.id}>
              <Paper
                onClick={() => navigate(`/transactions?bank_id=${b.id}`)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1.25,
                  height: '100%',
                  cursor: 'pointer',
                  color: '#fff',
                  background: c,
                  borderRadius: 2,
                  transition: 'transform .2s',
                  '&:hover': { transform: 'translateY(-2px)' },
                }}
              >
                <BankTypeIcon
                  bank={b}
                  fontSize="small"
                  sx={{ color: '#fff', flexShrink: 0, opacity: 0.95 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    noWrap
                    component="div"
                    sx={{ opacity: 0.9, fontWeight: 600, lineHeight: 1.2 }}
                  >
                    {b.name}
                  </Typography>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      fontWeight: 700,
                      lineHeight: 1.3,
                      color: signed < 0 ? '#ffd0d0' : '#fff',
                    }}
                  >
                    {formatCurrency(signed, { currency: b.currency_code })}
                  </Typography>
                </Box>
              </Paper>
            </Grid>
          );
        })}

        <Grid item xs={6} sm={4} md={3} lg={2.4}>
          <Paper
            onClick={() => navigate('/banks')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
              p: 1.25,
              height: '100%',
              minHeight: 56,
              cursor: 'pointer',
              border: '2px dashed',
              borderColor: 'divider',
              bgcolor: 'transparent',
              boxShadow: 'none',
              borderRadius: 2,
              '&:hover': { borderColor: 'primary.main' },
            }}
          >
            <Add color="action" fontSize="small" />
            <Typography variant="body2" color="text.secondary" noWrap>
              Add Account
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      <DashboardWidgets />

      {/* ── Period selector ── */}
      <Paper
        variant="outlined"
        sx={{ p: 1, mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}
      >
        <IconButton size="small" onClick={() => shiftMonth(-1)} aria-label="Previous month">
          <ChevronLeft />
        </IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ minWidth: 180, textAlign: 'center' }}>
          {periods.curLabel}
        </Typography>
        <IconButton size="small" onClick={() => shiftMonth(1)} aria-label="Next month">
          <ChevronRight />
        </IconButton>
      </Paper>

      {/* ── Gauges ── */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2}>
          {gauges.map((g) => (
            <Grid item xs={12} sm={4} key={g.key}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {g.title}
                </Typography>
                <Gauge fraction={g.frac} color={g.color} track={track} />
                <Typography variant="h6" fontWeight={700} sx={{ color: g.valColor, mt: 0.5 }}>
                  {g.prefix}{moneyC(g.value)}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Grid container spacing={3}>
        {/* ── Expenses structure donut ── */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
              <Typography variant="h6">Expenses Structure</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    color: spendingUp ? 'error.main' : spendingDown ? 'success.main' : 'text.secondary',
                  }}
                >
                  {spendingUp ? <TrendingUp fontSize="small" /> : spendingDown ? <TrendingDown fontSize="small" /> : null}
                  <Typography variant="body2" fontWeight={700} sx={{ ml: 0.25 }}>
                    {Math.abs(deltaPct).toFixed(0)}%
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">vs previous period</Typography>
              </Box>
            </Box>

            {donutData.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4 }}>No expenses this period.</Typography>
            ) : (
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <ReTooltip formatter={(v) => money(v)} contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Box sx={{ maxHeight: 240, overflowY: 'auto' }}>
                    {donutData.map((d, i) => (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                        <CategoryIcon name={d.name} size={24} />
                        <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>{d.name}</Typography>
                        <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                          {money(d.value)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Grid>
              </Grid>
            )}
          </Paper>
        </Grid>

        {/* ── Accounts widget ── */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Accounts</Typography>
            {visibleBanks.length === 0 ? (
              <Typography color="text.secondary">No accounts yet. Add a bank to get started.</Typography>
            ) : visibleBanks.map((b) => {
              const signed = signedAccountBalance(b);
              return (
                <Box
                  key={b.id}
                  onClick={() => navigate(`/transactions?bank_id=${b.id}`)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    py: 1,
                    cursor: 'pointer',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: bankColor(b), flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{b.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {timeAgo(b.last_synced_at || b.last_transaction_at)}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    sx={{ whiteSpace: 'nowrap', color: signed < 0 ? 'error.main' : 'text.primary' }}
                  >
                    {formatCurrency(signed, { currency: b.currency_code })}
                  </Typography>
                </Box>
              );
            })}
          </Paper>
        </Grid>

        {/* ── Period comparison ── */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6">Period Comparison</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={cmpMetric}
                onChange={(_, v) => v && setCmpMetric(v)}
              >
                <ToggleButton value="net">Cash flow</ToggleButton>
                <ToggleButton value="expense">Expense</ToggleButton>
                <ToggleButton value="income">Income</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {cmpSeries.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4 }}>No data for this period.</Typography>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={cmpSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="date" tickFormatter={dayTick} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={moneyC} tick={{ fontSize: 11 }} width={60} />
                  <ReTooltip formatter={(v) => money(v)} contentStyle={tooltipStyle} />
                  <Bar dataKey={cmpMetric} name={cmpLabel} fill={cmpColor} radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        {/* ── Net worth trend ── */}
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6">Net Worth</Typography>
              {netWorth?.current && (
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {money(netWorth.current.net_worth)}
                </Typography>
              )}
            </Box>
            {!netWorth || netWorth.series.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4 }}>
                Not enough history yet — net worth is snapshotted daily.
              </Typography>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={netWorth.series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dayTick} tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={moneyC} tick={{ fontSize: 11 }} width={60} />
                  <ReTooltip formatter={(v) => money(v)} contentStyle={tooltipStyle} />
                  <Area
                    type="monotone" dataKey="net_worth" name="Net Worth"
                    stroke={theme.palette.primary.main} strokeWidth={2}
                    fill="url(#netWorthFill)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>

        {/* ── Detected recurring transactions ── */}
        <Grid item xs={12}>
          <RecurringTransactionsCard />
        </Grid>

        {/* ── Recent transactions ── */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>Recent Transactions</Typography>
            {recent.length === 0 ? (
              <Typography color="text.secondary">No transactions for this period.</Typography>
            ) : recent.map((t) => {
              const credit = t.transaction_type === 'credit';
              return (
                <Box
                  key={t.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    py: 1,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <CategoryIcon name={t.category} size={32} />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body2" noWrap>{t.description || 'No description'}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {t.category || 'Uncategorized'}{t.bank_name ? ` · ${t.bank_name}` : ''}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    sx={{ whiteSpace: 'nowrap', color: credit ? 'success.main' : 'error.main' }}
                  >
                    {credit ? '+' : '-'}{formatCurrency(t.amount, { currency: t.currency_code })}
                  </Typography>
                </Box>
              );
            })}
          </Paper>
        </Grid>

        {/* ── Upcoming (predicted) transactions ── */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6">Upcoming (next 45 days)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Based on your recurring transactions.
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <Typography variant="body2" fontWeight={700} sx={{ color: 'success.main' }}>
                  +{money(expectedIncome)}
                </Typography>
                <Typography variant="body2" fontWeight={700} sx={{ color: 'error.main' }}>
                  -{money(expectedExpense)}
                </Typography>
              </Box>
            </Box>

            {predList.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4 }}>
                No recurring patterns detected yet.
              </Typography>
            ) : predList.map((p, i) => {
              const credit = p.transaction_type === 'credit';
              const interval = Math.round(Number(p.avg_interval_days) || 0);
              return (
                <Box
                  key={i}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    py: 1,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <CategoryIcon name={p.category} size={28} />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body2" noWrap>{p.description || 'Recurring transaction'}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {formatDate(p.predicted_date)}{p.bank_name ? ` · ${p.bank_name}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      every ~{interval} days · seen {p.occurrences}×
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    sx={{ whiteSpace: 'nowrap', color: credit ? 'success.main' : 'error.main' }}
                  >
                    {credit ? '+' : '-'}{formatCurrency(p.amount, { symbol: baseCcy.symbol, currency: baseCcy.code })}
                  </Typography>
                </Box>
              );
            })}
          </Paper>
        </Grid>

        {/* ── AI Insights ── */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <AutoAwesome fontSize="small" color="primary" />
                <Typography variant="h6" noWrap>AI Insights</Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => loadInsights(true)}
                disabled={insightsLoading}
                aria-label="Regenerate AI insights"
                title="Regenerate (uses AI)"
              >
                <Refresh fontSize="small" />
              </IconButton>
            </Box>

            {insightsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : insights?.ai ? (
              <Box>
                {insights?.generated_at && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Generated {timeAgo(insights.generated_at)}
                  </Typography>
                )}
                {insightLines.map((line, i) => (
                  <Typography
                    key={i}
                    variant="body2"
                    sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}
                  >
                    {line || ' '}
                  </Typography>
                ))}
              </Box>
            ) : insights?.needs_generate ? (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Insights are generated on demand to save AI usage.
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AutoAwesome />}
                  onClick={() => loadInsights(true)}
                >
                  Generate insights
                </Button>
              </Box>
            ) : (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, whiteSpace: 'pre-wrap' }}>
                  {insights?.insight || 'No insights available yet.'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Configure an AI provider in Settings → AI to enable AI insights.
                </Typography>
                <Button size="small" variant="outlined" onClick={() => navigate('/settings')}>
                  Go to Settings
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ── Unusual activity ── */}
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <WarningAmber fontSize="small" color="warning" />
                <Typography variant="h6" noWrap>Unusual activity</Typography>
              </Box>
              <Chip
                size="small"
                variant="outlined"
                color={anomalies?.ai ? 'primary' : 'default'}
                label={anomalies?.ai ? 'AI-detected' : 'Rule-based'}
              />
            </Box>

            {anomalies == null ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : anomalyList.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 4 }}>
                Nothing unusual detected.
              </Typography>
            ) : anomalyList.map((a, i) => (
              <Box
                key={i}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" noWrap>
                    {a.description || 'Unusual transaction'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {a.date ? formatDate(a.date) : ''}
                  </Typography>
                  {a.reason && (
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
                      {a.reason}
                    </Typography>
                  )}
                </Box>
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{ whiteSpace: 'nowrap', color: 'error.main' }}
                >
                  {money(a.amount)}
                </Typography>
              </Box>
            ))}
          </Paper>
        </Grid>

        {/* ── This month — AI summary ── */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Summarize fontSize="small" color="primary" />
                <Typography variant="h6" noWrap>This month — AI summary</Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => loadSummary(true)}
                disabled={summaryLoading}
                aria-label="Regenerate AI summary"
                title="Regenerate (uses AI)"
              >
                <Refresh fontSize="small" />
              </IconButton>
            </Box>

            {summaryLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : aiSummary?.ai ? (
              <Box>
                {aiSummary?.generated_at && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Generated {timeAgo(aiSummary.generated_at)}
                  </Typography>
                )}
                {summaryLines.map((line, i) => (
                  <Typography
                    key={i}
                    variant="body2"
                    sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}
                  >
                    {line || ' '}
                  </Typography>
                ))}
              </Box>
            ) : aiSummary?.needs_generate ? (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  The monthly summary is generated on demand to save AI usage.
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<Summarize />}
                  onClick={() => loadSummary(true)}
                >
                  Generate summary
                </Button>
              </Box>
            ) : (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Configure an AI provider in Settings → AI to get a written summary of this month.
                </Typography>
                <Button size="small" variant="outlined" onClick={() => navigate('/settings')}>
                  Go to Settings
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>

        {/* ── Roast Me — opt-in, blunt AI commentary on spending ── */}
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Whatshot fontSize="small" color="error" />
                <Typography variant="h6" noWrap>Roast Me</Typography>
              </Box>
              {roast?.ai && (
                <IconButton
                  size="small"
                  onClick={() => loadRoast(true)}
                  disabled={roastLoading}
                  aria-label="Roast me again"
                  title="Roast me again (uses AI)"
                >
                  <Refresh fontSize="small" />
                </IconButton>
              )}
            </Box>

            {roastLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : roast?.ai ? (
              <Box>
                {roast?.generated_at && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Generated {timeAgo(roast.generated_at)}
                  </Typography>
                )}
                {roastLines.map((line, i) => (
                  <Typography key={i} variant="body2" sx={{ mb: 0.5, whiteSpace: 'pre-wrap' }}>
                    {line || ' '}
                  </Typography>
                ))}
              </Box>
            ) : roast?.needs_generate ? (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Opt-in, blunt AI commentary on last month's spending habits — purely for fun.
                </Typography>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  startIcon={<Whatshot />}
                  onClick={() => loadRoast(true)}
                >
                  Roast me
                </Button>
              </Box>
            ) : (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Configure an AI provider in Settings → AI to unlock this.
                </Typography>
                <Button size="small" variant="outlined" onClick={() => navigate('/settings')}>
                  Go to Settings
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

export default Dashboard;
