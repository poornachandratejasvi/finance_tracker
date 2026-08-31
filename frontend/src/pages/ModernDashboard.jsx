import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { alpha } from '@mui/material/styles';
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
  Popover,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormLabel,
  Switch,
  Slider,
  Dialog,
  DialogTitle,
  DialogContent,
  Fade,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  BookmarkAdd,
  DeleteOutline,
  TuneOutlined,
  Close,
  AccountBalanceWallet,
  Savings,
  DonutLarge,
} from '@mui/icons-material';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  LineChart,
  BarChart,
  PieChart,
  Pie,
  Cell,
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
import MonthPager, { currentMonthPeriod } from '../components/MonthPager.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { useCategoryMeta } from '../utils/categories';
import { formatCurrency, signedAccountBalance } from '../utils/format';
import {
  getBanks,
  getLabels,
  getCategories,
  getCurrencies,
  getAnalyticsComparisonMulti,
  getAnalyticsCashflow,
  getAnalyticsBalanceTrend,
  getSavedFilters,
  createSavedFilter,
  deleteSavedFilter,
  getTransactions,
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

// Align N per-category breakdowns (one per comparison column) by category
// name; a category missing from a given column's breakdown becomes 0 there.
const mergeCategoriesMulti = (periodBreakdowns, key) => {
  const n = periodBreakdowns.length;
  const map = new Map();
  periodBreakdowns.forEach((p, idx) => {
    (p?.[key] || []).forEach(({ category, amount }) => {
      const e = map.get(category) || { category, amounts: new Array(n).fill(0) };
      e.amounts[idx] = amount || 0;
      map.set(category, e);
    });
  });
  return [...map.values()];
};

const magnitudeSum = (amounts) => amounts.reduce((s, v) => s + Math.abs(v || 0), 0);

// sortBy: 'default' (combined magnitude across all shown columns, highest
// first) | 'amount_asc' | 'amount_desc' (both based on the first/most-recent
// column only, matching the reference app's "Amount (lowest/highest first)").
const sortComparator = (sortBy) => (x, y) => {
  if (sortBy === 'amount_asc') return (x.amounts[0] || 0) - (y.amounts[0] || 0);
  if (sortBy === 'amount_desc') return (y.amounts[0] || 0) - (x.amounts[0] || 0);
  return magnitudeSum(y.amounts) - magnitudeSum(x.amounts);
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
  const { getMeta: getCategoryMeta } = useCategoryMeta();

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

  // Period -- { start_date, end_date, label, _year?, _month? }, same shape
  // MonthPager uses on the Records page, so the picker there and here (its
  // Custom range/Weeks/Months/Years popover) behave identically.
  const [period, setPeriod] = useState(() => currentMonthPeriod());

  // Active tab + advanced-report config.
  const [tab, setTab] = useState(0);
  const [advType, setAdvType] = useState('Expense'); // Balance | Income | Expense | Cash flow
  const [advGraph, setAdvGraph] = useState('Bar');   // Line | Bar
  const [advGran, setAdvGran] = useState('day');     // day | week | month

  // Incomes & Expenses Report display options (gear icon on that tab).
  const [numColumns, setNumColumns] = useState(2);       // 1-6 periods side by side
  const [sortBy, setSortBy] = useState('default');       // default | amount_asc | amount_desc
  const [showPctDiff, setShowPctDiff] = useState(false); // colored % change vs the next-older column
  const [reportOptionsAnchor, setReportOptionsAnchor] = useState(null);

  // Drill-down: clicking a category amount cell shows the transactions behind it.
  const [drillDown, setDrillDown] = useState(null); // { category, label, start, end } | null
  const [drillDownRows, setDrillDownRows] = useState([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);

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

  // Derived period boundaries + labels. "Previous period" (used by the
  // Incomes & Expenses comparison table) is the literal previous calendar
  // month for a whole-month selection (the common case, and what that
  // table's "vs last month" framing is built around) -- or, for any other
  // MonthPager granularity (a week, a year, a custom range), an equal-length
  // window immediately before it, so the comparison still means something.
  const periods = useMemo(() => {
    if (!period.start_date || !period.end_date) {
      // "All time" -- no well-defined "previous period" to compare against.
      return { curStart: null, curEnd: null, prevStart: null, prevEnd: null, curLabel: period.label, prevLabel: null };
    }
    if (period._year != null && period._month != null) {
      const y = period._year;
      const m = period._month;
      const prevStart = new Date(y, m - 1, 1);
      const prevEnd = new Date(y, m, 0);
      return {
        curStart: period.start_date,
        curEnd: period.end_date,
        prevStart: toISO(prevStart),
        prevEnd: toISO(prevEnd),
        curLabel: period.label,
        prevLabel: `${MONTHS[(m + 11) % 12]} ${prevStart.getFullYear()}`,
      };
    }
    const curStart = new Date(period.start_date);
    const curEnd = new Date(period.end_date);
    const spanDays = Math.round((curEnd - curStart) / 86400000) + 1;
    const prevEnd = new Date(curStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - spanDays + 1);
    return {
      curStart: period.start_date,
      curEnd: period.end_date,
      prevStart: toISO(prevStart),
      prevEnd: toISO(prevEnd),
      curLabel: period.label,
      prevLabel: `${toISO(prevStart)} – ${toISO(prevEnd)}`,
    };
  }, [period]);

  // N periods (most-recent-first) for the Incomes & Expenses Report's
  // "Number of columns" option -- same step rule as the single "previous
  // period" above (calendar month back for a whole-month selection, an
  // equal-length window back otherwise), just repeated numColumns times.
  const columnPeriods = useMemo(() => {
    if (!period.start_date || !period.end_date) {
      return [{ start: null, end: null, label: period.label }];
    }
    const isMonth = period._year != null && period._month != null;
    const out = [];
    if (isMonth) {
      let y = period._year;
      let m = period._month;
      for (let i = 0; i < numColumns; i += 1) {
        const s = new Date(y, m, 1);
        const e = new Date(y, m + 1, 0);
        out.push({ start: toISO(s), end: toISO(e), label: i === 0 ? period.label : `${MONTHS[m]} ${y}` });
        m -= 1;
        if (m < 0) { m = 11; y -= 1; }
      }
    } else {
      let curStart = new Date(period.start_date);
      let curEnd = new Date(period.end_date);
      const spanDays = Math.round((curEnd - curStart) / 86400000) + 1;
      for (let i = 0; i < numColumns; i += 1) {
        out.push({ start: toISO(curStart), end: toISO(curEnd), label: i === 0 ? period.label : `${toISO(curStart)} – ${toISO(curEnd)}` });
        const nextEnd = new Date(curStart); nextEnd.setDate(nextEnd.getDate() - 1);
        const nextStart = new Date(nextEnd); nextStart.setDate(nextStart.getDate() - spanDays + 1);
        curStart = nextStart; curEnd = nextEnd;
      }
    }
    return out;
  }, [period, numColumns]);

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
        const res = await getAnalyticsComparisonMulti(columnPeriods, base);
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
  }, [tab, apiParams, periods, columnPeriods, advType, advGran]);

  useEffect(() => { load(); }, [load]);

  // Click-through drill-down: a category amount cell in the Incomes & Expenses
  // Report opens this, fetching the individual transactions that sum to it
  // (same filters as the report itself, plus that cell's category and column).
  const openDrillDown = async (category, colIdx) => {
    const col = columnPeriods[colIdx];
    if (!col) return;
    setDrillDown({ category, label: col.label, start: col.start, end: col.end });
    setDrillDownLoading(true);
    setDrillDownRows([]);
    try {
      const res = await getTransactions({
        ...apiParams,
        category,
        start_date: col.start || undefined,
        end_date: col.end || undefined,
        limit: 200,
      });
      setDrillDownRows(res?.items || []);
    } catch (_) {
      setDrillDownRows([]);
    } finally {
      setDrillDownLoading(false);
    }
  };
  const closeDrillDown = () => setDrillDown(null);

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

  // ── Renderers ──
  const chartTooltipStyle = {
    borderRadius: 8,
    border: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    background: theme.palette.background.paper,
  };

  // Colored filled pill (not just tinted text+arrow) for a period-over-period
  // % change -- matches the reference app's percent-change badge component.
  // Literal sign-based coloring (positive=green/up, negative=red/down), not an
  // income/expense-aware "good vs bad" read.
  const pctPill = (pct, size = 'normal', unit = '%') => {
    if (pct == null || !isFinite(pct) || pct === 0) return null;
    const up = pct > 0;
    const small = size === 'small';
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.25,
          px: small ? 0.65 : 0.85, py: small ? 0.1 : 0.2, borderRadius: 5,
          bgcolor: up ? 'success.main' : 'error.main', color: '#fff',
          fontSize: small ? 11 : 12, fontWeight: 700, lineHeight: 1.6,
          verticalAlign: 'middle', whiteSpace: 'nowrap',
        }}
      >
        {up ? <TrendingUp sx={{ fontSize: small ? 12 : 13 }} /> : <TrendingDown sx={{ fontSize: small ? 12 : 13 }} />}
        {Math.abs(pct).toFixed(0)}{unit}
      </Box>
    );
  };
  const pctBadge = (amounts, idx) => {
    if (!showPctDiff || idx >= amounts.length - 1) return null;
    const cur = amounts[idx] || 0;
    const prev = amounts[idx + 1] || 0;
    if (!prev) return null;
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    return pct ? <Box component="span" sx={{ ml: 0.75 }}>{pctPill(pct, 'small')}</Box> : null;
  };

  // Hero stat row above the report table: Total Income / Total Expense / Net,
  // each with a real (not decorative) mini sparkline built from the same N
  // comparison columns already fetched, oldest-to-newest -- and a % change
  // pill vs the immediately-preceding column, same as the reference app's
  // per-card trend preview.
  const renderHeroStats = (cols) => {
    const series = (key) => cols.map((p) => p[key] || 0).slice().reverse();
    const card = (label, vals, mode, Icon) => {
      const cur = vals[vals.length - 1] || 0;
      const prev = vals.length > 1 ? vals[vals.length - 2] : null;
      // Savings Rate is already a %, so "% change of a %" is both confusing
      // and numerically unstable near zero/sign flips (e.g. -4% -> 49% would
      // read as a nonsensical "+1300%") -- show the plain percentage-POINT
      // difference instead, same convention finance dashboards use for
      // rate-type metrics.
      const pct = prev == null ? null
        : mode === 'rate' ? (cur - prev)
        : prev ? ((cur - prev) / Math.abs(prev)) * 100
        : null;
      const pctUnit = mode === 'rate' ? 'pp' : '%';
      const valueColor = mode === 'expense' ? theme.palette.error.main
        : mode === 'net' ? (cur >= 0 ? theme.palette.success.main : theme.palette.error.main)
        : mode === 'rate' ? theme.palette.primary.main
        : theme.palette.success.main;
      const sparkColor = mode === 'net' ? theme.palette.primary.main : valueColor;
      const sparkData = vals.map((v, i) => ({ i, v }));
      const gradFrom = alpha(valueColor, theme.palette.mode === 'dark' ? 0.22 : 0.14);
      const gradTo = alpha(valueColor, 0);
      return (
        <Paper
          variant="outlined"
          sx={{
            p: 2.75, flex: '1 1 230px', minWidth: 230, borderRadius: 4,
            position: 'relative', overflow: 'hidden',
            backgroundImage: `linear-gradient(135deg, ${gradFrom}, ${gradTo} 65%)`,
          }}
        >
          <Box display="flex" alignItems="center" gap={1.25} mb={1.5}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: valueColor, color: '#fff', flexShrink: 0,
            }}>
              <Icon sx={{ fontSize: 20 }} />
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>
              {label}
            </Typography>
          </Box>
          <Box display="flex" alignItems="flex-end" justifyContent="space-between" gap={1}>
            <Box>
              <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color: valueColor, lineHeight: 1.15 }}>
                {mode === 'expense' ? money(-Math.abs(cur)) : mode === 'rate' ? `${cur.toFixed(0)}%` : money(cur)}
              </Typography>
              {pct != null && <Box mt={1}>{pctPill(pct, 'normal', pctUnit)}</Box>}
            </Box>
            {vals.length > 1 && mode !== 'rate' && (
              <Box sx={{ width: 88, height: 42, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sparkData}>
                    <Line type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Box>
        </Paper>
      );
    };
    // Savings rate: how much of income was kept as net -- a genuinely new
    // metric (not just a repeat of Income/Expense/Net), matching the
    // reference app's habit of surfacing a derived "health" figure, not just
    // raw totals.
    const rateVals = series('income_total').map((inc, i) => {
      const net = series('net')[i] || 0;
      return inc ? (net / inc) * 100 : 0;
    });
    return (
      <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
        {card('Total Income', series('income_total'), 'income', TrendingUp)}
        {card('Total Expense', series('expense_total'), 'expense', TrendingDown)}
        {card('Net', series('net'), 'net', AccountBalanceWallet)}
        {(cols[0]?.income_total || 0) !== 0 && card('Savings Rate', rateVals, 'rate', Savings)}
      </Box>
    );
  };

  const renderComparison = () => {
    if (!comparison) return null;
    const cols = comparison.periods || [];
    const cmp = sortComparator(sortBy);
    const incomeRows = mergeCategoriesMulti(cols, 'income_by_category').sort(cmp);
    const expenseRows = mergeCategoriesMulti(cols, 'expense_by_category').sort(cmp);
    // category === null => a total/subtotal row, not click-through-able.
    const amtCell = (amounts, idx, negative = false, bold = false, category = null) => (
      <TableCell
        key={idx}
        align="right"
        onClick={category != null ? () => openDrillDown(category, idx) : undefined}
        sx={{
          color: negative ? 'error.main' : 'text.primary', whiteSpace: 'nowrap',
          fontWeight: bold ? 600 : undefined,
          fontVariantNumeric: 'tabular-nums',
          cursor: category != null ? 'pointer' : undefined,
          '&:hover': category != null ? { textDecoration: 'underline' } : undefined,
        }}
      >
        {negative ? money(-Math.abs(amounts[idx] || 0)) : money(amounts[idx] || 0)}
        {pctBadge(amounts, idx)}
      </TableCell>
    );
    const sectionRow = (title, amounts, negative = false) => (
      <TableRow sx={{ bgcolor: theme.palette.action.hover }}>
        <TableCell sx={{ fontWeight: 700 }}>{title}</TableCell>
        {amounts.map((_, idx) => amtCell(amounts, idx, negative, true))}
      </TableRow>
    );
    // indent => child row (extra left padding); isParent => bold parent/subtotal row.
    // maxMag => the largest top-level magnitude in this section, so the ranked
    // proportion bar (only drawn on top-level rows, matching the reference
    // app's "By Category" ranked-bar list) scales relative to its siblings.
    const catRow = (row, negative = false, indent = false, isParent = false, maxMag = 0) => {
      const meta = getCategoryMeta(row.category);
      const mag = Math.abs(row.amounts[0] || 0);
      const barPct = maxMag > 0 ? Math.min(100, (mag / maxMag) * 100) : 0;
      return (
        <TableRow key={`${negative ? 'e' : 'i'}-${isParent ? 'p' : indent ? 'c' : 's'}-${row.category}`} hover>
          <TableCell sx={indent ? { pl: 5 } : undefined}>
            <Box display="flex" alignItems="center" gap={1.25}>
              <CategoryIcon name={row.category} size={28} meta={meta} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: isParent ? 600 : 400 }}>
                  {row.category || 'Uncategorized'}
                </Typography>
                {!indent && (
                  <Box sx={{ mt: 0.5, height: 4, borderRadius: 2, maxWidth: 160, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${barPct}%`, borderRadius: 2, bgcolor: meta.color || (negative ? theme.palette.error.main : theme.palette.success.main) }} />
                  </Box>
                )}
              </Box>
            </Box>
          </TableCell>
          {row.amounts.map((_, idx) => amtCell(row.amounts, idx, negative, isParent, row.category))}
        </TableRow>
      );
    };

    // Group merged {category, amounts[]} rows into a parent -> children hierarchy
    // using categoryParentName. A group's parent subtotal = its own amount plus
    // the sum of its children's amounts, per column. Groups without children stay
    // as a single flat row. Ordered by sortComparator, like the flat view.
    const groupRows = (rows) => {
      const groups = new Map(); // groupName -> { name, own: number[], children: [] }
      const order = [];
      const groupFor = (name) => {
        let g = groups.get(name);
        if (!g) { g = { name, own: new Array(cols.length).fill(0), children: [] }; groups.set(name, g); order.push(name); }
        return g;
      };
      (rows || []).forEach((r) => {
        const parent = categoryParentName.get(r.category);
        if (parent) {
          groupFor(parent).children.push(r);
        } else {
          groupFor(r.category).own = r.amounts;
        }
      });
      return order
        .map((name) => {
          const g = groups.get(name);
          if (g.children.length === 0) {
            return { parent: { category: name, amounts: g.own }, children: [] };
          }
          const amounts = g.own.map((v, i) => v + g.children.reduce((s, c) => s + (c.amounts[i] || 0), 0));
          return { parent: { category: name, amounts }, children: g.children };
        })
        .sort((x, y) => cmp(x.parent, y.parent));
    };
    const renderGrouped = (rows, negative) => {
      const groups = groupRows(rows);
      const maxMag = Math.max(0, ...groups.map((g) => Math.abs(g.parent.amounts[0] || 0)));
      const out = [];
      groups.forEach((g) => {
        const isParent = g.children.length > 0;
        out.push(catRow(g.parent, negative, false, isParent, maxMag));
        g.children.forEach((c) => out.push(catRow(c, negative, true, false)));
      });
      return out;
    };
    const renderFlat = (rows, negative) => {
      const maxMag = Math.max(0, ...rows.map((r) => Math.abs(r.amounts[0] || 0)));
      return rows.map((r) => catRow(r, negative, false, false, maxMag));
    };

    // Fall back to flat rendering when category metadata has not loaded.
    const hasCats = (categories?.length || 0) > 0;
    const incomeTotals = cols.map((p) => p.income_total || 0);
    const expenseTotals = cols.map((p) => p.expense_total || 0);
    const netTotals = cols.map((p) => p.net || 0);

    // Donut hero visualization for the most-recent column's expense
    // breakdown (top-level categories, same rolled-up amounts the table's
    // parent rows show) -- the reference app's signature "ring with a
    // centered total" pattern, reused for the top N categories + an "Other"
    // slice for the long tail so the ring stays legible.
    const renderExpenseDonut = () => {
      const topLevel = hasCats ? groupRows(expenseRows).map((g) => g.parent) : expenseRows;
      const slices = topLevel
        .map((r) => ({ name: r.category || 'Uncategorized', value: Math.abs(r.amounts[0] || 0), color: getCategoryMeta(r.category).color || theme.palette.grey[500] }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value);
      if (slices.length === 0) return null;
      const DONUT_TOP_N = 6;
      const shown = slices.slice(0, DONUT_TOP_N);
      const otherTotal = slices.slice(DONUT_TOP_N).reduce((s, d) => s + d.value, 0);
      const data = otherTotal > 0 ? [...shown, { name: 'Other', value: otherTotal, color: theme.palette.grey[500] }] : shown;
      const total = data.reduce((s, d) => s + d.value, 0);
      return (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 4, mb: 2.5 }}>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <DonutLarge color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={800}>Where it went</Typography>
              <Typography variant="body2" color="text.secondary">Expense breakdown for {cols[0]?.label}</Typography>
            </Box>
          </Box>
          <Box display="flex" flexWrap="wrap" alignItems="center" gap={4}>
            <Box sx={{ width: 230, height: 230, position: 'relative', flexShrink: 0, mx: 'auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={2} startAngle={90} endAngle={-270} isAnimationActive stroke="none">
                    {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <ReTooltip formatter={(v) => money(v)} contentStyle={chartTooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, fontSize: 11 }}>Total</Typography>
                <Typography variant="h6" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(total)}</Typography>
              </Box>
            </Box>
            <Box sx={{ flex: '1 1 260px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 1.1 }}>
              {data.map((d, i) => {
                const pct = total > 0 ? (d.value / total) * 100 : 0;
                return (
                  <Box key={i} display="flex" alignItems="center" gap={1.5}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ flex: 1 }} noWrap>{d.name}</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right' }}>{pct.toFixed(0)}%</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 100, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(d.value)}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Paper>
      );
    };

    return (
      <Box>
        {renderHeroStats(cols)}
        {renderExpenseDonut()}
        <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>Category Breakdown</Typography>
        <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
            {cols.map((p, idx) => (
              <TableCell key={idx} align="right" sx={{ fontWeight: 700 }}>{p.label}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sectionRow('Total Income', incomeTotals)}
          {hasCats ? renderGrouped(incomeRows, false) : renderFlat(incomeRows, false)}
          {incomeRows.length === 0 && (
            <TableRow><TableCell colSpan={cols.length + 1}><Typography variant="body2" color="text.secondary">No income in any shown period.</Typography></TableCell></TableRow>
          )}
          {sectionRow('Total Expense', expenseTotals, true)}
          {hasCats ? renderGrouped(expenseRows, true) : renderFlat(expenseRows, true)}
          {expenseRows.length === 0 && (
            <TableRow><TableCell colSpan={cols.length + 1}><Typography variant="body2" color="text.secondary">No expenses in any shown period.</Typography></TableCell></TableRow>
          )}
          {sectionRow('Net', netTotals)}
        </TableBody>
        </Table>
      </Box>
    );
  };

  // Fixed color cycle for accounts -- banks don't carry a category-style
  // color, so each gets a stable hue by index (matches the reference app's
  // "one flat color per account" convention closely enough without needing
  // a new per-bank color field).
  const ACCOUNT_COLORS = ['#1aa565', '#3f78de', '#e08a2a', '#d666c4', '#2ab6c9', '#c94f4f', '#7c5cd6', '#9aa32a'];

  const renderBalanceTrend = () => {
    if (!balance) return null;
    const series = balance.series || [];
    const up = (balance.net_change || 0) >= 0;
    // bank_type='investment' rows exist only so CAS/PPF statement emails can be
    // auto-downloaded (see the Add Bank form) -- they're not real balance-bearing
    // accounts, so they're excluded here, same as the main Dashboard's Accounts widget.
    const visibleBanks = banks.filter((bk) => bk.bank_type !== 'investment');
    const accountTotal = visibleBanks.reduce((s, bk) => s + signedAccountBalance(bk), 0);
    const maxAccountMag = Math.max(0, ...visibleBanks.map((bk) => Math.abs(signedAccountBalance(bk))));

    return (
      <Box>
        <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
          <Paper variant="outlined" sx={{
            p: 2.75, flex: '1 1 260px', minWidth: 260, borderRadius: 4,
            backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(theme.palette.primary.main, 0)} 65%)`,
          }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>Ending Balance</Typography>
            <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.5 }}>{money(balance.ending_balance || 0)}</Typography>
          </Paper>
          <Paper variant="outlined" sx={{
            p: 2.75, flex: '1 1 260px', minWidth: 260, borderRadius: 4,
            backgroundImage: `linear-gradient(135deg, ${alpha(up ? theme.palette.success.main : theme.palette.error.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, transparent 65%)`,
          }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>Net Change</Typography>
            <Box display="flex" alignItems="center" gap={0.75} mt={0.5}>
              {up ? <TrendingUp sx={{ color: 'success.main' }} /> : <TrendingDown sx={{ color: 'error.main' }} />}
              <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color: up ? 'success.main' : 'error.main' }}>
                {up ? '+' : ''}{money(balance.net_change || 0)}
              </Typography>
            </Box>
          </Paper>
        </Box>

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

        <Divider sx={{ my: 3 }} />
        <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>Accounts</Typography>
        <Box>
          {visibleBanks.map((bk, idx) => {
            const signed = signedAccountBalance(bk);
            const barColor = ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length];
            const barPct = maxAccountMag > 0 ? Math.min(100, (Math.abs(signed) / maxAccountMag) * 100) : 0;
            return (
              <Box key={bk.id} sx={{ py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Box display="flex" alignItems="center" gap={1.25} sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: barColor, flexShrink: 0 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{bk.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                        {bk.bank_type || 'account'}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: signed < 0 ? 'error.main' : 'text.primary' }}>
                    {formatCurrency(signed, { currency: bk.currency_code })}
                  </Typography>
                </Box>
                <Box sx={{ mt: 0.75, height: 4, borderRadius: 2, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
                  <Box sx={{ height: '100%', width: `${barPct}%`, borderRadius: 2, bgcolor: barColor }} />
                </Box>
              </Box>
            );
          })}
          {visibleBanks.length === 0 && (
            <Typography variant="body2" color="text.secondary">No accounts to display.</Typography>
          )}
          {visibleBanks.length > 0 && (
            <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ pt: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>Total</Typography>
              <Typography variant="subtitle2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: accountTotal < 0 ? 'error.main' : 'text.primary' }}>
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
    <Box>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 } }}>
        <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Analytics</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
          See how your money moves, spot trends, and drill into any number.
        </Typography>
      </Box>
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
          <MonthPager period={period} onChange={setPeriod} />
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
          {tab === 0 && (
            <Box display="flex" justifyContent="flex-end" mb={1}>
              <MuiTooltip title="Report options">
                <IconButton size="small" onClick={(e) => setReportOptionsAnchor(e.currentTarget)}>
                  <TuneOutlined fontSize="small" />
                </IconButton>
              </MuiTooltip>
              <Popover
                open={Boolean(reportOptionsAnchor)}
                anchorEl={reportOptionsAnchor}
                onClose={() => setReportOptionsAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <Box sx={{ p: 2.5, width: 280 }}>
                  <FormControl component="fieldset" sx={{ mb: 2.5 }}>
                    <FormLabel component="legend" sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>Sort by</FormLabel>
                    <RadioGroup value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      <FormControlLabel value="default" control={<Radio size="small" />} label="Default" />
                      <FormControlLabel value="amount_asc" control={<Radio size="small" />} label="Amount (lowest first)" />
                      <FormControlLabel value="amount_desc" control={<Radio size="small" />} label="Amount (highest first)" />
                    </RadioGroup>
                  </FormControl>

                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: 13, mb: 0.5 }}>
                    Number of columns: {numColumns}
                  </Typography>
                  <Slider
                    size="small"
                    value={numColumns}
                    min={1}
                    max={6}
                    step={1}
                    marks
                    onChange={(_, v) => setNumColumns(v)}
                    sx={{ mb: 2 }}
                  />

                  <FormControlLabel
                    control={<Switch size="small" checked={showPctDiff} onChange={(e) => setShowPctDiff(e.target.checked)} />}
                    label="Show percentage difference"
                  />
                </Box>
              </Popover>
            </Box>
          )}
          {loading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={360}>
              <CircularProgress />
            </Box>
          ) : (
            <Fade in key={`${tab}-${period.label}-${numColumns}`} timeout={220}>
              <Box>{renderActiveTab()}</Box>
            </Fade>
          )}
        </Paper>
      </Box>

      <Dialog open={Boolean(drillDown)} onClose={closeDrillDown} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>{drillDown?.category || 'Uncategorized'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {drillDownLoading ? 'Loading…' : `${drillDownRows.length} record${drillDownRows.length === 1 ? '' : 's'}`} — {drillDown?.label}
            </Typography>
          </Box>
          <IconButton size="small" onClick={closeDrillDown}><Close fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {drillDownLoading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress size={28} /></Box>
          ) : drillDownRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No transactions found.</Typography>
          ) : (
            <Stack divider={<Divider />} spacing={0}>
              {drillDownRows.map((t) => (
                <Box key={t.id} sx={{ py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <CategoryIcon name={t.category} size={32} />
                  <Box flex={1} minWidth={0}>
                    <Typography variant="body2" fontWeight={600} noWrap>{t.description || 'Uncategorized'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.bank_name || 'External'}{t.source ? ` · ${t.source}` : ''}
                    </Typography>
                  </Box>
                  <Box textAlign="right">
                    <Typography variant="body2" fontWeight={600} sx={{ color: t.transaction_type === 'debit' ? 'error.main' : 'success.main' }}>
                      {t.transaction_type === 'debit' ? '-' : '+'}{money(t.amount)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(t.transaction_date).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
      </Box>
    </Box>
  );
};

export default ModernDashboard;
