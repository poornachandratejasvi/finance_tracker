import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress, Alert, Tooltip,
  alpha, useTheme, List, ListItemButton, ListItemText,
} from '@mui/material';
import { Add, Edit, Delete, EventRepeat, Link as LinkIcon, CheckCircle } from '@mui/icons-material';
import {
  listPlannedItems, createPlannedItem, updatePlannedItem, deletePlannedItem,
  getPlannedItemCandidates, confirmPlannedItemMatch, closePlannedItemOccurrence,
  getPlannedItemsSummary,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const blank = { name: '', direction: 'expense', amount: '', due_date: '', recurrence: 'monthly', match_hint: '', notes: '' };

const STATUS_META = {
  open: { label: 'Open', color: 'warning' },
  matched: { label: 'Matched', color: 'success' },
  closed: { label: 'Closed', color: 'default' },
};

export default function PlannedExpenses() {
  const theme = useTheme();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ planned_income: 0, planned_expense: 0, open_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const [matchItem, setMatchItem] = useState(null); // the PlannedItem whose current_occurrence is being mapped
  const [candidates, setCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rows, s] = await Promise.all([listPlannedItems(), getPlannedItemsSummary()]);
      setItems(rows);
      setSummary(s);
    } catch { setError('Failed to load planned expenses'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const heroCard = (label, value, color) => (
    <Paper variant="outlined" sx={{
      p: 2.75, flex: '1 1 220px', minWidth: 220, borderRadius: 4,
      backgroundImage: `linear-gradient(135deg, ${alpha(color, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(color, 0)} 65%)`,
    }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>{label}</Typography>
      <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.15, mt: 0.5 }}>{value}</Typography>
    </Paper>
  );

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name, direction: item.direction, amount: item.amount ?? '',
      due_date: (item.due_date || '').slice(0, 10), recurrence: item.recurrence,
      match_hint: item.match_hint || '', notes: item.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.due_date) return;
    setSaving(true);
    setError('');
    const payload = {
      name: form.name.trim(),
      direction: form.direction,
      amount: form.amount === '' ? null : parseFloat(form.amount),
      due_date: form.due_date,
      recurrence: form.recurrence,
      match_hint: form.match_hint.trim() || null,
      notes: form.notes || null,
    };
    try {
      if (editing) await updatePlannedItem(editing.id, payload);
      else await createPlannedItem(payload);
      setOpen(false);
      load();
    } catch { setError('Failed to save planned item'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this planned item? Its history will be removed too.')) return;
    try { await deletePlannedItem(id); load(); } catch { setError('Failed to delete'); }
  };

  const openMatchDialog = async (item) => {
    setMatchItem(item);
    setLoadingCandidates(true);
    try { setCandidates(await getPlannedItemCandidates(item.current_occurrence.id)); }
    catch { setError('Failed to load possible matches'); }
    finally { setLoadingCandidates(false); }
  };

  const pickCandidate = async (transactionId) => {
    try {
      await confirmPlannedItemMatch(matchItem.current_occurrence.id, transactionId);
      setMatchItem(null); setMsg('Mapped to transaction.'); load();
    } catch { setError('Failed to confirm match'); }
  };

  const closeNoMatch = async (item) => {
    try {
      await closePlannedItemOccurrence(item.current_occurrence.id);
      setMsg('Closed for this cycle.'); load();
    } catch { setError('Failed to close'); }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Planned Expenses</Typography>
          <Typography variant="body1" color="text.secondary">
            Recurring payments and income you expect — mapped or closed once the real transaction shows up.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ flexShrink: 0 }}>Add Planned Item</Button>
      </Box>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box display="flex" gap={2} flexWrap="wrap" mb={3} mt={2}>
        {heroCard('Planned Income (this month)', formatCurrency(summary.planned_income), theme.palette.success.main)}
        {heroCard('Planned Expenses (this month)', formatCurrency(summary.planned_expense), theme.palette.error.main)}
        {heroCard('Open / Unmatched', summary.open_count, theme.palette.warning.main)}
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <EventRepeat sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">Nothing planned yet — add your rent, EMIs, subscriptions, or expected salary.</Typography>
        </Paper>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {items.map((item) => {
            const occ = item.current_occurrence;
            const status = occ ? STATUS_META[occ.status] || STATUS_META.open : null;
            return (
              <Paper key={item.id} variant="outlined" sx={{ p: 2.5 }}>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                  <Box>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                      <Typography variant="h6" fontWeight={700}>{item.name}</Typography>
                      <Chip
                        size="small"
                        label={item.direction === 'income' ? 'Income' : 'Expense'}
                        color={item.direction === 'income' ? 'success' : 'error'}
                        variant="outlined"
                      />
                      {status && <Chip size="small" label={status.label} color={status.color} />}
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {item.amount != null ? formatCurrency(item.amount) : 'No fixed amount'} · {item.recurrence}
                      {occ ? ` · Due ${new Date(occ.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
                    </Typography>
                    {occ && occ.expected_amount != null && occ.expected_amount !== item.amount && (
                      <Typography variant="caption" color="text.secondary">This cycle: {formatCurrency(occ.expected_amount)}</Typography>
                    )}
                  </Box>
                  <Box display="flex" gap={0.5}>
                    {occ && occ.status === 'open' && (
                      <>
                        <Tooltip title="Map to a transaction">
                          <IconButton size="small" onClick={() => openMatchDialog(item)}><LinkIcon fontSize="small" /></IconButton>
                        </Tooltip>
                        <Tooltip title="Close without a transaction">
                          <IconButton size="small" onClick={() => closeNoMatch(item)}><CheckCircle fontSize="small" /></IconButton>
                        </Tooltip>
                      </>
                    )}
                    <IconButton size="small" onClick={() => openEdit(item)}><Edit fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(item.id)}><Delete fontSize="small" /></IconButton>
                  </Box>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Planned Item' : 'Add Planned Item'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth autoFocus />
          <TextField select label="Direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} fullWidth>
            <MenuItem value="expense">Expense (money out)</MenuItem>
            <MenuItem value="income">Income (money in)</MenuItem>
          </TextField>
          <TextField label="Amount (optional)" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} fullWidth />
          <TextField label="Due Date" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField select label="Repeats" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })} fullWidth>
            <MenuItem value="none">Doesn't repeat</MenuItem>
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="yearly">Yearly</MenuItem>
          </TextField>
          <TextField
            label="Match hint (optional)" value={form.match_hint}
            onChange={(e) => setForm({ ...form, match_hint: e.target.value })} fullWidth
            helperText="A word that should appear in the transaction description, e.g. 'Landlord' or 'Netflix' — helps auto-matching pick the right one when amounts are similar."
          />
          <TextField label="Notes" multiline rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.name.trim() || !form.due_date}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Map-to-transaction dialog */}
      <Dialog open={Boolean(matchItem)} onClose={() => setMatchItem(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Which transaction settles "{matchItem?.name}"?</DialogTitle>
        <DialogContent>
          {loadingCandidates ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : candidates.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No matching transaction found automatically near the due date. You can close this cycle without one instead.
            </Typography>
          ) : (
            <List dense>
              {candidates.map((c) => (
                <ListItemButton key={c.id} onClick={() => pickCandidate(c.id)} sx={{ borderRadius: 1, mb: 0.5 }}>
                  <ListItemText
                    primary={`${c.description} — ${formatCurrency(c.amount)}`}
                    secondary={new Date(c.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setMatchItem(null)}>Cancel</Button>
          <Button color="inherit" onClick={() => { closeNoMatch(matchItem); setMatchItem(null); }}>Close without matching</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
