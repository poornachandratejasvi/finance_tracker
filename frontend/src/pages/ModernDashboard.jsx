import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tabs,
  Tab,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Divider,
  LinearProgress,
  Button,
  Stack,
  Alert,
  Tooltip as MuiTooltip,
  ToggleButton,
  ToggleButtonGroup,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  useTheme,
} from '@mui/material';
import {
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  BookmarkAdd,
  DeleteOutline,
} from '@mui/icons-material';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  LineChart,
  BarChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
} from 'recharts';
import FilterSidebar, { DEFAULT_FILTERS } from '../components/FilterSidebar.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { formatCurrency, signedAccountBalance } from '../utils/format';
import {
  getBanks,
  getLabels,
  getCategories,
  getCurrencies,
  getAnalyticsComparison,
  getAnalyticsCashflow,
  getAnalyticsBalanceTrend,
  getSavedFilters,
  createSavedFilter,
  deleteSavedFilter,
} from '../services/api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TABS = [
  'Incomes & Expenses Report',
  'Balance Trend',
  'Cash flow',
  'Advanced Charts and Reports',
];

// Local YYYY-MM-DD (avoids the UTC shift that toISOString() introduces).
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Map the shared FilterSidebar value -> the analytics API query params.
const filtersToParams = (f) => {
  const p = {};
  if (f.accountIds?.length) p.bank_id = f.accountIds.join(',');
  if (f.categoryNames?.length) p.category = f.categoryNames.join(',');
  if (f.labelIds?.length) p.label_id = f.labelIds.join(',');
  if (f.recordTypes?.length) p.transaction_type = f.recordTypes.join(',');
  if (f.amountMin != null && f.amountMin !== '') p.min_amount = f.amountMin;
  if (f.amountMax != null && f.amountMax !== '') p.max_amount = f.amountMax;
  if (f.search) p.search = f.search;
  if (f.currencyCodes?.length) p.currency = f.currencyCodes.join(',');
  p.include_transfers = f.includeTransfers !== false;
  return p;
};

// Align two per-category breakdowns by category name; missing side becomes 0.
const mergeCategories = (aList = [], bList = []) => {
  const map = new Map();
  (aList || []).forEach(({ category, amount }) => {
    map.set(category, { category, a: amount || 0, b: 0 });
  });
  (bList || []).forEach(({ category, amount }) => {
    const e = map.get(category) || { category, a: 0, b: 0 };
    e.b = amount || 0;
    map.set(category, e);
  });
  return [...map.values()].sort(
    (x, y) => (Math.abs(y.a) + Math.abs(y.b)) - (Math.abs(x.a) + Math.abs(x.b))
  );
};

const dateTick = (gran) => (d) => {
  if (!d) return '';
  const parts = String(d).split('-');
  if (gran === 'month') {
    const mi = (parseInt(parts[1], 10) || 1) - 1;
    return `${MONTHS_SHORT[mi] || ''} ${parts[0] ? `'${parts[0].slice(2)}` : ''}`.trim();
  }
  return parts[2] || String(d);
};

