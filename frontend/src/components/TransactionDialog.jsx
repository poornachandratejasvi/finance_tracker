import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Grid, Button, TextField,
  Select, MenuItem, FormControl, InputLabel, ToggleButton, ToggleButtonGroup, Chip,
  IconButton, Typography, Divider, Tooltip, Alert, CircularProgress, Autocomplete,
} from '@mui/material';
import { Add, Delete, Close, AutoAwesome } from '@mui/icons-material';
import CategoryIcon from './CategoryIcon';
import { ICON_KEYS, getCategoryIconComponent, invalidateCategories } from '../utils/categories';
import { formatCurrency } from '../utils/format';
import api, {
  createTransaction, updateTransaction, deleteTransaction,
  createCategory, createLabel, createAutoRule, bulkLabelTransactions,
} from '../services/api';

// Wallet-style Add/Edit dialog.
// Expense -> debit, Income -> credit, Transfer -> debit (+ default category "Transfer").
const MODE_TO_TYPE = { expense: 'debit', income: 'credit', transfer: 'debit' };
const PAYMENT_TYPES = ['Card', 'Cash', 'Bank transfer', 'UPI', 'Other'];
const PAYMENT_STATUSES = ['Cleared', 'Pending'];
const KIND_OPTIONS = ['expense', 'income', 'transfer'];

const EMPTY_NEW_CATEGORY = { name: '', icon: 'Category', color: '#4e79a7', kind: 'expense', parent_id: '' };
const EMPTY_NEW_LABEL = { name: '', color: '#1aa565' };

// Parse an ISO string (possibly naive-UTC) into a value for <input type="datetime-local">.
const toLocalInput = (iso) => {
  if (!iso) return '';
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const parseCustom = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
};

