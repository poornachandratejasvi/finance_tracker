import React, { useState, useEffect, useMemo } from 'react';
import {
  Paper,
  Box,
  Typography,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  InputAdornment,
  Collapse,
  Tooltip,
} from '@mui/material';
import {
  Add,
  Edit,
  Delete,
  Close,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import CategoryIcon from '../CategoryIcon';
import { formatCurrency } from '../../utils/format';
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getBanks,
  getCategories,
  getCurrencies,
  getLabels,
  createLabel,
} from '../../services/api';

// Expense -> debit, Income -> credit (mirrors the Wallet record dialog).
const MODE_TO_TYPE = { expense: 'debit', income: 'credit' };
const TYPE_TO_MODE = { debit: 'expense', credit: 'income' };
const EMPTY_NEW_LABEL = { name: '', color: '#1aa565' };

const errMsg = (err, fallback) => {
  const d = err?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

export default function TemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [banks, setBanks] = useState([]);
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  // Dialog form state.
  const [name, setName] = useState('');
  const [mode, setMode] = useState('expense');
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState('INR');
  const [bankId, setBankId] = useState('');
  const [category, setCategory] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState([]);
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [showOther, setShowOther] = useState(false);

  const [createdLabels, setCreatedLabels] = useState([]);
  const [showCreateLabel, setShowCreateLabel] = useState(false);
  const [newLabel, setNewLabel] = useState(EMPTY_NEW_LABEL);
  const [creatingLabel, setCreatingLabel] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tpl, bnk, cat, cur, lbl] = await Promise.all([
        getTemplates(),
        getBanks(),
        getCategories(),
        getCurrencies(),
        getLabels(),
      ]);
      setTemplates(tpl || []);
      setBanks(bnk || []);
      setCategories(cat || []);
      setCurrencies(cur || []);
      setLabels(lbl || []);
    } catch (err) {
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const bankName = (id) => banks.find((b) => b.id === id)?.name || '';
  const bankCurrency = (id) => banks.find((b) => String(b.id) === String(id))?.currency_code;

  // Flattened category hierarchy: roots then indented children (built from parent_id).
  const categoryItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    const byOrder = (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.name || '').localeCompare(b.name || '');
    const roots = categories.filter((c) => c.parent_id == null).sort(byOrder);
    const childrenOf = (pid) => categories.filter((c) => c.parent_id === pid).sort(byOrder);
    roots.forEach((r) => {
      items.push({ cat: r, depth: 0 });
      seen.add(r.id);
      childrenOf(r.id).forEach((k) => { items.push({ cat: k, depth: 1 }); seen.add(k.id); });
    });
    categories.filter((c) => !seen.has(c.id)).sort(byOrder).forEach((c) => items.push({ cat: c, depth: 0 }));
    return items;
  }, [categories]);

  const categoryInList = categoryItems.some((i) => i.cat.name === category);

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

  const resetForm = () => {
    setName('');
    setMode('expense');
    setAmount('');
    setCurrencyCode('INR');
    setBankId('');
    setCategory('');
    setSelectedLabelIds([]);
    setDescription('');
    setNotes('');
    setShowOther(false);
    setCreatedLabels([]);
    setShowCreateLabel(false);
    setNewLabel(EMPTY_NEW_LABEL);
  };

  const openAdd = () => {
    setEditing(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (t) => {
    setEditing(t);
    resetForm();
    setName(t.name || '');
    setMode(TYPE_TO_MODE[t.transaction_type] || 'expense');
    setAmount(t.amount != null ? String(t.amount) : '');
    setCurrencyCode(t.currency_code || bankCurrency(t.bank_id) || 'INR');
    setBankId(t.bank_id ?? '');
    setCategory(t.category || '');
    setDescription(t.description || '');
    setNotes(t.notes || '');
    setSelectedLabelIds(Array.isArray(t.label_ids) ? t.label_ids : []);
    setShowOther(Boolean(t.description || t.notes));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const handleModeChange = (_e, val) => {
    if (val) setMode(val);
  };

  const handleBankChange = (e) => {
    const val = e.target.value;
    setBankId(val);
    const cur = bankCurrency(val);
    if (cur) setCurrencyCode(cur);
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

  const handleSave = async () => {
    if (!name.trim()) { setError('Please enter a name'); return; }
    if (!category) { setError('Please select a category'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        bank_id: bankId === '' ? null : bankId,
        category: category || null,
        amount: amount === '' ? null : parseFloat(amount),
        transaction_type: MODE_TO_TYPE[mode],
        description: description || null,
        notes: notes || null,
        currency_code: currencyCode || null,
        label_ids: selectedLabelIds || [],
      };
      if (editing) {
        await updateTemplate(editing.id, payload);
        setSuccess('Template updated');
      } else {
        await createTemplate(payload);
        setSuccess('Template created');
      }
      closeDialog();
      fetchData();
    } catch (err) {
      setError(errMsg(err, 'Failed to save template'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    setError('');
    try {
      await deleteTemplate(t.id);
      setSuccess('Template deleted');
      fetchData();
    } catch (err) {
      setError(errMsg(err, 'Failed to delete template'));
    }
  };

  const summaryLine = (t) => {
    const parts = [];
    if (t.transaction_type) parts.push(TYPE_TO_MODE[t.transaction_type] || t.transaction_type);
    if (t.amount != null) parts.push(formatCurrency(t.amount, { currency: t.currency_code }));
    if (t.category) parts.push(t.category);
    if (t.bank_id) parts.push(bankName(t.bank_id));
    return parts.join(' · ');
  };

  const typeColor = mode === 'income' ? 'success.main' : 'error.main';
  const previewSign = mode === 'income' ? '+' : '-';
  const previewAmount = amount && !Number.isNaN(parseFloat(amount)) ? Math.abs(parseFloat(amount)) : 0;

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Quick-Entry Templates</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd}>
          Add Template
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        Templates pre-fill common transactions so you can add them with one click.
      </Alert>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <List>
          {templates.length === 0 ? (
            <ListItem>
              <ListItemText primary="No templates yet" secondary="Create a template to speed up manual entry" />
            </ListItem>
          ) : (
            templates.map((t) => (
              <ListItem key={t.id} divider>
                <ListItemText
                  primary={
                    <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {t.name}
                      <Chip
                        label={TYPE_TO_MODE[t.transaction_type] || 'expense'}
                        size="small"
                        color={t.transaction_type === 'credit' ? 'success' : 'default'}
                        sx={{ textTransform: 'capitalize' }}
                      />
                    </Box>
                  }
                  secondary={summaryLine(t)}
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" size="small" onClick={() => openEdit(t)}>
                    <Edit fontSize="small" />
                  </IconButton>
                  <IconButton edge="end" size="small" onClick={() => handleDelete(t)}>
                    <Delete fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))
          )}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
          {editing ? 'Edit Template' : 'Add Template'}
          <IconButton onClick={closeDialog} size="small"><Close fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {/* Name */}
          <TextField
            fullWidth
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            sx={{ mb: 2, mt: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary' }}>Aa</Typography>
                </InputAdornment>
              ),
            }}
          />

          {/* Expense / Income toggle */}
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
            }}
          >
            <ToggleButton value="expense" className="mode-expense">Expense</ToggleButton>
            <ToggleButton value="income" className="mode-income">Income</ToggleButton>
          </ToggleButtonGroup>

          {/* Amount + currency */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
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
              <MenuItem value=""><em>None</em></MenuItem>
              {banks.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Category */}
          <FormControl fullWidth required sx={{ mb: 2 }}>
            <InputLabel>Category</InputLabel>
            <Select
              value={category}
              label="Category"
              onChange={(e) => setCategory(e.target.value)}
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
            </Select>
          </FormControl>

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
              <IconButton onClick={() => setShowCreateLabel((v) => !v)} sx={{ mt: 0.5 }}>
                <Typography component="span" sx={{ fontSize: '1.25rem', lineHeight: 1 }}>＋</Typography>
              </IconButton>
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

          {/* Other details (collapsible) */}
          <Button
            onClick={() => setShowOther((v) => !v)}
            endIcon={showOther ? <ExpandLess /> : <ExpandMore />}
            sx={{ textTransform: 'none', px: 0 }}
          >
            Other details
          </Button>
          <Collapse in={showOther}>
            <Box sx={{ pt: 1.5 }}>
              <TextField
                fullWidth
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                multiline
                rows={2}
              />
            </Box>
          </Collapse>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDialog} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!name.trim() || !category || saving}
          >
            {saving ? <CircularProgress size={20} /> : editing ? 'Save' : 'Add Template'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
