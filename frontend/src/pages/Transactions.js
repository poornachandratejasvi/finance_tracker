import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import {
  Container, Paper, Typography, Box, Button, TextField, Select, MenuItem,
  FormControl, InputLabel, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, CircularProgress, Tooltip, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  Edit, Delete, Refresh, Add, Comment, FileDownload, ContentCopy, DeleteSweep, CheckCircleOutline, AutoAwesome,
} from '@mui/icons-material';
import api, {
  getTransactions, deleteTransaction,
  getBanks, getLabels, getCategories, getCurrencies, bulkLabelTransactions, createAutoLabelRule,
  bulkDeleteTransactions, bulkConfirmTransactions,
  getSavedFilters, createSavedFilter, deleteSavedFilter,
} from '../services/api';
import BulkEditDialog from '../components/BulkEditDialog.jsx';
import FilterSidebar from '../components/FilterSidebar.jsx';
import MonthPager, { currentMonthPeriod } from '../components/MonthPager.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';
import TransactionDialog from '../components/TransactionDialog.jsx';
import { formatCurrency } from '../utils/format';

// Filter shape used by FilterSidebar (subset of DEFAULT_FILTERS we actually drive).
const INITIAL_FILTERS = {
  search: '',
  accountIds: [],
  categoryNames: [],
  labelIds: [],
  recordTypes: [],
  paymentTypes: [],
  amountMin: null,
  amountMax: null,
  confirmationStatus: 'all',
};

const SORT_OPTIONS = [
  { value: 'date:desc', label: 'Newest first' },
  { value: 'date:asc', label: 'Oldest first' },
  { value: 'amount:desc', label: 'Amount high → low' },
  { value: 'amount:asc', label: 'Amount low → high' },
];

// Account colored dot by bank_type.
const accountDotColor = (bankType) => {
  const t = (bankType || '').toLowerCase();
  if (t === 'credit') return '#b07aa1';
  if (t === 'savings') return '#4e79a7';
  return '#59a14f';
};