const errMsg = (err, fallback) => {
  const d = err?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

export default function TransactionDialog({
  open,
  onClose,
  transaction = null,
  defaultBankId,
  banks = [],
  categories = [],
  labels = [],
  currencies = [],
  onSaved,
  onReloadCategories,
}) {
  const isEdit = Boolean(transaction && transaction.id);

  const [mode, setMode] = useState('expense');
  const [bankId, setBankId] = useState('');
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [category, setCategory] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState([]);
  const [dateTime, setDateTime] = useState('');
  const [note, setNote] = useState('');
  const [desc, setDesc] = useState('');   // the transaction description (payee/payer text)
  const [payer, setPayer] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');

  const [originalLabelIds, setOriginalLabelIds] = useState([]);
  const [createdLabels, setCreatedLabels] = useState([]);

  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategory, setNewCategory] = useState(EMPTY_NEW_CATEGORY);
  const [creatingCategory, setCreatingCategory] = useState(false);

  const [showCreateLabel, setShowCreateLabel] = useState(false);
  const [newLabel, setNewLabel] = useState(EMPTY_NEW_LABEL);
  const [creatingLabel, setCreatingLabel] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // "New automatic rule from record" sub-dialog
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleKeywords, setRuleKeywords] = useState([]);
  const [ruleKwInput, setRuleKwInput] = useState('');
  const [ruleSaving, setRuleSaving] = useState(false);

  const bankCurrency = (id) => {
    const b = banks.find((x) => String(x.id) === String(id));
    return b?.currency_code;
  };

  // Initialize state whenever the dialog opens (or the target transaction changes).
  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      const t = transaction;
      let m = 'expense';
      if (t.transaction_type === 'credit') m = 'income';
      else if ((t.category || '') === 'Transfer') m = 'transfer';
      setMode(m);
      setBankId(t.bank_id || '');
      setAmount(t.amount != null ? String(t.amount) : '');
      setCurrencyCode(t.currency_code || bankCurrency(t.bank_id) || 'INR');
      setCategory(t.category || '');
      const labelIds = (t.label_details || []).map((l) => l.id);
      setSelectedLabelIds(labelIds);
      setOriginalLabelIds(labelIds);
      setDateTime(toLocalInput(t.transaction_date) || toLocalInput(new Date().toISOString()));
      setNote(t.notes || '');
      setDesc(t.description || '');
      setPayer(t.from_account || '');
      const cf = parseCustom(t.custom_fields);
      setPaymentType(cf.payment_type || '');
      setPaymentStatus(cf.payment_status || '');
    } else {
      const bid = defaultBankId || (banks[0] && banks[0].id) || '';
      setMode('expense');
      setBankId(bid);
      setAmount('');
      setCurrencyCode(bankCurrency(bid) || 'INR');
      setCategory('');
      setSelectedLabelIds([]);
      setOriginalLabelIds([]);
      setDateTime(toLocalInput(new Date().toISOString()));
      setNote('');
      setDesc('');
      setPayer('');
      setPaymentType('');
      setPaymentStatus('');
    }
    setCreatedLabels([]);
    setShowCreateCategory(false);
    setNewCategory(EMPTY_NEW_CATEGORY);
    setShowCreateLabel(false);
    setNewLabel(EMPTY_NEW_LABEL);
    setError('');
    setNotice('');
    setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction]);

  const typeColor = mode === 'income' ? 'success.main' : mode === 'transfer' ? 'text.secondary' : 'error.main';

  // Flattened category hierarchy: roots then indented children (built from parent_id).
  const categoryItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.name || '').localeCompare(b.name || '');
    const roots = categories.filter((c) => c.parent_id == null).sort(byOrder);
    const childrenOf = (pid) => categories.filter((c) => c.parent_id === pid).sort(byOrder);
    roots.forEach((r) => {
      items.push({ cat: r, depth: 0 });
      seen.add(r.id);
      childrenOf(r.id).forEach((k) => { items.push({ cat: k, depth: 1 }); seen.add(k.id); });
    });
    // Any categories whose parent isn't a listed root (defensive) appear at depth 0.
    categories.filter((c) => !seen.has(c.id)).sort(byOrder).forEach((c) => items.push({ cat: c, depth: 0 }));
    return items;
  }, [categories]);

  const categoryInList = categoryItems.some((i) => i.cat.name === category);

  // Combine parent-provided labels with any created inside this dialog (so chips resolve).
  const allLabels = useMemo(() => {
    const ids = new Set(labels.map((l) => l.id));
    return [...labels, ...createdLabels.filter((l) => !ids.has(l.id))];
  }, [labels, createdLabels]);

  const currencyCodes = useMemo(() => {
    const set = new Set((currencies || []).map((c) => c.code).filter(Boolean));
    if (currencyCode) set.add(currencyCode);
    if (!set.size) ['INR', 'USD', 'EUR', 'GBP'].forEach((c) => set.add(c));
    return [...set];
  }, [currencies, currencyCode]);

  const handleModeChange = (_e, val) => {
    if (!val) return;
    setMode(val);
    if (val === 'transfer' && !category) setCategory('Transfer');
  };

  const handleBankChange = (e) => {
    const val = e.target.value;
    setBankId(val);
    const cur = bankCurrency(val);
    if (cur) setCurrencyCode(cur);
  };

  const handleCategoryChange = (e) => {
    const val = e.target.value;
    if (val === '__create__') { setShowCreateCategory(true); return; }
    setCategory(val);
  };

  const submitCreateCategory = async () => {
    if (!newCategory.name.trim()) return;
    setCreatingCategory(true);
    setError('');
    try {
      const created = await createCategory({
        name: newCategory.name.trim(),
        icon: newCategory.icon,
        color: newCategory.color,
        kind: newCategory.kind,
        parent_id: newCategory.parent_id || null,
      });
      invalidateCategories();
      setCategory(created?.name || newCategory.name.trim());
      setShowCreateCategory(false);
      setNewCategory(EMPTY_NEW_CATEGORY);
      if (onReloadCategories) onReloadCategories();
    } catch (err) {
      setError(errMsg(err, 'Failed to create category'));
    } finally {
      setCreatingCategory(false);
    }
  };

  const submitCreateLabel = async () => {
    if (!newLabel.name.trim()) return;
    setCreatingLabel(true);
    setError('');
    try {
      const created = await createLabel({ name: newLabel.name.trim(), color: newLabel.color, auto_keywords: [] });
      if (created?.id) {
        setCreatedLabels((prev) => [...prev, created]);
        setSelectedLabelIds((prev) => [...prev, created.id]);
      }
      setShowCreateLabel(false);
      setNewLabel(EMPTY_NEW_LABEL);
    } catch (err) {
      setError(errMsg(err, 'Failed to create label'));
    } finally {
      setCreatingLabel(false);
    }
  };

  // Add-only: apply labels selected but not already on the record. (No remove endpoint.)
  const syncLabels = async (id, selected, original) => {
    const orig = new Set(original);
    const toAdd = selected.filter((x) => !orig.has(x));
    for (const labelId of toAdd) {
      // eslint-disable-next-line no-await-in-loop
      await bulkLabelTransactions({ transaction_ids: [id], label_id: labelId });
    }
  };

  const applyCustomFields = async (id) => {
    const cf = {};
    if (paymentType) cf.payment_type = paymentType;
    if (paymentStatus) cf.payment_status = paymentStatus;
    if (id && Object.keys(cf).length) {
      // Dedicated endpoint (create/update transaction schemas don't accept custom_fields).
      await api.post(`/api/transactions/${id}/custom-fields`, cf);
    }
  };

  const handleSave = async () => {
    if (!bankId) { setError('Please select an account'); return; }
    const amt = parseFloat(amount);
    if (!amount || Number.isNaN(amt)) { setError('Please enter a valid amount'); return; }

    setSaving(true);
    setError('');
    try {
      const isoDate = dateTime ? new Date(dateTime).toISOString() : new Date().toISOString();
      const commonType = MODE_TO_TYPE[mode];

      if (isEdit) {
        const editPayload = {
          transaction_date: isoDate,
          amount: Math.abs(amt),
          transaction_type: commonType,
          category: category || null,
          notes: note.trim() || null,
          from_account: payer.trim() || null,
        };
        // Only send description when it has a value, so clearing it can't wipe the record's text.
        if (desc.trim()) editPayload.description = desc.trim();
        await updateTransaction(transaction.id, editPayload);
        await applyCustomFields(transaction.id);
        await syncLabels(transaction.id, selectedLabelIds, originalLabelIds);
      } else {
        const description = desc.trim() || note.trim() || category || 'Manual transaction';
        const created = await createTransaction({
          bank_id: parseInt(bankId, 10),
          transaction_date: isoDate,
          description,
          amount: Math.abs(amt),
          transaction_type: commonType,
          category: category || null,
          notes: note.trim() || null,
          from_account: payer.trim() || null,
          currency_code: currencyCode || null,
        });
        const newId = created?.id;
        await applyCustomFields(newId);
        await syncLabels(newId, selectedLabelIds, []);
      }

      if (onSaved) onSaved();
      if (onClose) onClose();
    } catch (err) {
      setError(errMsg(err, 'Failed to save transaction'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm('Delete this transaction?')) return;
    setSaving(true);
    setError('');
    try {
      await deleteTransaction(transaction.id);
      if (onSaved) onSaved();
      if (onClose) onClose();
    } catch (err) {
      setError(errMsg(err, 'Failed to delete transaction'));
    } finally {
      setSaving(false);
    }
  };

  // Open the "new automatic rule" dialog, seeding a suggested keyword from the record's text.
  const openRuleDialog = () => {
    if (!category) { setError('Pick a category first to build a rule'); return; }
    const source = (desc || transaction?.description || note || '').trim();
    // Suggest a distinctive merchant token: split on separators/VPA markers, then prefer a token
    // that has letters and isn't a generic bank/rail prefix or a pure reference number.
    const SKIP = new Set(['UPI', 'NEFT', 'IMPS', 'RTGS', 'ACH', 'POS', 'ATM', 'TXN', 'PAYMENT', 'PAYU', 'OKAXIS', 'OKICICI', 'OKHDFCBANK', 'YBL', 'PAYTM']);
    const tokens = source.split(/[\s/@.\-_,]+/).filter((w) => w.length > 2);
    const hasLetters = (w) => /[a-zA-Z]/.test(w) && !/^\d+$/.test(w);
    const suggested =
      tokens.find((w) => hasLetters(w) && !SKIP.has(w.toUpperCase())) ||
      tokens.find((w) => hasLetters(w)) ||
      '';
    setRuleKeywords(suggested ? [suggested] : []);
    setRuleKwInput('');
    setError('');
    setRuleOpen(true);
  };

  // Commit whatever's still typed in the rule's Keywords box (Enter never pressed) so it
  // isn't silently dropped when Create rule is clicked directly.
  const commitPendingRuleKeyword = () => {
    const pending = ruleKwInput.trim();
    if (!pending) return ruleKeywords;
    const already = ruleKeywords.some((k) => k.toLowerCase() === pending.toLowerCase());
    const next = already ? ruleKeywords : [...ruleKeywords, pending];
    setRuleKeywords(next);
    setRuleKwInput('');
    return next;
  };

  const handleSaveRule = async () => {
    const kws = Array.from(new Set(
      commitPendingRuleKeyword().map((k) => String(k).trim()).filter(Boolean)
    ));
    if (!kws.length) { setError('Add at least one keyword to match'); return; }
    setRuleSaving(true);
    setError('');
    try {
      // Wallet-style Automatic Rule: matches records whose description contains any keyword,
      // then assigns this record's category + labels. Shows in Settings → Automatic Rules.
      const recordType = mode === 'income' ? 'credit' : mode === 'transfer' ? 'transfer' : 'debit';
      await createAutoRule({
        name: `${kws[0]} → ${category}`,
        keywords: kws,
        record_type: recordType,
        category,
        label_ids: selectedLabelIds || [],
      });
      setRuleOpen(false);
      setNotice(`Automatic rule created for ${kws.length} keyword(s) → ${category}. See Settings → Automatic Rules.`);
    } catch (err) {
      setError(errMsg(err, 'Failed to create rule'));
    } finally {
      setRuleSaving(false);
    }
  };

  const previewAmount = amount && !Number.isNaN(parseFloat(amount)) ? Math.abs(parseFloat(amount)) : 0;
  const previewSign = mode === 'income' ? '+' : mode === 'transfer' ? '' : '-';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        {isEdit ? 'Edit Record' : 'New Record'}
        <IconButton onClick={onClose} size="small"><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

        <Grid container spacing={3}>
          {/* LEFT COLUMN */}
          <Grid item xs={12} md={7}>
            <ToggleButtonGroup
              exclusive
              fullWidth
              value={mode}
              onChange={handleModeChange}
              sx={{
                mb: 2,
                '& .MuiToggleButton-root.Mui-selected': {
                  color: '#fff',
                  '&:hover': { opacity: 0.9 },
                },
                '& .MuiToggleButton-root.Mui-selected.mode-expense': { bgcolor: 'error.main' },
                '& .MuiToggleButton-root.Mui-selected.mode-income': { bgcolor: 'success.main' },
                '& .MuiToggleButton-root.Mui-selected.mode-transfer': { bgcolor: 'grey.600' },
              }}
            >
              <ToggleButton value="expense" className="mode-expense">Expense</ToggleButton>
              <ToggleButton value="income" className="mode-income">Income</ToggleButton>
              <ToggleButton value="transfer" className="mode-transfer">Transfer</ToggleButton>
            </ToggleButtonGroup>

            {/* Amount + currency */}
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                label="Amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                fullWidth
                inputProps={{ min: 0, step: '0.01' }}
                sx={{ '& input': { color: typeColor, fontWeight: 700, fontSize: '1.25rem' } }}
              />
              <FormControl sx={{ minWidth: 110 }}>
                <InputLabel>Currency</InputLabel>
                <Select value={currencyCode} label="Currency" onChange={(e) => setCurrencyCode(e.target.value)}>
                  {currencyCodes.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            <Typography variant="body2" sx={{ mb: 2, color: typeColor, fontWeight: 600 }}>
              {previewSign}{formatCurrency(previewAmount, { currency: currencyCode })}
            </Typography>

            {/* Account */}
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Account</InputLabel>
              <Select value={bankId} label="Account" onChange={handleBankChange}>
                {banks.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
              </Select>
            </FormControl>

            {/* Category */}
            <FormControl fullWidth sx={{ mb: showCreateCategory ? 1 : 2 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={category}
                label="Category"
                onChange={handleCategoryChange}
                renderValue={(val) => {
                  if (!val) return <em>Uncategorized</em>;
                  const meta = categories.find((c) => c.name === val);
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CategoryIcon
                        name={val}
                        size={22}
                        meta={meta ? { icon: meta.icon, color: meta.color, kind: meta.kind } : undefined}
                      />
                      <span>{val}</span>
                    </Box>
                  );
                }}
              >
                {category && !categoryInList && (
                  <MenuItem value={category}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CategoryIcon name={category} size={22} />
                      <span>{category}</span>
                    </Box>
                  </MenuItem>
                )}
                {categoryItems.map(({ cat, depth }) => (
                  <MenuItem key={cat.id} value={cat.name} sx={{ pl: 2 + depth * 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CategoryIcon name={cat.name} size={22} meta={{ icon: cat.icon, color: cat.color, kind: cat.kind }} />
                      <span>{cat.name}</span>
                    </Box>
                  </MenuItem>
                ))}
                <Divider />
                <MenuItem value="__create__" sx={{ color: 'primary.main', fontWeight: 600 }}>
                  <Add fontSize="small" sx={{ mr: 1 }} /> Create new category
                </MenuItem>
              </Select>
            </FormControl>

            {showCreateCategory && (
              <Box sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>New category</Typography>
                <TextField
                  fullWidth size="small" label="Name" value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  sx={{ mb: 1.5 }}
                />
                <Typography variant="caption" color="text.secondary">Icon</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, my: 0.5, maxHeight: 120, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
                  {ICON_KEYS.map((key) => {
                    const IconComp = getCategoryIconComponent(key);
                    const selected = newCategory.icon === key;
                    return (
                      <Tooltip title={key} key={key}>
                        <IconButton
                          size="small"
                          onClick={() => setNewCategory({ ...newCategory, icon: key })}
                          sx={{ border: selected ? '2px solid' : '1px solid transparent', borderColor: selected ? 'primary.main' : 'transparent', borderRadius: 1 }}
                        >
                          <IconComp fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    );
                  })}
                </Box>
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, mb: 1.5 }}>
                  <TextField
                    label="Color" type="color" size="small" value={newCategory.color}
                    onChange={(e) => setNewCategory({ ...newCategory, color: e.target.value })}
                    sx={{ width: 90 }}
                  />
                  <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel>Kind</InputLabel>
                    <Select value={newCategory.kind} label="Kind" onChange={(e) => setNewCategory({ ...newCategory, kind: e.target.value })}>
                      {KIND_OPTIONS.map((k) => <MenuItem key={k} value={k} sx={{ textTransform: 'capitalize' }}>{k}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
                    <InputLabel>Parent</InputLabel>
                    <Select value={newCategory.parent_id} label="Parent" onChange={(e) => setNewCategory({ ...newCategory, parent_id: e.target.value })}>
                      <MenuItem value=""><em>None (top level)</em></MenuItem>
                      {categories.filter((c) => c.parent_id == null).map((c) => (
                        <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={() => setShowCreateCategory(false)}>Cancel</Button>
                  <Button size="small" variant="contained" onClick={submitCreateCategory} disabled={!newCategory.name.trim() || creatingCategory}>
                    {creatingCategory ? 'Creating…' : 'Create'}
                  </Button>
                </Box>
              </Box>
            )}

            {/* Labels */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: showCreateLabel ? 1 : 2 }}>
              <FormControl fullWidth>
                <InputLabel>Labels</InputLabel>
                <Select
                  multiple
                  value={selectedLabelIds}
                  label="Labels"
                  onChange={(e) => setSelectedLabelIds(e.target.value)}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((id) => {
                        const l = allLabels.find((x) => x.id === id);
                        return (
                          <Chip key={id} size="small" label={l?.name || id} sx={{ bgcolor: l?.color || 'grey.500', color: '#fff', height: 22 }} />
                        );
                      })}
                    </Box>
                  )}
                >
                  {allLabels.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: l.color || 'grey.500', mr: 1 }} />
                      {l.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Tooltip title="Create label">
                <IconButton onClick={() => setShowCreateLabel((v) => !v)} sx={{ mt: 0.5 }}><Add /></IconButton>
              </Tooltip>
            </Box>

            {showCreateLabel && (
              <Box sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField size="small" label="Label name" value={newLabel.name} onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })} sx={{ flex: 1 }} />
                <TextField size="small" label="Color" type="color" value={newLabel.color} onChange={(e) => setNewLabel({ ...newLabel, color: e.target.value })} sx={{ width: 80 }} />
                <Button size="small" variant="contained" onClick={submitCreateLabel} disabled={!newLabel.name.trim() || creatingLabel}>
                  {creatingLabel ? '…' : 'Add'}
                </Button>
              </Box>
            )}

            {/* Date & time */}
            <TextField
              fullWidth
              label="Date & time"
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {/* RIGHT COLUMN */}
          <Grid item xs={12} md={5}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Other details</Typography>
            <TextField
              fullWidth
              label={mode === 'income' ? 'Payer / Description' : mode === 'transfer' ? 'Description' : 'Payee / Description'}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Who was paid / received — e.g. NOKIA SOLUTIONS"
              multiline
              maxRows={3}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth multiline rows={3} label="Note" value={note}
              onChange={(e) => setNote(e.target.value)} sx={{ mb: 2 }}
            />
            <TextField
              fullWidth label="From account (optional)" value={payer}
              onChange={(e) => setPayer(e.target.value)} sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Payment type</InputLabel>
              <Select value={paymentType} label="Payment type" onChange={(e) => setPaymentType(e.target.value)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {PAYMENT_TYPES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Payment status</InputLabel>
              <Select value={paymentStatus} label="Payment status" onChange={(e) => setPaymentStatus(e.target.value)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {PAYMENT_STATUSES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>

            <Button
              size="small"
              startIcon={<AutoAwesome />}
              onClick={openRuleDialog}
              sx={{ textTransform: 'none' }}
            >
              New automatic rule from record
            </Button>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Box>
          {isEdit && (
            <Button color="error" startIcon={<Delete />} onClick={handleDelete} disabled={saving}>
              Delete
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </Box>
      </DialogActions>

      {/* New automatic rule from record — asks for the keyword(s) to match on */}
      <Dialog open={ruleOpen} onClose={() => setRuleOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesome color="primary" fontSize="small" /> New automatic rule
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Future (and existing, when you re-apply) records whose description contains any of these
            keywords will be set to <strong>{category || '—'}</strong>
            {selectedLabelIds?.length ? ` + ${selectedLabelIds.length} label(s)` : ''}.
          </Typography>

          {(desc || transaction?.description) && (
            <Box sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1, mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>From this record</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                {desc || transaction?.description}
              </Typography>
            </Box>
          )}

          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={ruleKeywords}
            onChange={(e, v) => setRuleKeywords(v)}
            inputValue={ruleKwInput}
            onInputChange={(e, newInput, reason) => {
              if (reason !== 'reset') setRuleKwInput(newInput);
            }}
            onBlur={commitPendingRuleKeyword}
            renderTags={(value, getTagProps) =>
              value.map((kw, index) => (
                <Chip label={kw} color="primary" variant="outlined" {...getTagProps({ index })} key={kw} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="Keywords to match"
                placeholder={ruleKeywords.length ? 'Add another…' : 'Type a keyword and press Enter'}
                helperText="Match is case-insensitive and matches anywhere in the description. Edit the suggestion, or add more."
              />
            )}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRuleOpen(false)} disabled={ruleSaving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSaveRule}
            disabled={ruleSaving || !ruleKeywords.length}
            startIcon={ruleSaving ? <CircularProgress size={18} color="inherit" /> : <AutoAwesome />}
          >
            {ruleSaving ? 'Creating…' : 'Create rule'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
