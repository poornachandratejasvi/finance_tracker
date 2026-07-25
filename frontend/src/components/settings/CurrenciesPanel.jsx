import React, { useState, useEffect } from 'react';
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
  Chip,
  Alert,
  CircularProgress,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import {
  getCurrencies,
  createCurrency,
  updateCurrency,
  deleteCurrency,
} from '../../services/api';

const emptyForm = {
  code: '',
  symbol: '',
  name: '',
  rate_to_base: 1,
  is_base: false,
};

export default function CurrenciesPanel() {
  const [currencies, setCurrencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getCurrencies();
      setCurrencies(data || []);
    } catch (err) {
      setError('Failed to load currencies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      code: c.code || '',
      symbol: c.symbol || '',
      name: c.name || '',
      rate_to_base: c.rate_to_base ?? 1,
      is_base: !!c.is_base,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        symbol: form.symbol,
        name: form.name,
        rate_to_base: form.is_base ? 1 : (parseFloat(form.rate_to_base) || 1),
        is_base: form.is_base,
      };
      if (editing) {
        await updateCurrency(editing.id, payload);
        setSuccess('Currency updated');
      } else {
        await createCurrency(payload);
        setSuccess('Currency created');
      }
      closeDialog();
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to save currency');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c) => {
    if (c.is_base) {
      setError('The base currency cannot be deleted. Set another currency as base first.');
      return;
    }
    if (!window.confirm(`Delete currency "${c.code}"?`)) return;
    setError('');
    try {
      await deleteCurrency(c.id);
      setSuccess('Currency deleted');
      fetchData();
    } catch (err) {
      if (err?.response?.status === 400) {
        setError('This currency cannot be deleted (it is the base currency).');
      } else {
        const detail = err?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : 'Failed to delete currency');
      }
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Currencies</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd}>
          Add Currency
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        Setting a currency as base sets its rate to 1 and unsets the previous base currency.
        The base currency cannot be deleted.
      </Alert>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <List>
          {currencies.length === 0 ? (
            <ListItem>
              <ListItemText primary="No currencies yet" secondary="Add a currency to get started" />
            </ListItem>
          ) : (
            currencies.map((c) => (
              <ListItem key={c.id} divider>
                <ListItemText
                  primary={
                    <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <strong>{c.code}</strong>
                      {c.symbol ? <span>({c.symbol})</span> : null}
                      {c.is_base && <Chip label="BASE" size="small" color="primary" />}
                    </Box>
                  }
                  secondary={`${c.name || 'Unnamed'} · Rate to base: ${c.rate_to_base ?? 1}`}
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" size="small" onClick={() => openEdit(c)}>
                    <Edit fontSize="small" />
                  </IconButton>
                  <IconButton edge="end" size="small" onClick={() => handleDelete(c)} disabled={c.is_base}>
                    <Delete fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))
          )}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Currency' : 'Add Currency'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Code (e.g. USD)"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              sx={{ mb: 2 }}
              required
              inputProps={{ maxLength: 8, style: { textTransform: 'uppercase' } }}
            />
            <TextField
              fullWidth
              label="Symbol"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Rate to base currency (1 unit = X base)"
              type="number"
              value={form.rate_to_base}
              onChange={(e) => setForm({ ...form, rate_to_base: e.target.value })}
              sx={{ mb: 1 }}
              disabled={form.is_base}
              helperText={form.is_base ? 'Base currency rate is always 1' : undefined}
              inputProps={{ step: 'any' }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.is_base}
                  onChange={(e) => setForm({
                    ...form,
                    is_base: e.target.checked,
                    rate_to_base: e.target.checked ? 1 : form.rate_to_base,
                  })}
                />
              }
              label="Set as base currency"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.code.trim() || saving}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
