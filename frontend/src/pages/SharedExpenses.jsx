import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, CircularProgress, Alert, List, ListItem, ListItemText, Divider,
} from '@mui/material';
import { Add, Groups } from '@mui/icons-material';
import {
  listSharedExpenses, createSharedExpense, settleSharedExpenseShare, deleteSharedExpense, listHouseholdMembers,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const blank = { description: '', total_amount: '', expense_date: '' };

export default function SharedExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [customSplits, setCustomSplits] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ex, m] = await Promise.all([listSharedExpenses(), listHouseholdMembers().catch(() => [])]);
      setExpenses(ex);
      setMembers(m);
    } catch {
      setError('Failed to load shared expenses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setForm(blank);
    const even = {};
    members.forEach((m) => { even[m.id] = ''; });
    setCustomSplits(even);
    setOpen(true);
  };

  const evenSplitAmount = form.total_amount && members.length ? (parseFloat(form.total_amount) / members.length).toFixed(2) : '';

  const save = async () => {
    const amt = parseFloat(form.total_amount);
    if (!form.description.trim() || !amt || !form.expense_date) return;
    setSaving(true);
    setError('');
    try {
      const splits = members.map((m) => ({
        user_id: m.id,
        amount: parseFloat(customSplits[m.id] || evenSplitAmount || 0),
      }));
      await createSharedExpense({ description: form.description.trim(), total_amount: amt, expense_date: form.expense_date, splits });
      setOpen(false);
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to save — check the splits add up to the total');
    } finally {
      setSaving(false);
    }
  };

  const settle = async (expenseId, shareId) => {
    try { await settleSharedExpenseShare(expenseId, shareId); load(); } catch { setError('Failed to settle'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this shared expense?')) return;
    try { await deleteSharedExpense(id); load(); } catch { setError('Failed to delete'); }
  };

  if (!loading && members.length < 2) {
    return (
      <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
        <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 1 }}>Shared Expenses</Typography>
        <Alert severity="info">
          You need at least one other person in your household to split expenses with. Invite someone via Settings, or use IOUs to track money with people outside the app.
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Shared Expenses</Typography>
          <Typography variant="body1" color="text.secondary">Split a household expense and track who's settled up.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ flexShrink: 0 }}>Add Expense</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : expenses.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Groups sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No shared expenses yet.</Typography>
        </Paper>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {expenses.map((e) => (
            <Paper key={e.id} variant="outlined" sx={{ p: 2.5 }}>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                <Box>
                  <Typography variant="h6" fontWeight={700}>{e.description}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatCurrency(e.total_amount)} · paid by {e.paid_by_username} · {e.expense_date}
                  </Typography>
                </Box>
                <Button size="small" color="error" onClick={() => remove(e.id)}>Delete</Button>
              </Box>
              <List dense sx={{ mt: 1 }}>
                {e.shares.map((s) => (
                  <React.Fragment key={s.id}>
                    <ListItem
                      secondaryAction={
                        s.is_settled
                          ? <Chip size="small" color="success" label="Settled" />
                          : <Button size="small" onClick={() => settle(e.id, s.id)}>Mark Settled</Button>
                      }
                    >
                      <ListItemText primary={s.username} secondary={formatCurrency(s.amount)} />
                    </ListItem>
                    <Divider component="li" />
                  </React.Fragment>
                ))}
              </List>
            </Paper>
          ))}
        </Box>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Shared Expense</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth autoFocus />
          <TextField label="Total Amount" type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} fullWidth />
          <TextField label="Date" type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <Typography variant="subtitle2">Split (defaults to even — edit any to customize)</Typography>
          {members.map((m) => (
            <TextField
              key={m.id} label={m.username} type="number" size="small"
              value={customSplits[m.id] !== '' ? customSplits[m.id] : evenSplitAmount}
              onChange={(e) => setCustomSplits({ ...customSplits, [m.id]: e.target.value })}
              fullWidth
            />
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.description.trim() || !form.total_amount || !form.expense_date}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