// Parse an ISO timestamp that may be naive-UTC (no tz marker) and render local.
const parseTs = (iso) => {
  if (!iso) return null;
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayKey = (iso) => {
  const d = parseTs(iso);
  return d ? d.toLocaleDateString('en-CA') : 'unknown'; // YYYY-MM-DD (local)
};
const formatDayHeader = (iso) => {
  const d = parseTs(iso);
  return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown date';
};
const formatTime = (iso) => {
  const d = parseTs(iso);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
};

function Transactions() {
  const location = useLocation();
  const [transactions, setTransactions] = useState([]);
  const [banks, setBanks] = useState([]);
  const [labels, setLabels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [amountBound, setAmountBound] = useState(500000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [total, setTotal] = useState(0);
  const [period, setPeriod] = useState(() => currentMonthPeriod());

  // "My filter" -- named filter presets (scope='records'), same SavedFilter table/
  // API ModernDashboard.jsx already uses for Analytics (scope='analytics').
  const [savedFilters, setSavedFilters] = useState([]);
  const [selectedSavedId, setSelectedSavedId] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams(location.search);
    const bankId = params.get('bank_id');
    const search = params.get('search');
    const category = params.get('category');
    const labelId = params.get('label_id');
    return {
      ...INITIAL_FILTERS,
      ...(bankId ? { accountIds: [Number(bankId)] } : {}),
      ...(search ? { search } : {}),
      ...(category ? { categoryNames: [category] } : {}),
      ...(labelId ? { labelIds: [Number(labelId)] } : {}),
    };
  });
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const [selectedTransactions, setSelectedTransactions] = useState([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTransaction, setDialogTransaction] = useState(null); // null = add mode
  const [dialogDraft, setDialogDraft] = useState(null); // AI quick-add pre-fill, add mode only

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');

  const [labelDialog, setLabelDialog] = useState({ open: false, transaction: null });
  const [selectedLabelIds, setSelectedLabelIds] = useState([]);
  const [labelKeywordMode, setLabelKeywordMode] = useState('description');
  const [labelCustomKeywords, setLabelCustomKeywords] = useState('');
  const [matchingKeywords, setMatchingKeywords] = useState([]);
  const [selectedMatchingKeywords, setSelectedMatchingKeywords] = useState([]);

  // Reference data + a sensible amount-slider bound, loaded once on mount.
  useEffect(() => {
    (async () => {
      const [b, l, c, cur] = await Promise.all([
        getBanks().catch(() => []),
        getLabels().catch(() => []),
        getCategories().catch(() => []),
        getCurrencies().catch(() => []),
      ]);
      setBanks(b || []);
      setLabels(l || []);
      setCategories(c || []);
      setCurrencies(cur || []);
      try {
        const res = await getTransactions({ sort_by: 'amount', sort_dir: 'desc', limit: 1 });
        const max = res.items?.[0]?.amount;
        if (max) setAmountBound(Math.max(1000, Math.ceil(max / 1000) * 1000));
      } catch {
        // keep fallback (500000)
      }
    })();
  }, []);

  // Debounce only the free-text search field (~400ms).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filters.search), 400);
    return () => clearTimeout(id);
  }, [filters.search]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      // Month-scoped (like the reference app) rather than paginated -- a single
      // period's transactions are fetched in one shot (a "high enough" cap, not
      // true pagination) so the period's net total and "select all" are computed
      // from the full period, not just one page of it.
      const params = { limit: 5000, sort_by: sortBy, sort_dir: sortDir };
      if (period?.start_date) params.start_date = period.start_date;
      if (period?.end_date) params.end_date = period.end_date;
      if (filters.accountIds.length) params.bank_id = filters.accountIds.join(',');
      if (filters.categoryNames.length) params.category = filters.categoryNames.join(',');
      if (filters.labelIds.length) params.label_id = filters.labelIds.join(',');
      if (filters.recordTypes.length) params.transaction_type = filters.recordTypes.join(',');
      if (filters.amountMin != null && filters.amountMin !== '') params.min_amount = filters.amountMin;
      if (filters.amountMax != null && filters.amountMax !== '') params.max_amount = filters.amountMax;
      if (filters.confirmationStatus && filters.confirmationStatus !== 'all') {
        params.is_confirmed = filters.confirmationStatus === 'confirmed';
      }
      if (filters.paymentTypes.length) params.source = filters.paymentTypes.join(',');
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await getTransactions(params);
      setTransactions(res.items || []);
      setTotal(res.total || 0);
    } catch (err) {
      // Surface the real cause instead of a generic message -- a timeout, a
      // network drop, and a genuine server error all look identical otherwise,
      // making an intermittent failure impossible to diagnose from the UI alone.
      const detail = err?.response?.data?.detail;
      const reason = typeof detail === 'string'
        ? detail
        : err?.response
          ? `Server returned ${err.response.status}`
          : err?.message || 'Network error — check your connection and try Refresh.';
      setError(`Failed to load transactions: ${reason}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [
    period, sortBy, sortDir, debouncedSearch,
    filters.accountIds, filters.categoryNames, filters.labelIds,
    filters.recordTypes, filters.amountMin, filters.amountMax, filters.confirmationStatus,
    filters.paymentTypes,
  ]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const loadSavedFilters = useCallback(() => {
    getSavedFilters('records').then((res) => setSavedFilters(Array.isArray(res) ? res : [])).catch(() => setSavedFilters([]));
  }, []);
  useEffect(() => { loadSavedFilters(); }, [loadSavedFilters]);

  const applySavedFilter = (id) => {
    setSelectedSavedId(id);
    const found = savedFilters.find((f) => f.id === id);
    if (found) handleFiltersChange(found.payload || {});
  };

  const handleSaveNew = async () => {
    const name = saveName.trim();
    if (!name) return;
    try {
      const entry = await createSavedFilter({ name, scope: 'records', payload: filters });
      setSavedFilters((prev) => [...prev, entry]);
      setSelectedSavedId(entry.id);
      setSaveName('');
      setSaveDialogOpen(false);
    } catch (err) {
      setError('Failed to save filter');
    }
  };

  const handleDeleteSaved = async () => {
    if (!selectedSavedId) return;
    try {
      await deleteSavedFilter(selectedSavedId);
      setSavedFilters((prev) => prev.filter((f) => f.id !== selectedSavedId));
      setSelectedSavedId('');
    } catch (err) {
      setError('Failed to delete filter');
    }
  };

  // Defensively normalizes the array-valued filter fields -- if a child control
  // ever passes one of these as null/undefined instead of [], fetchData's
  // `.length` reads would throw and the whole page would show as failed to load.
  const handleFiltersChange = (next) => {
    const merged = { ...INITIAL_FILTERS, ...next };
    for (const key of ['accountIds', 'categoryNames', 'labelIds', 'recordTypes', 'paymentTypes']) {
      if (!Array.isArray(merged[key])) merged[key] = [];
    }
    setFilters(merged);
  };

  const handleSortChange = (e) => {
    const [by, dir] = e.target.value.split(':');
    setSortBy(by);
    setSortDir(dir);
  };

  // Group the period's transactions by calendar day, preserving arrival order.
  const dayGroups = useMemo(() => {
    const groups = [];
    const byDay = new Map();
    transactions.forEach((t) => {
      const key = dayKey(t.transaction_date);
      let g = byDay.get(key);
      if (!g) {
        g = { key, date: t.transaction_date, currency: t.currency_code, net: 0, items: [] };
        byDay.set(key, g);
        groups.push(g);
      }
      g.items.push(t);
      g.net += (t.transaction_type === 'credit' ? 1 : -1) * Number(t.amount || 0);
    });
    return groups;
  }, [transactions]);

  const isSelected = (id) => selectedTransactions.some((s) => s.id === id);
  const allSelected = transactions.length > 0 && selectedTransactions.length === transactions.length;
  const someSelected = selectedTransactions.length > 0 && !allSelected;

  // Header net total: the selection's total once anything is checked (matching
  // the reference app), otherwise the whole period's.
  const headerNet = useMemo(() => {
    const rows = selectedTransactions.length ? selectedTransactions : transactions;
    return rows.reduce((sum, t) => sum + (t.transaction_type === 'credit' ? 1 : -1) * Number(t.amount || 0), 0);
  }, [transactions, selectedTransactions]);

  const toggleSelectAll = (checked) => setSelectedTransactions(checked ? [...transactions] : []);
  const toggleSelectOne = (t, checked) => {
    setSelectedTransactions((prev) => (checked ? [...prev, t] : prev.filter((s) => s.id !== t.id)));
  };

  // Open the Wallet-style dialog in add mode (transaction = null) or edit mode.
  const handleOpenAdd = () => {
    setDialogTransaction(null);
    setDialogDraft(null);
    setDialogOpen(true);
  };

  const handleEdit = (trans) => {
    setDialogTransaction(trans);
    setDialogDraft(null);
    setDialogOpen(true);
  };

  const handleQuickAddParse = async () => {
    const text = quickAddText.trim();
    if (!text) return;
    setQuickAddLoading(true);
    setQuickAddError('');
    try {
      const { data } = await api.post('/api/ai/quick-add', { text });
      setQuickAddOpen(false);
      setQuickAddText('');
      setDialogTransaction(null);
      setDialogDraft(data);
      setDialogOpen(true);
    } catch (err) {
      setQuickAddError(err?.response?.data?.detail || 'Could not parse that — try rephrasing with an amount.');
    } finally {
      setQuickAddLoading(false);
    }
  };

  // Refresh categories/labels so newly created ones appear in filters and chips.
  const reloadReferenceData = useCallback(async () => {
    const [c, l] = await Promise.all([
      getCategories().catch(() => null),
      getLabels().catch(() => null),
    ]);
    if (c) setCategories(c);
    if (l) setLabels(l);
  }, []);

  const handleDialogSaved = () => {
    setSuccess('Transaction saved');
    fetchData();
    reloadReferenceData();
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this transaction?')) {
      try {
        await deleteTransaction(id);
        setSuccess('Deleted');
        setSelectedTransactions((prev) => prev.filter((s) => s.id !== id));
        fetchData();
      } catch (err) {
        setError('Failed to delete');
      }
    }
  };

  const handleBulkDelete = async () => {
    const ids = selectedTransactions.map((t) => t.id);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected transaction(s)? This cannot be undone.`)) return;
    try {
      setLoading(true);
      await bulkDeleteTransactions(ids);
      setSuccess(`Deleted ${ids.length} transaction(s)`);
      setSelectedTransactions([]);
      fetchData();
    } catch (err) {
      setError('Failed to delete selected transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkConfirm = async () => {
    const ids = selectedTransactions.map((t) => t.id);
    if (!ids.length) return;
    try {
      setLoading(true);
      const { confirmed } = await bulkConfirmTransactions(ids);
      setSuccess(`Confirmed ${confirmed} transaction(s)`);
      setSelectedTransactions([]);
      fetchData();
    } catch (err) {
      setError('Failed to confirm selected transactions');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (window.confirm('Remove all duplicate transactions? This will keep the first occurrence of each duplicate.')) {
      try {
        setLoading(true);
        // Use the shared api client (correct base URL in Docker/prod + auth + refresh).
        const { data } = await api.post('/api/transactions/remove-duplicates', { keep_first: true });
        setSuccess(`Removed ${data.removed_count} duplicate transactions`);
        fetchData();
      } catch (err) {
        setError('Failed to remove duplicates');
      } finally {
        setLoading(false);
      }
    }
  };

  // Auto-merges + soft-deletes duplicates (see duplicate_resolution_service.py)
  // instead of opening a manual review dialog -- a duplicate is assumed correct
  // by default; the Recycle Bin (soft-delete, restorable for 30 days) is the
  // "confirm if it's a duplicate or not" step, for after the fact rather than
  // before. This also runs automatically once a day on its own; this button is
  // just "run it now" instead of waiting.
  const handleSolveDuplicities = async () => {
    try {
      setLoading(true);
      const { data } = await api.post('/api/transactions/duplicates/auto-resolve');
      if (!data || !data.groups_resolved) {
        setSuccess('No duplicates found!');
      } else {
        setSuccess(
          `Merged ${data.transactions_merged} duplicate transaction(s) across ${data.groups_resolved} group(s). `
          + 'Anything merged by mistake can be restored from the Recycle Bin.'
        );
        fetchData();
      }
    } catch (err) {
      setError('Failed to resolve duplicates');
      console.error('Duplicate error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      setLoading(true);
      let rows;
      if (selectedTransactions.length) {
        // Export exactly what the user selected.
        rows = selectedTransactions;
      } else {
        // Export ALL rows matching the current filters + period, same scope the list shows.
        const params = { skip: 0, limit: 10000, sort_by: sortBy, sort_dir: sortDir };
        if (period?.start_date) params.start_date = period.start_date;
        if (period?.end_date) params.end_date = period.end_date;
        if (filters.accountIds.length) params.bank_id = filters.accountIds.join(',');
        if (filters.categoryNames.length) params.category = filters.categoryNames.join(',');
        if (filters.labelIds.length) params.label_id = filters.labelIds.join(',');
        if (filters.recordTypes.length) params.transaction_type = filters.recordTypes.join(',');
        if (filters.amountMin != null && filters.amountMin !== '') params.min_amount = filters.amountMin;
        if (filters.amountMax != null && filters.amountMax !== '') params.max_amount = filters.amountMax;
        if (filters.confirmationStatus && filters.confirmationStatus !== 'all') {
          params.is_confirmed = filters.confirmationStatus === 'confirmed';
        }
        if (filters.paymentTypes.length) params.source = filters.paymentTypes.join(',');
        if (debouncedSearch) params.search = debouncedSearch;
        const res = await getTransactions(params);
        rows = res.items || [];
      }
      if (!rows.length) { setError('No transactions to export.'); return; }
      const cols = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Bank', 'Reference', 'Balance', 'Notes'];
      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const toLine = (t) => [
        (t.transaction_date || '').slice(0, 10), t.description, t.amount, t.transaction_type,
        t.category, t.bank_name, t.reference_number, t.balance, t.notes,
      ].map(esc).join(',');
      const csv = [cols.join(','), ...rows.map(toLine)].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSuccess(`Exported ${rows.length} transactions to CSV.`);
    } catch (e) {
      setError('Failed to export CSV');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenLabelDialog = (transaction) => {
    const existingLabelIds = labels
      .filter((label) => (transaction.labels || []).includes(label.name))
      .map((label) => label.id);
    const description = (transaction.description || '').toLowerCase();
    const matches = [];
    labels.forEach((label) => {
      (label.auto_keywords || []).forEach((keyword) => {
        if (keyword && description.includes(keyword.toLowerCase())) {
          matches.push({ labelId: label.id, labelName: label.name, keyword });
        }
      });
    });
    setSelectedLabelIds(existingLabelIds);
    setLabelKeywordMode('description');
    setLabelCustomKeywords('');
    setMatchingKeywords(matches);
    setSelectedMatchingKeywords([]);
    setLabelDialog({ open: true, transaction });
  };

  const handleSaveLabels = async () => {
    const transaction = labelDialog.transaction;
    if (!transaction) return;
    try {
      await Promise.all(
        selectedLabelIds.map((labelId) =>
          bulkLabelTransactions({ transaction_ids: [transaction.id], label_id: labelId })
        )
      );

      if (selectedMatchingKeywords.length) {
        await Promise.all(
          selectedMatchingKeywords.map((match) =>
            createAutoLabelRule(match.labelId, { label_id: match.labelId, keyword: match.keyword, is_active: true })
          )
        );
      } else if (labelKeywordMode === 'description') {
        const keyword = (transaction.description || '').trim();
        if (keyword) {
          await Promise.all(
            selectedLabelIds.map((labelId) =>
              createAutoLabelRule(labelId, { label_id: labelId, keyword, is_active: true })
            )
          );
        }
      } else if (labelKeywordMode === 'custom') {
        const keywords = labelCustomKeywords.split(',').map((k) => k.trim()).filter(Boolean);
        if (keywords.length) {
          await Promise.all(
            selectedLabelIds.flatMap((labelId) =>
              keywords.map((keyword) => createAutoLabelRule(labelId, { label_id: labelId, keyword, is_active: true }))
            )
          );
        }
      }

      setSuccess('Labels updated');
      setLabelDialog({ open: false, transaction: null });
      fetchData();
    } catch (err) {
      setError('Failed to update labels');
    }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Records</Typography>
        <Box display="flex" gap={1} flexWrap="wrap">
          <Button variant="contained" startIcon={<Add />} onClick={handleOpenAdd}>Add</Button>
          <Button variant="outlined" startIcon={<AutoAwesome />} onClick={() => { setQuickAddText(''); setQuickAddError(''); setQuickAddOpen(true); }}>
            Quick Add
          </Button>
          <Button variant="outlined" startIcon={<Refresh />} onClick={fetchData}>Refresh</Button>
          <Button variant="outlined" color="error" startIcon={<DeleteSweep />} onClick={handleRemoveDuplicates}>Remove Duplicates</Button>
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', md: 'row' } }}>
        <FilterSidebar
          value={filters}
          onChange={handleFiltersChange}
          banks={banks}
          categories={categories}
          labels={labels}
          amountBound={amountBound}
          show={['search', 'accounts', 'categories', 'labels', 'recordTypes', 'amount', 'confirmationStatus', 'paymentTypes']}
          myFilterSlot={(
            <Box>
              <Typography variant="caption" color="text.secondary">My filter</Typography>
              <Box display="flex" gap={0.5} mt={0.5}>
                <FormControl size="small" fullWidth>
                  <Select
                    displayEmpty
                    value={selectedSavedId}
                    onChange={(e) => applySavedFilter(e.target.value)}
                    renderValue={(sel) => savedFilters.find((f) => f.id === sel)?.name || 'Select filter'}
                  >
                    <MenuItem value=""><em>Select filter</em></MenuItem>
                    {savedFilters.map((f) => (
                      <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Tooltip title="Save as new filter">
                  <IconButton size="small" color="primary" onClick={() => setSaveDialogOpen(true)}>
                    <Add fontSize="small" />
                  </IconButton>
                </Tooltip>
                {selectedSavedId && (
                  <Tooltip title="Delete this saved filter">
                    <IconButton size="small" color="error" onClick={handleDeleteSaved}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          )}
        />

        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <MonthPager period={period} onChange={setPeriod} />

          {/* Header + bulk actions -- a selection turns the bar's background pale
              and the action buttons solid-colored (matching the reference app),
              instead of just enabling/disabling outlined buttons. */}
          <Paper
            variant="outlined"
            sx={{
              p: 1.5, mb: 2, borderRadius: 2,
              bgcolor: selectedTransactions.length > 0
                ? (theme) => alpha(theme.palette.warning.main, 0.12)
                : 'background.paper',
              transition: 'background-color .15s',
            }}
          >
            {/* Row 1: record count/selection state on the left, net total pinned to
                the right -- kept in its own non-wrapping row so a narrow viewport
                wraps the (longer) action-button row below instead of ever pushing
                the total off to its own line. */}
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1}>
              <Box display="flex" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  {selectedTransactions.length > 0
                    ? `Select all, selected ${selectedTransactions.length}`
                    : `Found ${total} record${total === 1 ? '' : 's'}`}
                </Typography>
              </Box>
              <Typography fontWeight={700} noWrap sx={{ color: headerNet < 0 ? 'error.main' : 'success.main', flexShrink: 0 }}>
                {formatCurrency(headerNet)}
              </Typography>
            </Box>

            <Box display="flex" alignItems="center" justifyContent="flex-end" flexWrap="wrap" gap={1}>
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Button
                  size="small" startIcon={<Edit />} disabled={selectedTransactions.length === 0}
                  variant={selectedTransactions.length ? 'contained' : 'outlined'} color="success"
                  onClick={() => setBulkEditOpen(true)}
                >
                  Edit
                </Button>
                <Button size="small" variant="outlined" color="success" startIcon={<CheckCircleOutline />} disabled={selectedTransactions.length === 0} onClick={handleBulkConfirm}>Mark Confirmed</Button>
                <Button
                  size="small" startIcon={<FileDownload />}
                  variant={selectedTransactions.length ? 'contained' : 'outlined'} color="warning"
                  onClick={handleExportCSV}
                >
                  Export
                </Button>
                <Button
                  size="small" startIcon={<Delete />} disabled={selectedTransactions.length === 0}
                  variant={selectedTransactions.length ? 'contained' : 'outlined'} color="error"
                  onClick={handleBulkDelete}
                >
                  Delete
                </Button>
                <Tooltip title="Auto-merges duplicate transactions and moves the extras to the Recycle Bin -- restorable there if a merge was wrong">
                  <Button
                    size="small" startIcon={<ContentCopy />}
                    variant={selectedTransactions.length ? 'contained' : 'outlined'} color="info"
                    onClick={handleSolveDuplicities}
                  >
                    Solve Duplicities
                  </Button>
                </Tooltip>
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel>Sort by</InputLabel>
                  <Select label="Sort by" value={`${sortBy}:${sortDir}`} onChange={handleSortChange}>
                    {SORT_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Box>
          </Paper>

          {/* Records list, grouped by calendar day */}
          {loading ? (
            <Box display="flex" justifyContent="center" p={6}><CircularProgress /></Box>
          ) : (
            <>
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
                {dayGroups.length === 0 ? (
                  <Box p={6} textAlign="center">
                    <Typography color="text.secondary">Sorry, no records were found for this combination of filters.</Typography>
                  </Box>
                ) : (
                  dayGroups.map((g) => (
                    <Box key={g.key}>
                      <Box
                        sx={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          px: 2, py: 1, position: 'sticky', top: 0, zIndex: 1,
                          bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider',
                        }}
                      >
                        <Typography variant="subtitle2" fontWeight={700} color="text.secondary">
                          {formatDayHeader(g.date)}
                        </Typography>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ color: g.net < 0 ? 'error.main' : 'success.main' }}>
                          {formatCurrency(g.net, { currency: g.currency })}
                        </Typography>
                      </Box>

                      {g.items.map((t) => (
                        <Box
                          key={t.id}
                          onClick={() => handleEdit(t)}
                          sx={{
                            display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1,
                            cursor: 'pointer', borderBottom: '1px solid', borderColor: 'divider',
                            '&:hover': { bgcolor: 'action.hover' },
                            '&:hover .rowActions': { opacity: 1 },
                          }}
                        >
                          <Checkbox
                            size="small"
                            checked={isSelected(t.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => toggleSelectOne(t, e.target.checked)}
                          />
                          <CategoryIcon name={t.category} size={36} />
                          {/* Category (bold) + account/source underneath it, separate from the
                              raw merchant description -- matching the reference app's layout,
                              which keeps "what kind of spend + where it came from" together and
                              gives the actual description its own column. */}
                          <Box sx={{ minWidth: 0, width: 220, flexShrink: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <Typography noWrap fontWeight={600}>{t.category || 'Uncategorized'}</Typography>
                              {t.is_confirmed === false && (
                                <Tooltip title="From a real-time bank alert — not yet matched to the official statement">
                                  <Chip label="Pending" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: 11 }} />
                                </Tooltip>
                              )}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: t.bank_color || accountDotColor(t.bank_type) }} />
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {t.bank_name || 'Unknown'}{t.source === 'sms' ? ' sms' : ''}
                              </Typography>
                            </Box>
                          </Box>

                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            {t.description && (
                              <Typography noWrap variant="body2" color="text.secondary">{t.description}</Typography>
                            )}
                          </Box>

                          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 220, flexShrink: 0 }}>
                            {(t.label_details || []).map((l) => (
                              <Chip
                                key={l.id}
                                label={l.name}
                                size="small"
                                sx={{ bgcolor: l.color || 'grey.500', color: '#fff', height: 20 }}
                              />
                            ))}
                          </Box>

                          <Box sx={{ textAlign: 'right', flexShrink: 0, minWidth: 110 }}>
                            <Typography fontWeight={700} sx={{ color: t.transaction_type === 'credit' ? 'success.main' : 'error.main' }}>
                              {t.transaction_type === 'credit' ? '+' : '-'}{formatCurrency(t.amount, { currency: t.currency_code })}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">{formatTime(t.transaction_date)}</Typography>
                          </Box>

                          <Box className="rowActions" sx={{ display: 'flex', gap: 0.25, opacity: 0, transition: 'opacity .15s', flexShrink: 0 }}>
                            <Tooltip title="Manage labels">
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenLabelDialog(t); }}>
                                <Comment fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}>
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ))
                )}
              </Paper>
            </>
          )}
        </Box>
      </Box>

      {/* Wallet-style add / edit record */}
      <TransactionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        transaction={dialogTransaction}
        initialDraft={dialogDraft}
        defaultBankId={filters.accountIds.length === 1 ? filters.accountIds[0] : undefined}
        banks={banks}
        categories={categories}
        labels={labels}
        currencies={currencies}
        onSaved={handleDialogSaved}
        onReloadCategories={reloadReferenceData}
      />

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save as new</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small" label="Name" sx={{ mt: 1 }}
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNew(); }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!saveName.trim()} onClick={handleSaveNew}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Quick Add with AI</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Type a plain-English sentence, e.g. "Spent 450 on coffee at Starbucks yesterday" —
            AI will fill in the amount, category, and date for you to review before saving.
          </Typography>
          {quickAddError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setQuickAddError('')}>{quickAddError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            placeholder="Spent 450 on coffee at Starbucks yesterday"
            value={quickAddText}
            onChange={(e) => setQuickAddText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuickAddParse(); } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuickAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={quickAddLoading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesome />}
            disabled={quickAddLoading || !quickAddText.trim()}
            onClick={handleQuickAddParse}
          >
            Parse
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manage labels */}
      <Dialog open={labelDialog.open} onClose={() => setLabelDialog({ open: false, transaction: null })} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Labels</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>Labels</InputLabel>
              <Select
                multiple
                value={selectedLabelIds}
                onChange={(e) => setSelectedLabelIds(e.target.value)}
                label="Labels"
                renderValue={(selected) => selected.map((id) => labels.find((label) => label.id === id)?.name || id).join(', ')}
              >
                {labels.map((label) => (
                  <MenuItem key={label.id} value={label.id}>{label.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Auto Keyword</InputLabel>
              <Select value={labelKeywordMode} onChange={(e) => setLabelKeywordMode(e.target.value)} label="Auto Keyword">
                <MenuItem value="none">No auto keyword</MenuItem>
                <MenuItem value="description">Use transaction description</MenuItem>
                <MenuItem value="custom">Custom keywords</MenuItem>
              </Select>
            </FormControl>
            {labelKeywordMode === 'custom' && (
              <TextField
                label="Custom keywords (comma separated)"
                value={labelCustomKeywords}
                onChange={(e) => setLabelCustomKeywords(e.target.value)}
                helperText="Adds auto labels for future similar transactions"
              />
            )}
            {matchingKeywords.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2">Matching keywords</Typography>
                  <Button size="small" onClick={() => setSelectedMatchingKeywords(matchingKeywords)}>Select All</Button>
                </Box>
                {matchingKeywords.map((match, idx) => (
                  <FormControlLabel
                    key={`${match.labelId}-${match.keyword}-${idx}`}
                    control={
                      <Checkbox
                        checked={selectedMatchingKeywords.some((m) => m.labelId === match.labelId && m.keyword === match.keyword)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMatchingKeywords([...selectedMatchingKeywords, match]);
                          } else {
                            setSelectedMatchingKeywords(selectedMatchingKeywords.filter((m) => !(m.labelId === match.labelId && m.keyword === match.keyword)));
                          }
                        }}
                      />
                    }
                    label={`${match.labelName}: ${match.keyword}`}
                  />
                ))}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLabelDialog({ open: false, transaction: null })}>Cancel</Button>
          <Button onClick={handleSaveLabels} variant="contained" disabled={selectedLabelIds.length === 0}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Bulk edit */}
      <BulkEditDialog
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        selectedTransactions={selectedTransactions}
        onSuccess={() => {
          setSuccess('Transactions updated successfully');
          setSelectedTransactions([]);
          fetchData();
        }}
      />

    </Container>
  );
}

export default Transactions;
