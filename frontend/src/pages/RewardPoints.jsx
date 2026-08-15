import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import { getBanks, getRewardPoints, createRewardEntry, deleteRewardEntry } from '../services/api';

const ENTRY_TYPES = [
  { value: 'earned', label: 'Earned' },
  { value: 'redeemed', label: 'Redeemed' },
  { value: 'expired', label: 'Expired' },
  { value: 'adjustment', label: 'Adjustment' },
];

const emptyForm = { bank_id: '', entry_type: 'earned', points: '', expiry_date: '', description: '' };

export default function RewardPoints() {
  const [banks, setBanks] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [entries, setEntries] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const [bankList, data] = await Promise.all([getBanks(), getRewardPoints()]);
      setBanks(bankList.filter((b) => b.bank_type === 'credit'));
      setSummaries(data.summaries);
      setEntries(data.entries);
    } catch {
      setErr('Failed to load reward points');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openDialog = (bankId) => {
    setForm({ ...emptyForm, bank_id: bankId || banks[0]?.id || '' });
    setDialogOpen(true);
  };

  const onSave = async () => {
    setErr('');
    try {
      await createRewardEntry({
        bank_id: form.bank_id,
        entry_type: form.entry_type,
        points: parseFloat(form.points),
        expiry_date: form.entry_type === 'earned' && form.expiry_date ? form.expiry_date : null,
        description: form.description || null,
      });
      setDialogOpen(false);
      setMsg('Entry saved.');
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to save entry');
    }
  };

  const onDelete = async (id) => {
    try {
      await deleteRewardEntry(id);
      await load();
    } catch {
      setErr('Failed to delete entry');
    }
  };

  const bankName = (id) => banks.find((b) => b.id === id)?.name || summaries.find((s) => s.bank_id === id)?.bank_name || id;

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Reward Points</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog()} disabled={banks.length === 0}>
          Add Entry
        </Button>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

      {summaries.length === 0 && (
        <Typography color="text.secondary">No credit card accounts found. Add one under Banks first.</Typography>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {summaries.map((s) => (
          <Grid item xs={12} sm={6} md={4} key={s.bank_id}>
            <Card variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <CardGiftcardIcon color="primary" fontSize="small" />
                  <Typography variant="subtitle1" fontWeight={700}>{s.bank_name}</Typography>
                </Box>
                <Typography variant="h4">{s.balance.toLocaleString()}</Typography>
                <Typography variant="caption" color="text.secondary">points</Typography>
                {s.expiring.length > 0 ? (
                  <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {s.expiring.map((e, i) => (
                      <Chip
                        key={i}
                        size="small"
                        color={new Date(e.expiry_date) - new Date() < 7 * 86400000 ? 'error' : 'warning'}
                        label={`${e.points.toLocaleString()} pts by ${new Date(e.expiry_date).toLocaleDateString()}`}
                      />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                    Nothing expiring soon
                  </Typography>
                )}
                <Button size="small" sx={{ mt: 1.5 }} onClick={() => openDialog(s.bank_id)}>
                  + Add entry
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>History</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Card</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Points</TableCell>
              <TableCell>Expiry</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Source</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{bankName(e.bank_id)}</TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>{e.entry_type}</TableCell>
                <TableCell align="right" sx={{ color: e.points < 0 ? 'error.main' : 'success.main' }}>
                  {e.points > 0 ? '+' : ''}{e.points.toLocaleString()}
                </TableCell>
                <TableCell>{e.expiry_date ? new Date(e.expiry_date).toLocaleDateString() : '—'}</TableCell>
                <TableCell>{e.description || '—'}</TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>{e.source}</TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => onDelete(e.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Reward Points Entry</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select label="Account" value={form.bank_id}
            onChange={(e) => setForm({ ...form, bank_id: e.target.value })}
          >
            {banks.map((b) => (
              <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
            ))}
          </TextField>
          <TextField
            select label="Type" value={form.entry_type}
            onChange={(e) => setForm({ ...form, entry_type: e.target.value })}
          >
            {ENTRY_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Points" type="number" value={form.points}
            onChange={(e) => setForm({ ...form, points: e.target.value })}
          />
          {form.entry_type === 'earned' && (
            <TextField
              label="Expiry date" type="date" InputLabelProps={{ shrink: true }}
              value={form.expiry_date}
              onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
            />
          )}
          <TextField
            label="Description (optional)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onSave} disabled={!form.bank_id || !form.points}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