const ModernDashboard = () => {
  const theme = useTheme();

  // Reference data (loaded once).
  const [banks, setBanks] = useState([]);
  const [categories, setCategories] = useState([]);
  const [labels, setLabels] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  // Filters + saved filters.
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const [debouncedFilters, setDebouncedFilters] = useState({ ...DEFAULT_FILTERS });
  const [savedFilters, setSavedFilters] = useState([]);
  const [selectedSavedId, setSelectedSavedId] = useState('');

  // Period (first day of the selected month).
  const now = new Date();
  const [monthDate, setMonthDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));

  // Active tab + advanced-report config.
  const [tab, setTab] = useState(0);
  const [advType, setAdvType] = useState('Expense'); // Balance | Income | Expense | Cash flow
  const [advGraph, setAdvGraph] = useState('Bar');   // Line | Bar
  const [advGran, setAdvGran] = useState('day');     // day | week | month

  // Per-tab data.
  const [comparison, setComparison] = useState(null);
  const [balance, setBalance] = useState(null);
  const [cashflow, setCashflow] = useState(null);
  const [advData, setAdvData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Reference data + saved filters on mount ──
  useEffect(() => {
    (async () => {
      const [b, c, l, cur] = await Promise.all([
        getBanks().catch(() => []),
        getCategories().catch(() => []),
        getLabels().catch(() => []),
        getCurrencies().catch(() => []),
      ]);
      setBanks(Array.isArray(b) ? b : []);
      setCategories(Array.isArray(c) ? c : []);
      setLabels(Array.isArray(l) ? l : []);
      setCurrencies(Array.isArray(cur) ? cur : []);
    })();
    loadSavedFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSavedFilters = useCallback(async () => {
    try {
      const res = await getSavedFilters('analytics');
      setSavedFilters(Array.isArray(res) ? res : []);
    } catch (_) {
      setSavedFilters([]);
    }
  }, []);

  // Debounce filters so typing in Search does not refetch on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedFilters(filters), 350);
    return () => clearTimeout(id);
  }, [filters]);

  const apiParams = useMemo(() => filtersToParams(debouncedFilters), [debouncedFilters]);

  // Base currency for display (prefer the user's flagged base, then API echo).
  const baseCcy = useMemo(() => {
    const b = currencies.find((c) => c.is_base);
    if (b) return { code: b.code, symbol: b.symbol };
    if (comparison?.base_currency) return comparison.base_currency;
    return { code: 'INR', symbol: '₹' };
  }, [currencies, comparison]);

  const money = useCallback(
    (v, opts = {}) => formatCurrency(v, { symbol: baseCcy.symbol, currency: baseCcy.code, ...opts }),
    [baseCcy]
  );
  const moneyC = useCallback((v) => money(v, { compact: true }), [money]);

  // Derived period boundaries + labels.
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

  // Category name -> immediate parent category name (via parent_id -> parent's name).
  // Top-level categories are simply absent from the map. Used to nest sub-category
  // rows under their parent in the Incomes & Expenses Report.
  const categoryParentName = useMemo(() => {
    const byId = new Map();
    (categories || []).forEach((c) => { if (c && c.id != null) byId.set(c.id, c); });
    const map = new Map();
    (categories || []).forEach((c) => {
      if (!c || !c.name || c.parent_id == null) return;
      const parent = byId.get(c.parent_id);
      if (parent && parent.name) map.set(c.name, parent.name);
    });
    return map;
  }, [categories]);

  // ── Fetch the active tab's data whenever period / filters / tab / adv config changes ──
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const base = { ...apiParams };
      if (tab === 0) {
        const res = await getAnalyticsComparison({
          start_a: periods.curStart,
          end_a: periods.curEnd,
          start_b: periods.prevStart,
          end_b: periods.prevEnd,
          label_a: periods.curLabel,
          label_b: periods.prevLabel,
          ...base,
        });
        setComparison(res);
      } else if (tab === 1) {
        const res = await getAnalyticsBalanceTrend({
          start_date: periods.curStart,
          end_date: periods.curEnd,
          granularity: 'day',
          ...base,
        });
        setBalance(res);
      } else if (tab === 2) {
        const res = await getAnalyticsCashflow({
          start_date: periods.curStart,
          end_date: periods.curEnd,
          granularity: 'day',
          ...base,
        });
        setCashflow(res);
      } else {
        const params = { start_date: periods.curStart, end_date: periods.curEnd, granularity: advGran, ...base };
        const res = advType === 'Balance'
          ? await getAnalyticsBalanceTrend(params)
          : await getAnalyticsCashflow(params);
        setAdvData(res);
      }
    } catch (_) {
      setError('Failed to load analytics data.');
    } finally {
      setLoading(false);
    }
  }, [tab, apiParams, periods, advType, advGran]);

  useEffect(() => { load(); }, [load]);

  // ── Saved filter handlers (defensive: page keeps working if these fail) ──
  const applySavedFilter = (id) => {
    setSelectedSavedId(id);
    const sf = savedFilters.find((f) => f.id === id);
    if (sf) setFilters({ ...DEFAULT_FILTERS, ...(sf.payload || {}) });
  };

  const saveCurrentFilter = async () => {
    const name = window.prompt('Save current filter as:');
    if (!name) return;
    try {
      await createSavedFilter({ name: name.trim(), scope: 'analytics', payload: filters });
      await loadSavedFilters();
    } catch (_) {
      window.alert('Could not save filter.');
    }
  };

  const removeSavedFilter = async () => {
    if (!selectedSavedId) return;
    try {
      await deleteSavedFilter(selectedSavedId);
      setSelectedSavedId('');
      await loadSavedFilters();
    } catch (_) {
      window.alert('Could not delete filter.');
    }
  };

  const shiftMonth = (delta) =>
    setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  // ── Renderers ──
  const chartTooltipStyle = {
    borderRadius: 8,
    border: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    background: theme.palette.background.paper,
  };

  const renderComparison = () => {
    if (!comparison) return null;
    const a = comparison.period_a || {};
    const b = comparison.period_b || {};
    const incomeRows = mergeCategories(a.income_by_category, b.income_by_category);
    const expenseRows = mergeCategories(a.expense_by_category, b.expense_by_category);
    const amtCell = (v, negative = false, bold = false) => (
      <TableCell align="right" sx={{ color: negative ? 'error.main' : 'text.primary', whiteSpace: 'nowrap', fontWeight: bold ? 600 : undefined }}>
        {negative ? money(-Math.abs(v)) : money(v)}
      </TableCell>
    );
    const sectionRow = (title, av, bv, negative = false) => (
      <TableRow sx={{ bgcolor: theme.palette.action.hover }}>
        <TableCell sx={{ fontWeight: 700 }}>{title}</TableCell>
        <TableCell align="right" sx={{ fontWeight: 700, color: negative ? 'error.main' : 'text.primary', whiteSpace: 'nowrap' }}>
          {negative ? money(-Math.abs(av)) : money(av)}
        </TableCell>
        <TableCell align="right" sx={{ fontWeight: 700, color: negative ? 'error.main' : 'text.primary', whiteSpace: 'nowrap' }}>
          {negative ? money(-Math.abs(bv)) : money(bv)}
        </TableCell>
      </TableRow>
    );
    // indent => child row (extra left padding); isParent => bold parent/subtotal row.
    const catRow = (row, negative = false, indent = false, isParent = false) => (
      <TableRow key={`${negative ? 'e' : 'i'}-${isParent ? 'p' : indent ? 'c' : 's'}-${row.category}`} hover>
        <TableCell sx={indent ? { pl: 5 } : undefined}>
          <Box display="flex" alignItems="center" gap={1.25}>
            <CategoryIcon name={row.category} size={28} />
            <Typography variant="body2" sx={{ fontWeight: isParent ? 600 : 400 }}>
              {row.category || 'Uncategorized'}
            </Typography>
          </Box>
        </TableCell>
        {amtCell(row.a, negative, isParent)}
        {amtCell(row.b, negative, isParent)}
      </TableRow>
    );

    // Group merged {category,a,b} rows into a parent -> children hierarchy using
    // categoryParentName. A group's parent subtotal = the parent's own amount plus
    // the sum of its children's amounts (per period). Groups without children stay
    // as a single flat row. Ordered by combined magnitude, like the flat view.
    const groupRows = (rows) => {
      const groups = new Map(); // groupName -> { name, ownA, ownB, children: [] }
      const order = [];
      const groupFor = (name) => {
        let g = groups.get(name);
        if (!g) { g = { name, ownA: 0, ownB: 0, children: [] }; groups.set(name, g); order.push(name); }
        return g;
      };
      (rows || []).forEach((r) => {
        const parent = categoryParentName.get(r.category);
        if (parent) {
          groupFor(parent).children.push(r);
        } else {
          const g = groupFor(r.category);
          g.ownA = r.a || 0;
          g.ownB = r.b || 0;
        }
      });
      return order
        .map((name) => {
          const g = groups.get(name);
          if (g.children.length === 0) {
            return { parent: { category: name, a: g.ownA, b: g.ownB }, children: [] };
          }
          const a = g.children.reduce((s, c) => s + (c.a || 0), g.ownA);
          const b = g.children.reduce((s, c) => s + (c.b || 0), g.ownB);
          return { parent: { category: name, a, b }, children: g.children };
        })
        .sort((x, y) =>
          (Math.abs(y.parent.a) + Math.abs(y.parent.b)) - (Math.abs(x.parent.a) + Math.abs(x.parent.b))
        );
    };
    const renderGrouped = (rows, negative) => {
      const out = [];
      groupRows(rows).forEach((g) => {
        const isParent = g.children.length > 0;
        out.push(catRow(g.parent, negative, false, isParent));
        g.children.forEach((c) => out.push(catRow(c, negative, true, false)));
      });
      return out;
    };

    // Fall back to flat rendering when category metadata has not loaded.
    const hasCats = (categories?.length || 0) > 0;

    return (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>{a.label}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>{b.label}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sectionRow('Total Income', a.income_total || 0, b.income_total || 0)}
          {hasCats ? renderGrouped(incomeRows, false) : incomeRows.map((r) => catRow(r, false))}
          {incomeRows.length === 0 && (
            <TableRow><TableCell colSpan={3}><Typography variant="body2" color="text.secondary">No income in either period.</Typography></TableCell></TableRow>
          )}
          {sectionRow('Total Expense', a.expense_total || 0, b.expense_total || 0, true)}
          {hasCats ? renderGrouped(expenseRows, true) : expenseRows.map((r) => catRow(r, true))}
          {expenseRows.length === 0 && (
            <TableRow><TableCell colSpan={3}><Typography variant="body2" color="text.secondary">No expenses in either period.</Typography></TableCell></TableRow>
          )}
          {sectionRow('Net', a.net || 0, b.net || 0)}
        </TableBody>
      </Table>
    );
  };

  const renderBalanceTrend = () => {
    if (!balance) return null;
    const series = balance.series || [];
    const up = (balance.net_change || 0) >= 0;
    // bank_type='investment' rows exist only so CAS/PPF statement emails can be
    // auto-downloaded (see the Add Bank form) -- they're not real balance-bearing
    // accounts, so they're excluded here, same as the main Dashboard's Accounts widget.
    const visibleBanks = banks.filter((bk) => bk.bank_type !== 'investment');
    const accountTotal = visibleBanks.reduce((s, bk) => s + signedAccountBalance(bk), 0);
    return (
      <Box>
        <Stack direction="row" spacing={4} alignItems="baseline" flexWrap="wrap" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Ending balance</Typography>
            <Typography variant="h4" fontWeight={700}>{money(balance.ending_balance || 0)}</Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={0.5} sx={{ color: up ? 'success.main' : 'error.main' }}>
            {up ? <TrendingUp /> : <TrendingDown />}
            <Typography variant="h6" fontWeight={600}>
              {up ? '+' : ''}{money(balance.net_change || 0)}
            </Typography>
            <Typography variant="body2" color="text.secondary">net change</Typography>
          </Box>
        </Stack>

        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.7} />
                <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey="date" tickFormatter={dateTick('day')} tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={moneyC} tick={{ fontSize: 12 }} width={70} />
            <ReTooltip formatter={(v) => money(v)} contentStyle={chartTooltipStyle} />
            <Area type="monotone" dataKey="balance" name="Balance" stroke={theme.palette.primary.main} strokeWidth={2} fill="url(#balFill)" />
          </AreaChart>
        </ResponsiveContainer>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Accounts</Typography>
        <Box>
          {visibleBanks.map((bk) => {
            const signed = signedAccountBalance(bk);
            return (
              <Box key={bk.id} display="flex" alignItems="center" justifyContent="space-between" sx={{ py: 0.75, borderBottom: `1px solid ${theme.palette.divider}` }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{bk.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {bk.bank_type || 'account'}
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight={600} sx={{ color: signed < 0 ? 'error.main' : 'text.primary' }}>
                  {formatCurrency(signed, { currency: bk.currency_code })}
                </Typography>
              </Box>
            );
          })}
          {visibleBanks.length === 0 && (
            <Typography variant="body2" color="text.secondary">No accounts to display.</Typography>
          )}
          {visibleBanks.length > 0 && (
            <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ pt: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>Total</Typography>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: accountTotal < 0 ? 'error.main' : 'text.primary' }}>
                {money(accountTotal)}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  const renderCashflow = () => {
    if (!cashflow) return null;
    const series = cashflow.series || [];
    const totals = cashflow.totals || { income: 0, expense: 0, net: 0 };
    const maxBar = Math.max(totals.income || 0, totals.expense || 0, 1);
    const net = totals.net || 0;
    return (
      <Box>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey="date" tickFormatter={dateTick('day')} tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={moneyC} tick={{ fontSize: 12 }} width={70} />
            <ReTooltip formatter={(v) => money(v)} contentStyle={chartTooltipStyle} />
            <Legend />
            <Bar dataKey="income" name="Income" fill={theme.palette.success.main} radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" name="Expense" fill={theme.palette.error.main} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="net" name="Net" stroke={theme.palette.text.primary} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>

        <Divider sx={{ my: 2 }} />
        <Box sx={{ maxWidth: 520 }}>
          <Box sx={{ mb: 2 }}>
            <Box display="flex" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" color="text.secondary">Income</Typography>
              <Typography variant="body2" fontWeight={700} color="success.main">{money(totals.income || 0)}</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, ((totals.income || 0) / maxBar) * 100)}
              color="success"
              sx={{ height: 10, borderRadius: 5 }}
            />
          </Box>
          <Box sx={{ mb: 2 }}>
            <Box display="flex" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" color="text.secondary">Expense</Typography>
              <Typography variant="body2" fontWeight={700} color="error.main">{money(totals.expense || 0)}</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, ((totals.expense || 0) / maxBar) * 100)}
              color="error"
              sx={{ height: 10, borderRadius: 5 }}
            />
          </Box>
          <Divider sx={{ my: 1.5 }} />
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>Net cash flow</Typography>
            <Typography variant="h6" fontWeight={700} sx={{ color: net < 0 ? 'error.main' : 'success.main' }}>
              {net >= 0 ? '+' : ''}{money(net)}
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  };

  const renderAdvanced = () => {
    const isBalance = advType === 'Balance';
    const series = advData?.series || [];
    const dataKey = isBalance
      ? 'balance'
      : advType === 'Income'
        ? 'income'
        : advType === 'Expense'
          ? 'expense'
          : 'net';
    const color = advType === 'Income' || (advType === 'Cash flow')
      ? theme.palette.success.main
      : advType === 'Expense'
        ? theme.palette.error.main
        : theme.palette.primary.main;
    const label = advType === 'Cash flow' ? 'Net' : advType;

    return (
      <Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Type</InputLabel>
            <Select value={advType} label="Type" onChange={(e) => setAdvType(e.target.value)}>
              {['Balance', 'Income', 'Expense', 'Cash flow'].map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={advGraph}
            onChange={(_, v) => v && setAdvGraph(v)}
          >
            <ToggleButton value="Line">Line</ToggleButton>
            <ToggleButton value="Bar">Bar</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={advGran}
            onChange={(_, v) => v && setAdvGran(v)}
          >
            <ToggleButton value="day">Day</ToggleButton>
            <ToggleButton value="week">Week</ToggleButton>
            <ToggleButton value="month">Month</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <ResponsiveContainer width="100%" height={340}>
          {advGraph === 'Line' ? (
            <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis dataKey="date" tickFormatter={dateTick(advGran)} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={moneyC} tick={{ fontSize: 12 }} width={70} />
              <ReTooltip formatter={(v) => money(v)} contentStyle={chartTooltipStyle} />
              <Legend />
              <Line type="monotone" dataKey={dataKey} name={label} stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis dataKey="date" tickFormatter={dateTick(advGran)} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={moneyC} tick={{ fontSize: 12 }} width={70} />
              <ReTooltip formatter={(v) => money(v)} contentStyle={chartTooltipStyle} />
              <Legend />
              <Bar dataKey={dataKey} name={label} fill={color} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </Box>
    );
  };

  const renderActiveTab = () => {
    if (tab === 0) return renderComparison();
    if (tab === 1) return renderBalanceTrend();
    if (tab === 2) return renderCashflow();
    return renderAdvanced();
  };

  return (
    <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' }, p: { xs: 2, md: 3 } }}>
      {/* LEFT: My filter + FilterSidebar */}
      <Box sx={{ width: { xs: '100%', md: 'auto' }, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>My filter</Typography>
          <FormControl size="small" fullWidth sx={{ mb: 1 }}>
            <InputLabel>Saved filters</InputLabel>
            <Select
              value={selectedSavedId}
              label="Saved filters"
              onChange={(e) => applySavedFilter(e.target.value)}
              displayEmpty
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {savedFilters.map((sf) => (
                <MenuItem key={sf.id} value={sf.id}>{sf.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" startIcon={<BookmarkAdd />} onClick={saveCurrentFilter} fullWidth>
              Save
            </Button>
            <MuiTooltip title="Delete selected filter">
              <span>
                <IconButton size="small" color="error" disabled={!selectedSavedId} onClick={removeSavedFilter}>
                  <DeleteOutline />
                </IconButton>
              </span>
            </MuiTooltip>
          </Stack>
        </Paper>

        <FilterSidebar
          value={filters}
          onChange={(next) => { setFilters(next); setSelectedSavedId(''); }}
          banks={banks}
          categories={categories}
          labels={labels}
          currencies={currencies}
          amountBound={500000}
          show={['search', 'accounts', 'categories', 'labels', 'currencies', 'recordTypes', 'amount', 'transfers', 'recordStates', 'paymentTypes']}
          title="Analytics"
        />
      </Box>

      {/* RIGHT: period selector + tabs + content */}
      <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
          <Box display="flex" alignItems="center" justifyContent="center" gap={1} sx={{ mb: 1 }}>
            <IconButton size="small" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft />
            </IconButton>
            <Typography variant="h6" fontWeight={700} sx={{ minWidth: 160, textAlign: 'center' }}>
              {periods.curLabel}
            </Typography>
            <IconButton size="small" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight />
            </IconButton>
          </Box>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            {TABS.map((t) => <Tab key={t} label={t} />)}
          </Tabs>
        </Paper>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2, minHeight: 400 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={360}>
              <CircularProgress />
            </Box>
          ) : (
            renderActiveTab()
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default ModernDashboard;
