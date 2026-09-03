import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Table, TableHead, TableRow,
  TableCell, TableBody, TableContainer, CircularProgress, Alert, Tooltip,
} from '@mui/material';
import { Add, Edit, Delete, Autorenew, PauseCircle, PlayCircle } from '@mui/icons-material';
import {
  listAutopayMandates, createAutopayMandate, updateAutopayMandate, deleteAutopayMandate, getBanks,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const FREQUENCIES = ['weekly', 'monthly', 'yearly', 'other'];
const blank = { bank_id: '', merchant_name: '', upi_vpa: '', max_amount: '', frequency: 'monthly', next_debit_date: '', notes: '' };

const statusColor = (s) => (s === 'active' ? 'success' : s === 'paused' ? 'warning' : 'default');

export default function AutopayMandates() {
  const [mandates, setMandates] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [m, b] = await Promise.all([listAutopayMandates(), getBanks().catch(() => [])]);
      setMandates(m);
      setBanks(Array.isArray(b) ? b : []);
    } catch {
      setError('Failed to load autopay mandates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const bankName = (id) => banks.find((b) => b.id === id)?.name;

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({
      bank_id: m.bank_id || '', merchant_name: m.merchant_name, upi_vpa: m.upi_vpa || '',
      max_amount: m.max_amount ?? '', frequency: m.frequency, next_debit_date: m.next_debit_date || '', notes: m.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.merchant_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        bank_id: form.bank_id || null,
        merchant_name: form.merchant_name.trim(),
        upi_vpa: form.upi_vpa || null,
        max_amount: form.max_amount === '' ? null : parseFloat(form.max_amount),
        frequency: form.frequency,
        next_debit_date: form.next_debit_date || null,
        notes: form.notes || null,
      };
      if (editing) await updateAutopayMandate(editing.id, payload);
      else await createAutopayMandate(payload);
      setOpen(false);
      load();
    } catch {
      setError('Failed to save mandate');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this autopay mandate?')) return;
    try { await deleteAutopayMandate(id); load(); } catch { setError('Failed to delete'); }
  };

  const toggleStatus = async (m) => {
    const next = m.status === 'active' ? 'paused' : 'active';
    try { await updateAutopayMandate(m.id, { status: next }); load(); } catch { setError('Failed to update status'); }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Autopay Mandates</Typography>
          <Typography variant="body1" color="text.secondary">
            UPI/bank autopay authorizations you've registered with merchants — so a silent recurring debit never surprises you.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ flexShrink: 0 }}>Add Mandate</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined">
        {loading ? (
          <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
        ) : mandates.length === 0 ? (
          <Box p={6} textAlign="center">
            <Autorenew sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary">No autopay mandates tracked yet.</Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Merchant</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell>Max Amount</TableCell>
                  <TableCell>Frequency</TableCell>
                  <TableCell>Next Debit</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mandates.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>{m.merchant_name}</Typography>
                      {m.upi_vpa && <Typography variant="caption" color="text.secondary">{m.upi_vpa}</Typography>}
                    </TableCell>
                    <TableCell>{bankName(m.bank_id) || '—'}</TableCell>
                    <TableCell>{m.max_amount ? formatCurrency(m.max_amount) : '—'}</TableCell>
                    <TableCell sx={{ textTransform: 'capitalize' }}>{m.frequency}</TableCell>
                    <TableCell>{m.next_debit_date || '—'}</TableCell>
                    <TableCell><Chip size="small" label={m.status} color={statusColor(m.status)} /></TableCell>
                    <TableCell align="right">
                      <Tooltip title={m.status === 'active' ? 'Pause' : 'Reactivate'}>
                        <IconButton size="small" onClick={() => toggleStatus(m)}>
                          {m.status === 'active' ? <PauseCircle fontSize="small" /> : <PlayCircle fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" onClick={() => openEdit(m)}><Edit fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => remove(m.id)}><Delete fontSize="small" /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Mandate' : 'Add Autopay Mandate'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Merchant" value={form.merchant_name} onChange={(e) => setForm({ ...form, merchant_name: e.target.value })} fullWidth autoFocus />
          <TextField select label="Account" value={form.bank_id} onChange={(e) => setForm({ ...form, bank_id: e.target.value })} fullWidth>
            <MenuItem value=""><em>None</em></MenuItem>
            {banks.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </TextField>
          <TextField label="UPI VPA (optional)" value={form.upi_vpa} onChange={(e) => setForm({ ...form, upi_vpa: e.target.value })} fullWidth />
          <TextField label="Max Amount (optional)" type="number" value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} fullWidth />
          <TextField select label="Frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} fullWidth>
            {FREQUENCIES.map((f) => <MenuItem key={f} value={f} sx={{ textTransform: 'capitalize' }}>{f}</MenuItem>)}
          </TextField>
          <TextField label="Next Debit Date" type="date" value={form.next_debit_date} onChange={(e) => setForm({ ...form, next_debit_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <TextField label="Notes" multiline rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.merchant_name.trim()}>
            {saving ? <CircularProgress size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
