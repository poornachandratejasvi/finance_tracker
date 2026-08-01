import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Alert, Chip, Stack, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogActions, Switch, FormControlLabel,
  CircularProgress, Tooltip, Autocomplete, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import { Add, Delete, Edit, PlayArrow, TaskAlt } from '@mui/icons-material';
import {
  getWatchers, createWatcher, updateWatcher, deleteWatcher, runWatchersNow,
} from '../../services/api';

const apiError = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return fallback;
};

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const statusChip = (w) => {
  if (!w.current_period) return <Chip size="small" label="Not started yet" />;
  if (w.current_task_id) return <Chip size="small" color="warning" label={`Open — ${w.current_period}`} />;
  return <Chip size="small" color="success" icon={<TaskAlt fontSize="small" />} label={`Cleared — ${w.current_period}`} />;
};

export default function WatchersPanel() {
  const [watchers, setWatchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [running, setRunning] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = create
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [kwInputValue, setKwInputValue] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setWatchers(await getWatchers());
    } catch (e) {
      setError(apiError(e, 'Failed to load watchers'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setKeywordList = (list) => {
    const seen = new Set();
    const cleaned = [];
    (list || []).forEach((raw) => {
      const kw = String(raw).trim();
      if (!kw) return;
      const low = kw.toLowerCase();
      if (seen.has(low)) return;
      seen.add(low);
      cleaned.push(kw);
    });
    setKeywords(cleaned);
  };

  const commitPendingKeyword = () => {
    const pending = kwInputValue.trim();
    if (!pending) return keywords;
    const already = keywords.some((k) => k.toLowerCase() === pending.toLowerCase());
    const next = already ? keywords : [...keywords, pending];
    setKeywords(next);
    setKwInputValue('');
    return next;
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setKeywords([]);
    setKwInputValue('');
    setAmount('');
    setFrequency('monthly');
    setActive(true);
    setDialogOpen(true);
  };

  const openEdit = (w) => {
    setEditing(w);
    setName(w.name);
    setKeywords(Array.isArray(w.match_keywords) ? [...w.match_keywords] : []);
    setKwInputValue('');
    setAmount(w.match_amount != null ? String(w.match_amount) : '');
    setFrequency(w.frequency || 'monthly');
    setActive(w.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const match_keywords = commitPendingKeyword();
    if (!name.trim() || !match_keywords.length) return;
    setSaving(true);
    setError('');
    const match_amount = amount.trim() === '' ? null : parseFloat(amount);
    try {
      if (editing) {
        await updateWatcher(editing.id, { name, match_keywords, match_amount, frequency, is_active: active });
      } else {
        await createWatcher({ name, match_keywords, match_amount, frequency, is_active: active });
      }
      setDialogOpen(false);
      setSuccess(editing ? 'Watcher updated' : 'Watcher created');
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to save watcher'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (w) => {
    if (!window.confirm(`Delete watcher "${w.name}"?`)) return;
    try {
      await deleteWatcher(w.id);
      setSuccess('Watcher deleted');
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to delete watcher'));
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    setError('');
    try {
      const { created } = await runWatchersNow();
      setSuccess(`Created ${created} Google Task(s) for the current period`);
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to create tasks — is Google Drive/Tasks connected? (Settings → Backup)'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Each watcher gets a fresh Google Task every period (daily/weekly/monthly/yearly, in
        your "Finance Tracker Alerts" list) and it auto-completes the moment a transaction
        whose description matches any of its keywords shows up — pending or confirmed both count.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>Add Watcher</Button>
        <Button
          variant="outlined" startIcon={running ? <CircularProgress size={16} /> : <PlayArrow />}
          disabled={running} onClick={handleRunNow}
        >
          Create Current Period's Tasks Now
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Match keywords</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Frequency</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Active</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : watchers.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">
                <Typography variant="body2" color="text.secondary">No watchers yet — add one above.</Typography>
              </TableCell></TableRow>
            ) : (
              watchers.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>{w.name}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {(w.match_keywords || []).map((kw) => (
                        <Chip key={kw} size="small" variant="outlined" label={kw} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>{w.match_amount != null ? `₹${w.match_amount}` : <Typography variant="body2" color="text.secondary">Any</Typography>}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{w.frequency || 'monthly'}</TableCell>
                  <TableCell>{statusChip(w)}</TableCell>
                  <TableCell>{w.is_active ? 'Yes' : 'No'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(w)}><Edit fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => handleDelete(w)}><Delete fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Watcher' : 'Add Watcher'}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth autoFocus margin="normal" label="Name"
            placeholder="e.g. Sreenivasa Gowda"
            value={name} onChange={(e) => setName(e.target.value)}
          />
          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={keywords}
            onChange={(e, newValue) => { setKeywordList(newValue); setKwInputValue(''); }}
            inputValue={kwInputValue}
            onInputChange={(e, newInput, reason) => {
              if (reason !== 'reset') setKwInputValue(newInput);
            }}
            onBlur={commitPendingKeyword}
            renderTags={(value, getTagProps) =>
              value.map((kw, index) => (
                <Chip label={kw} color="primary" variant="outlined" {...getTagProps({ index })} key={kw} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                margin="normal"
                label="Match keywords"
                placeholder={keywords.length ? 'Add another…' : 'e.g. nthlytrans, MonthlyTrans'}
                helperText="Type a keyword and press Enter — matches (case-insensitive substring) if a new transaction description contains any of them."
              />
            )}
            sx={{ mt: 1, mb: keywords.length ? 1 : 2 }}
          />
          <TextField
            fullWidth margin="normal" label="Amount (optional)" type="number"
            placeholder="e.g. 15000"
            helperText="Leave blank to match on keyword alone. Set this when the description alone isn't distinctive (e.g. a generic 'MonthlyTrans' transfer)."
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Frequency</InputLabel>
            <Select value={frequency} label="Frequency" onChange={(e) => setFrequency(e.target.value)}>
              {FREQUENCIES.map((f) => (
                <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
            label="Active"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saving || !name.trim() || (!keywords.length && !kwInputValue.trim())}
            onClick={handleSave}
          >
            {saving ? <CircularProgress size={18} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
