import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import {
  createSmsSample, deleteSmsSample, getBanks, listSmsSamples, previewSmsSample, updateSmsSample,
} from '../../services/api';

const EMPTY = {
  raw_text: '',
  sender: '',
  is_transaction: true,
  amount: '',
  transaction_type: 'debit',
  description: '',
  bank_id: '',
  balance_amount: '',
};

const viaLabel = {
  sample: 'Matched a saved sample',
  structure: 'Read from the wording',
  ai: 'AI read this. Saving it teaches the next SMS of the same shape.',
};

export default function SmsSamplesPanel() {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [samples, setSamples] = useState([]);
  const [banks, setBanks] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [rows, bankRows] = await Promise.all([listSmsSamples(), getBanks()]);
    setSamples(rows || []);
    setBanks(Array.isArray(bankRows) ? bankRows : (bankRows?.banks || []));
  };

  useEffect(() => {
    load().catch((err) => setError(err.response?.data?.detail || 'Could not load SMS samples.'));
  }, []);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const readIt = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await previewSmsSample({ raw_text: form.raw_text, sender: form.sender || null });
      setPreview(result);
      if (result.action === 'transaction') {
        setForm((prev) => ({
          ...prev,
          is_transaction: true,
          amount: result.amount ?? '',
          transaction_type: result.transaction_type || 'debit',
          description: result.description || '',
          bank_id: result.bank_id || prev.bank_id,
          balance_amount: result.balance ?? '',
        }));
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not read this SMS.');
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({
    raw_text: form.raw_text,
    sender: form.sender || null,
    is_transaction: form.is_transaction,
    amount: form.amount === '' ? null : Number(form.amount),
    transaction_type: form.is_transaction ? form.transaction_type : null,
    description: form.description || null,
    bank_id: form.bank_id ? Number(form.bank_id) : null,
    balance_amount: form.balance_amount === '' ? null : Number(form.balance_amount),
  });

  const save = async (isTransaction) => {
    setError('');
    setBusy(true);
    try {
      const body = { ...payload(), is_transaction: isTransaction };
      if (editingId) await updateSmsSample(editingId, body);
      else await createSmsSample(body);
      setForm(EMPTY);
      setEditingId(null);
      setPreview(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not save this sample.');
    } finally {
      setBusy(false);
    }
  };

  const loadRow = (row) => {
    setEditingId(row.id);
    setPreview(null);
    setForm({
      raw_text: row.raw_text || '',
      sender: row.sender || '',
      is_transaction: row.is_transaction !== false,
      amount: row.amount ?? '',
      transaction_type: row.transaction_type || 'debit',
      description: row.description || '',
      bank_id: row.bank_id || '',
      balance_amount: row.balance_amount ?? '',
    });
  };

  const remove = async (id) => {
    setError('');
    await deleteSmsSample(id);
    if (editingId === id) {
      setEditingId(null);
      setForm(EMPTY);
    }
    await load();
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>SMS samples</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Paste a bank SMS and mark the real amount, whether money left or arrived, and which number is only the balance.
        The next SMS with the same wording is read from that sample. If nothing matches, AI reads it once and the shape is kept.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{String(error)}</Alert>}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack spacing={2}>
          <TextField label="SMS text" value={form.raw_text} onChange={set('raw_text')} multiline minRows={4} fullWidth />
          <TextField label="Sender id (optional)" value={form.sender} onChange={set('sender')} fullWidth />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Amount" type="number" value={form.amount} onChange={set('amount')} fullWidth />
            <TextField select label="Direction" value={form.transaction_type} onChange={set('transaction_type')} fullWidth>
              <MenuItem value="debit">Debit</MenuItem>
              <MenuItem value="credit">Credit</MenuItem>
            </TextField>
            <TextField label="Balance in the SMS (ignored)" type="number" value={form.balance_amount} onChange={set('balance_amount')} fullWidth />
          </Stack>
          <TextField label="Description" value={form.description} onChange={set('description')} fullWidth />
          <TextField select label="Bank" value={form.bank_id} onChange={set('bank_id')} fullWidth>
            <MenuItem value="">Decide from the sender</MenuItem>
            {banks.map((bank) => (
              <MenuItem key={bank.id} value={bank.id}>{bank.name}</MenuItem>
            ))}
          </TextField>
          {preview && (
            <Alert severity={preview.action === 'transaction' ? 'success' : 'info'}>
              {preview.action === 'ignore' && 'This matches a sample marked as not a transaction.'}
              {preview.action === 'unmatched' && 'No sample or wording rule could read this. AI did not either.'}
              {preview.action === 'need_ai' && 'Nothing matched yet.'}
              {preview.action === 'transaction' && (
                <>
                  {viaLabel[preview.via] || preview.via}: {preview.transaction_type} {preview.amount}
                  {preview.description ? ` — ${preview.description}` : ''}
                </>
              )}
            </Alert>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" disabled={busy || !form.raw_text.trim()} onClick={readIt}>Read it</Button>
            <Button variant="contained" disabled={busy || !form.raw_text.trim()} onClick={() => save(true)}>
              {editingId ? 'Update sample' : 'Save as transaction'}
            </Button>
            <Button color="warning" disabled={busy || !form.raw_text.trim()} onClick={() => save(false)}>Not a transaction</Button>
            {editingId && (
              <Button onClick={() => { setEditingId(null); setForm(EMPTY); setPreview(null); }}>Cancel edit</Button>
            )}
          </Stack>
        </Stack>
      </Paper>
      <Stack spacing={1}>
        {samples.map((row) => (
          <Paper key={row.id} sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
              <Chip size="small" label={row.source || 'manual'} />
              <Chip
                size="small"
                color={row.is_transaction === false ? 'default' : row.transaction_type === 'credit' ? 'success' : 'primary'}
                label={row.is_transaction === false ? 'ignored' : row.is_transaction == null ? 'needs a label' : row.transaction_type}
              />
              {row.amount != null && <Typography variant="body2">{row.amount}</Typography>}
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{row.raw_text}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button size="small" onClick={() => loadRow(row)}>Edit</Button>
              <Button size="small" color="error" onClick={() => remove(row.id)}>Delete</Button>
            </Stack>
          </Paper>
        ))}
        {samples.length === 0 && (
          <Typography color="text.secondary">No samples yet. Incoming SMS that cannot be read show up here.</Typography>
        )}
      </Stack>
    </Box>
  );
}
