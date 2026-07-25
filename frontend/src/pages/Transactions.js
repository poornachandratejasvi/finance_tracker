import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, Typography, Box, Button, TextField, Select, MenuItem, FormControl,
  InputLabel, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, CircularProgress, Tooltip, Checkbox, FormControlLabel,
} from '@mui/material';
import {
  Edit, Delete, Refresh, Add, Comment, FileDownload, ContentCopy, DeleteSweep,
} from '@mui/icons-material';
import api, {
  getTransactions, deleteTransaction,
  getBanks, getLabels, getCategories, getCurrencies, bulkLabelTransactions, createAutoLabelRule,
  bulkDeleteTransactions,
} from '../services/api';
import BulkEditDialog from '../components/BulkEditDialog.jsx';
import FilterSidebar from '../components/FilterSidebar.jsx';
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
  amountMin: null,
  amountMax: null,
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
const formatDateShort = (iso) => {
  const d = parseTs(iso);
  return d ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Invalid';
};
const formatTime = (iso) => {
  const d = parseTs(iso);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
};

// Colored signed amount (uses formatCurrency for the money portion).
const renderAmount = (amt, type, currency) => (
  <Box component="span" sx={{ color: type === 'credit' ? 'success.main' : 'error.main', fontWeight: 700 }}>
    {type === 'credit' ? '+' : '-'}{formatCurrency(amt, { currency })}
  </Box>
);

