import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
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
import { getBanks, getRewardPoints, getRewardPointsMonthly, createRewardEntry, deleteRewardEntry } from '../services/api';

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
  const [monthly, setMonthly] = useState([]);
  const [monthlyBankId, setMonthlyBankId] = useState('');
  const [historyBankId, setHistoryBankId] = useState('');
  const [historyType, setHistoryType] = useState('');
  const [historySort, setHistorySort] = useState('date_desc');
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

  const loadMonthly = async (bankId) => {
    try {
      const data = await getRewardPointsMonthly(bankId || undefined);
      setMonthly(data.months);
    } catch {
      setErr('Failed to load monthly reward points summary');
    }
  };

  useEffect(() => {
    load();
    loadMonthly('');
  }, []);

  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };

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

  const historyEntries = entries
    .filter((e) => !historyBankId || e.bank_id === historyBankId)
    .filter((e) => !historyType || e.entry_type === historyType)
    .sort((a, b) => {
      if (historySort === 'points_desc') return b.points - a.points;
      if (historySort === 'points_asc') return a.points - b.points;
      const da = new Date(a.entry_date || a.created_at);
      const db = new Date(b.entry_date || b.created_at);
      return historySort === 'date_asc' ? da - db : db - da;
    });

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Reward Points</Typography>
          <Typography variant="body1" color="text.secondary">Balances and what's about to expire, per card.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog()} disabled={banks.length === 0} sx={{ flexShrink: 0 }}>
          Add Entry
        </Button>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2, mt: 2 }} onClose={() => setErr('')}>{err}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2, mt: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

      {summaries.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 2 }}>No credit card accounts found. Add one under Banks first.</Typography>
      )}

      <Grid container spacing={2} sx={{ mb: 3, mt: 0.5 }}>
        {summaries.map((s) => (
          <Grid item xs={12} sm={6} md={4} key={s.bank_id}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4, height: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'primary.main', color: '#fff', flexShrink: 0 }}>
                    <CardGiftcardIcon sx={{ fontSize: 18 }} />
                  </Box>
                  <Typography variant="subtitle1" fontWeight={700}>{s.bank_name}</Typography>
                </Box>
                <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>{s.balance.toLocaleString()}</Typography>
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
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">Monthly Summary</Typography>
          <TextField
            select size="small" label="Card" value={monthlyBankId} sx={{ minWidth: 180 }}
            onChange={(e) => { setMonthlyBankId(e.target.value); loadMonthly(e.target.value); }}
          >
            <MenuItem value="">All cards</MenuItem>
            {banks.map((b) => (
              <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
            ))}
          </TextField>
        </Box>
        {monthly.length === 0 ? (
          <Typography color="text.secondary">No reward points activity yet.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Month</TableCell>
                <TableCell align="right">Gained</TableCell>
                <TableCell align="right">Used</TableCell>
                <TableCell align="right">Expired</TableCell>
                <TableCell align="right">Net</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {monthly.map((m) => {
                const gained = Math.round(m.gained);
                const used = Math.round(m.used);
                const expired = Math.round(m.expired);
                const net = Math.round(m.net);
                return (
                  <TableRow key={m.month}>
                    <TableCell>{monthLabel(m.month)}</TableCell>
                    <TableCell align="right" sx={{ color: 'success.main' }}>
                      {gained > 0 ? `+${gained.toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: used > 0 ? 'error.main' : 'text.secondary' }}>
                      {used > 0 ? `-${used.toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: expired > 0 ? 'error.main' : 'text.secondary' }}>
                      {expired > 0 ? `-${expired.toLocaleString()}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {net > 0 ? '+' : ''}{net.toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6">History</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField
              select size="small" label="Card" value={historyBankId} sx={{ minWidth: 160 }}
              onChange={(e) => setHistoryBankId(e.target.value)}
            >
              <MenuItem value="">All cards</MenuItem>
              {banks.map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              select size="small" label="Type" value={historyType} sx={{ minWidth: 140 }}
              onChange={(e) => setHistoryType(e.target.value)}
            >
              <MenuItem value="">All types</MenuItem>
              {ENTRY_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select size="small" label="Sort by" value={historySort} sx={{ minWidth: 170 }}
              onChange={(e) => setHistorySort(e.target.value)}
            >
              <MenuItem value="date_desc">Newest first</MenuItem>
              <MenuItem value="date_asc">Oldest first</MenuItem>
              <MenuItem value="points_desc">Points: high to low</MenuItem>
              <MenuItem value="points_asc">Points: low to high</MenuItem>
            </TextField>
          </Box>
        </Box>
        {historyEntries.length === 0 ? (
          <Typography color="text.secondary">No entries match these filters.</Typography>
        ) : (
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
            {historyEntries.map((e) => (
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
        )}
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
