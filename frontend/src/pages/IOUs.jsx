import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress, Alert, Tooltip,
  Tabs, Tab, alpha, useTheme,
} from '@mui/material';
import { Add, Edit, Delete, Handshake, Payments } from '@mui/icons-material';
import {
  listIOUs, createIOU, updateIOU, deleteIOU, recordIOUPayment,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const blank = { person_name: '', direction: 'lent', principal_amount: '', iou_date: '', due_date: '', notes: '' };
const blankPayment = { amount: '', payment_date: '', notes: '' };

export default function IOUs() {
  const theme = useTheme();
  const [data, setData] = useState({ items: [], total_owed_to_me: 0, total_i_owe: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('lent');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const [paymentIou, setPaymentIou] = useState(null);
  const [paymentForm, setPaymentForm] = useState(blankPayment);
  const [recording, setRecording] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await listIOUs()); } catch { setError('Failed to load IOUs'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const heroCard = (label, value, color) => (
    <Paper variant="outlined" sx={{
      p: 2.75, flex: '1 1 220px', minWidth: 220, borderRadius: 4,
      backgroundImage: `linear-gradient(135deg, ${alpha(color, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(color, 0)} 65%)`,
    }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>{label}</Typography>
      <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.15, mt: 0.5 }}>{formatCurrency(value)}</Typography>
    </Paper>
  );

  const openNew = () => { setEditing(null); setForm({ ...blank, direction: tab }); setOpen(true); };
  const openEdit = (i) => {
    setEditing(i);
    setForm({ person_name: i.person_name, direction: i.direction, principal_amount: i.principal_amount, iou_date: i.iou_date, due_date: i.due_date || '', notes: i.notes || '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.person_name.trim() || !form.iou_date) return;
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await updateIOU(editing.id, { person_name: form.person_name, due_date: form.due_date || null, notes: form.notes });
      } else {
        await createIOU({
          person_name: form.person_name.trim(), direction: form.direction,
          principal_amount: parseFloat(form.principal_amount), iou_date: form.iou_date,
          due_date: form.due_date || null, notes: form.notes || null,
        });
      }
      setOpen(false);
      load();
    } catch { setError('Failed to save IOU'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this IOU?')) return;
    try { await deleteIOU(id); load(); } catch { setError('Failed to delete'); }
  };

  const openPayment = (i) => { setPaymentIou(i); setPaymentForm(blankPayment); };
  const savePayment = async () => {
    if (!paymentForm.amount || !paymentForm.payment_date) return;
    setRecording(true);
    try {
      await recordIOUPayment(paymentIou.id, { amount: parseFloat(paymentForm.amount), payment_date: paymentForm.payment_date, notes: paymentForm.notes || null });
      setPaymentIou(null);
      load();
    } catch { setError('Failed to record payment'); }
    finally { setRecording(false); }
  };

  const items = data.items.filter((i) => i.direction === tab);

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>IOUs</Typography>
          <Typography variant="body1" color="text.secondary">Money lent to or borrowed from friends/family — with repayment tracking.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ flexShrink: 0 }}>Add IOU</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box display="flex" gap={2} flexWrap="wrap" mb={3} mt={2}>
        {heroCard('Owed to me', data.total_owed_to_me, theme.palette.success.main)}
        {heroCard('I owe', data.total_i_owe, theme.palette.error.main)}
      </Box>

      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab value="lent" label="Owed to me" />
        <Tab value="borrowed" label="I owe" />
      </Tabs>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Handshake sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">Nothing here yet.</Typography>
        </Paper>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {items.map((i) => (
            <Paper key={i.id} variant="outlined" sx={{ p: 2.5, opacity: i.status === 'settled' ? 0.6 : 1 }}>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                <Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="h6" fontWeight={700}>{i.person_name}</Typography>
                    <Chip size="small" label={i.status} color={i.status === 'settled' ? 'default' : 'primary'} />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    Principal {formatCurrency(i.principal_amount)} on {i.iou_date}{i.due_date ? ` · Due ${i.due_date}` : ''}
                  </Typography>
                  <Typography variant="body1" fontWeight={700} sx={{ mt: 0.5 }}>
                    Outstanding: {formatCurrency(i.outstanding_amount)}
                  </Typography>
                </Box>
                <Box display="flex" gap={0.5}>
                  {i.status === 'open' && (
                    <Tooltip title="Record payment">
                      <IconButton size="small" onClick={() => openPayment(i)}><Payments fontSize="small" /></IconButton>
                    </Tooltip>
                  )}
                  <IconButton size="small" onClick={() => openEdit(i)}><Edit fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => remove(i.id)}><Delete fontSize="small" /></IconButton>
                </Box>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit IOU' : 'Add IOU'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Person" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} fullWidth autoFocus />
          {!editing && (
            <TextField select label="Direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} fullWidth>
              <MenuItem value="lent">I lent them money</MenuItem>
              <MenuItem value="borrowed">I borrowed money from them</MenuItem>
            </TextField>
          )}
          {!editing && (
            <TextField label="Amount" type="number" value={form.principal_amount} onChange={(e) => setForm({ ...form, principal_amount: e.target.value })} fullWidth />
          )}
          {!editing && (
            <TextField label="Date" type="date" value={form.iou_date} onChange={(e) => setForm({ ...form, iou_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          )}
          <TextField label="Due Date (optional)" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Notes" multiline rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.person_name.trim() || (!editing && (!form.principal_amount || !form.iou_date))}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog open={!!paymentIou} onClose={() => setPaymentIou(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Record Payment — {paymentIou?.person_name}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2" color="text.secondary">Outstanding: {paymentIou && formatCurrency(paymentIou.outstanding_amount)}</Typography>
          <TextField label="Amount" type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} fullWidth autoFocus />
          <TextField label="Date" type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Notes" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} fullWidth />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setPaymentIou(null)}>Cancel</Button>
          <Button variant="contained" onClick={savePayment} disabled={recording || !paymentForm.amount || !paymentForm.payment_date}>
            {recording ? <CircularProgress size={20} /> : 'Record'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