function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [banks, setBanks] = useState([]);
  const [labels, setLabels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [amountBound, setAmountBound] = useState(500000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);

  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const [selectedTransactions, setSelectedTransactions] = useState([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTransaction, setDialogTransaction] = useState(null); // null = add mode

  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState([]);

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
      const params = {
        skip: page * rowsPerPage, limit: rowsPerPage,
        sort_by: sortBy, sort_dir: sortDir,
      };
      if (filters.accountIds.length) params.bank_id = filters.accountIds.join(',');
      if (filters.categoryNames.length) params.category = filters.categoryNames.join(',');
      if (filters.labelIds.length) params.label_id = filters.labelIds.join(',');
      if (filters.recordTypes.length) params.transaction_type = filters.recordTypes.join(',');
      if (filters.amountMin != null && filters.amountMin !== '') params.min_amount = filters.amountMin;
      if (filters.amountMax != null && filters.amountMax !== '') params.max_amount = filters.amountMax;
      if (debouncedSearch) params.search = debouncedSearch;
      const res = await getTransactions(params);
      setTransactions(res.items || []);
      setTotal(res.total || 0);
    } catch (err) {
      setError('Failed to load transactions');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [
    page, rowsPerPage, sortBy, sortDir, debouncedSearch,
    filters.accountIds, filters.categoryNames, filters.labelIds,
    filters.recordTypes, filters.amountMin, filters.amountMax,
  ]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Any filter change resets to the first page. Search is applied after debounce.
  const handleFiltersChange = (next) => {
    setFilters({ ...INITIAL_FILTERS, ...next });
    setPage(0);
  };

  const handleSortChange = (e) => {
    const [by, dir] = e.target.value.split(':');
    setSortBy(by);
    setSortDir(dir);
    setPage(0);
  };

  // Group the loaded page by calendar day, preserving the order rows arrive in.
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

  const toggleSelectAll = (checked) => setSelectedTransactions(checked ? [...transactions] : []);
  const toggleSelectOne = (t, checked) => {
    setSelectedTransactions((prev) => (checked ? [...prev, t] : prev.filter((s) => s.id !== t.id)));
  };

  // Open the Wallet-style dialog in add mode (transaction = null) or edit mode.
  const handleOpenAdd = () => {
    setDialogTransaction(null);
    setDialogOpen(true);
  };

  const handleEdit = (trans) => {
    setDialogTransaction(trans);
    setDialogOpen(true);
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

  const handleFindDuplicates = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/api/transactions/duplicates/find');
      if (!data || !data.groups || data.groups.length === 0) {
        setSuccess('No duplicates found!');
        setDuplicateGroups([]);
      } else {
        setDuplicateGroups(data.groups || []);
        setDuplicateDialogOpen(true);
        setSuccess(`Found ${data.duplicate_groups || 0} groups with ${data.total_duplicates || 0} duplicate transactions`);
      }
    } catch (err) {
      setError('Failed to find duplicates');
      console.error('Duplicate error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDuplicates = async (idsToDelete) => {
    try {
      setLoading(true);
      await bulkDeleteTransactions(idsToDelete);
      setSuccess(`Deleted ${idsToDelete.length} duplicate transactions`);
      setDuplicateDialogOpen(false);
      fetchData();
    } catch (err) {
      setError('Failed to delete duplicates');
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
        // Export ALL rows matching the current filters (not just the current page).
        const params = { skip: 0, limit: 10000, sort_by: sortBy, sort_dir: sortDir };
        if (filters.accountIds.length) params.bank_id = filters.accountIds.join(',');
        if (filters.categoryNames.length) params.category = filters.categoryNames.join(',');
        if (filters.labelIds.length) params.label_id = filters.labelIds.join(',');
        if (filters.recordTypes.length) params.transaction_type = filters.recordTypes.join(',');
        if (filters.amountMin != null && filters.amountMin !== '') params.min_amount = filters.amountMin;
        if (filters.amountMax != null && filters.amountMax !== '') params.max_amount = filters.amountMax;
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
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Records</Typography>
        <Box display="flex" gap={1} flexWrap="wrap">
          <Button variant="contained" startIcon={<Add />} onClick={handleOpenAdd}>Add</Button>
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
          show={['search', 'accounts', 'categories', 'labels', 'recordTypes', 'amount']}
        />

        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          {/* Header + bulk actions */}
          <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
                <Typography variant="subtitle1" fontWeight={600}>
                  Found {total} record{total === 1 ? '' : 's'}
                </Typography>
                {selectedTransactions.length > 0 && (
                  <Chip size="small" label={`${selectedTransactions.length} selected`} color="primary" sx={{ ml: 0.5 }} />
                )}
              </Box>

              <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                <Button size="small" variant="outlined" startIcon={<Edit />} disabled={selectedTransactions.length === 0} onClick={() => setBulkEditOpen(true)}>Edit</Button>
                <Button size="small" variant="outlined" startIcon={<FileDownload />} onClick={handleExportCSV}>Export</Button>
                <Button size="small" variant="outlined" color="error" startIcon={<Delete />} disabled={selectedTransactions.length === 0} onClick={handleBulkDelete}>Delete</Button>
                <Button size="small" variant="outlined" color="warning" startIcon={<ContentCopy />} onClick={handleFindDuplicates}>Solve Duplicities</Button>
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
                  <Box p={6} textAlign="center"><Typography color="text.secondary">No records found</Typography></Box>
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
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography noWrap fontWeight={600}>{t.category || 'Uncategorized'}</Typography>
                            {t.description && (
                              <Typography noWrap variant="body2" color="text.secondary">{t.description}</Typography>
                            )}
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: accountDotColor(t.bank_type) }} />
                              <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 130 }}>
                                {t.bank_name || 'Unknown'}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 220 }}>
                              {(t.label_details || []).map((l) => (
                                <Chip
                                  key={l.id}
                                  label={l.name}
                                  size="small"
                                  sx={{ bgcolor: l.color || 'grey.500', color: '#fff', height: 20 }}
                                />
                              ))}
                            </Box>
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
              <TablePagination
                component="div"
                count={total}
                page={page}
                onPageChange={(e, p) => setPage(p)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                rowsPerPageOptions={[10, 25, 50, 100]}
              />
            </>
          )}
        </Box>
      </Box>

      {/* Wallet-style add / edit record */}
      <TransactionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        transaction={dialogTransaction}
        defaultBankId={filters.accountIds.length === 1 ? filters.accountIds[0] : undefined}
        banks={banks}
        categories={categories}
        labels={labels}
        currencies={currencies}
        onSaved={handleDialogSaved}
        onReloadCategories={reloadReferenceData}
      />

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

      {/* Duplicate manager */}
      <Dialog open={duplicateDialogOpen} onClose={() => setDuplicateDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          Manage Duplicate Transactions
          <Typography variant="body2" color="text.secondary">
            Found {duplicateGroups.length} groups of duplicates. Select which transactions to delete.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            {duplicateGroups.map((group, groupIndex) => (
              <Paper key={groupIndex} sx={{ mb: 3, p: 2, bgcolor: 'grey.50' }}>
                <Typography variant="subtitle1" fontWeight="bold" mb={2}>
                  Group {groupIndex + 1}: {group.description} - {formatCurrency(group.amount)}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  Date: {formatDateShort(group.date)} | {group.count} duplicates found
                </Typography>
                <TableContainer component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">Delete?</TableCell>
                        <TableCell>ID</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Bank</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Amount</TableCell>
                        <TableCell>Type</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.transactions && group.transactions.map((trans, idx) => (
                        <TableRow key={trans.id} data-trans-id={trans.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              defaultChecked={idx > 0}
                              onChange={(e) => {
                                e.target.closest('tr').dataset.deleteSelected = e.target.checked ? 'true' : 'false';
                              }}
                            />
                          </TableCell>
                          <TableCell>{trans.id}</TableCell>
                          <TableCell>{formatDateShort(trans.date)}</TableCell>
                          <TableCell>{trans.bank_name}</TableCell>
                          <TableCell>{trans.description}</TableCell>
                          <TableCell>{renderAmount(trans.amount, trans.transaction_type, trans.currency_code)}</TableCell>
                          <TableCell>
                            <Chip
                              label={trans.transaction_type}
                              size="small"
                              color={trans.transaction_type === 'credit' ? 'success' : 'error'}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDuplicateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              const idsToDelete = [];
              document.querySelectorAll('tr[data-trans-id][data-delete-selected="true"]').forEach((tr) => {
                const id = parseInt(tr.dataset.transId, 10);
                if (id) idsToDelete.push(id);
              });
              if (idsToDelete.length === 0) {
                alert('No duplicates selected for deletion');
                return;
              }
              if (window.confirm(`Delete ${idsToDelete.length} selected duplicate transactions?`)) {
                handleDeleteDuplicates(idsToDelete);
              }
            }}
            variant="contained"
            color="error"
          >
            Delete Selected Duplicates
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default Transactions;
