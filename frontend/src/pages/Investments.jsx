import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
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
  Collapse,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import SavingsIcon from '@mui/icons-material/Savings';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WorkIcon from '@mui/icons-material/Work';
import DescriptionIcon from '@mui/icons-material/Description';
import DiamondIcon from '@mui/icons-material/Diamond';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import ElderlyIcon from '@mui/icons-material/Elderly';
import {
  getInvestmentsDashboard, createInvestmentAccount, deleteInvestmentAccount,
  getInvestmentEntries, createInvestmentEntry, deleteInvestmentEntry,
} from '../services/api';

const CATEGORY_META = {
  ppf: { label: 'PPF', icon: <SavingsIcon /> },
  mutual_fund: { label: 'Mutual Funds', icon: <TrendingUpIcon /> },
  stocks: { label: 'Stocks', icon: <ShowChartIcon /> },
  nps: { label: 'NPS', icon: <ElderlyIcon /> },
  epf: { label: 'EPF', icon: <WorkIcon /> },
  bonds: { label: 'Bonds', icon: <DescriptionIcon /> },
  gold: { label: 'Gold', icon: <DiamondIcon /> },
  vehicle: { label: 'Vehicle', icon: <DirectionsCarIcon /> },
};

const ENTRY_TYPES = [
  { value: 'buy', label: 'Buy', unitBased: true },
  { value: 'sell', label: 'Sell', unitBased: true },
  { value: 'contribution', label: 'Contribution' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'value_update', label: 'Update current value' },
];

const emptyAccountForm = { name: '', category: 'mutual_fund' };
const emptyEntryForm = { entry_type: 'buy', amount: '', quantity: '', price_per_unit: '', description: '' };

export default function Investments() {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [entriesByAccount, setEntriesByAccount] = useState({});
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [entryDialogAccount, setEntryDialogAccount] = useState(null);
  const [entryForm, setEntryForm] = useState(emptyEntryForm);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      setData(await getInvestmentsDashboard());
    } catch {
      setErr('Failed to load investments');
    }
  };

  useEffect(() => { load(); }, []);

  const toggleExpand = async (accountId) => {
    const isOpen = !!expanded[accountId];
    setExpanded({ ...expanded, [accountId]: !isOpen });
    if (!isOpen && !entriesByAccount[accountId]) {
      try {
        const res = await getInvestmentEntries(accountId);
        setEntriesByAccount((prev) => ({ ...prev, [accountId]: res.entries }));
      } catch {
        setErr('Failed to load entries');
      }
    }
  };

  const openAccountDialog = (category) => {
    setAccountForm({ ...emptyAccountForm, category: category || 'mutual_fund' });
    setAccountDialogOpen(true);
  };

  const onSaveAccount = async () => {
    setErr('');
    try {
      await createInvestmentAccount(accountForm);
      setAccountDialogOpen(false);
      setMsg('Account added.');
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to add account');
    }
  };

  const onDeleteAccount = async (id) => {
    if (!window.confirm('Delete this investment account and all its entries?')) return;
    try {
      await deleteInvestmentAccount(id);
      await load();
    } catch {
      setErr('Failed to delete account');
    }
  };

  const openEntryDialog = (account) => {
    setEntryForm(emptyEntryForm);
    setEntryDialogAccount(account);
  };

  const onSaveEntry = async () => {
    setErr('');
    try {
      await createInvestmentEntry(entryDialogAccount.id, {
        entry_type: entryForm.entry_type,
        amount: parseFloat(entryForm.amount),
        quantity: entryForm.quantity ? parseFloat(entryForm.quantity) : null,
        price_per_unit: entryForm.price_per_unit ? parseFloat(entryForm.price_per_unit) : null,
        description: entryForm.description || null,
      });
      const accId = entryDialogAccount.id;
      setEntryDialogAccount(null);
      setMsg('Entry saved.');
      await load();
      const res = await getInvestmentEntries(accId);
      setEntriesByAccount((prev) => ({ ...prev, [accId]: res.entries }));
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to save entry');
    }
  };

  const onDeleteEntry = async (accountId, entryId) => {
    try {
      await deleteInvestmentEntry(entryId);
      await load();
      const res = await getInvestmentEntries(accountId);
      setEntriesByAccount((prev) => ({ ...prev, [accountId]: res.entries }));
    } catch {
      setErr('Failed to delete entry');
    }
  };

  const entryTypeMeta = ENTRY_TYPES.find((t) => t.value === entryForm.entry_type) || {};

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Investments</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openAccountDialog()}>
          Add Account
        </Button>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

      {data && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">Total Investments Value</Typography>
            <Typography variant="h4">{data.total_value.toLocaleString()}</Typography>
            <Typography variant="caption" color="text.secondary">
              Tracked separately from your bank accounts and net worth.
            </Typography>
          </CardContent>
        </Card>
      )}

      {data && data.categories.length === 0 && (
        <Typography color="text.secondary">
          No investment accounts yet. Add one (PPF is auto-detected from linked bank statements when available).
        </Typography>
      )}

      {data && data.categories.map((cat) => {
        const meta = CATEGORY_META[cat.category] || { label: cat.category, icon: <SavingsIcon /> };
        return (
          <Paper key={cat.category} sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {meta.icon}
              <Typography variant="h6">{meta.label}</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="h6">{cat.total_value.toLocaleString()}</Typography>
              <Button size="small" onClick={() => openAccountDialog(cat.category)}>+ Add</Button>
            </Box>
            {cat.accounts.map((acc) => (
              <Box key={acc.id} sx={{ pl: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                  <IconButton size="small" onClick={() => toggleExpand(acc.id)}>
                    {expanded[acc.id] ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                  <Typography sx={{ flexGrow: 1 }}>
                    {acc.name} {acc.source === 'auto' && <Typography component="span" variant="caption" color="text.secondary">(auto-detected)</Typography>}
                  </Typography>
                  <Typography>{acc.current_value.toLocaleString()}</Typography>
                  <Button size="small" onClick={() => openEntryDialog(acc)}>+ Entry</Button>
                  <IconButton size="small" onClick={() => onDeleteAccount(acc.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Collapse in={!!expanded[acc.id]}>
                  <Box sx={{ pl: 4, pb: 1 }}>
                    {(entriesByAccount[acc.id] || []).length === 0 ? (
                      <Typography variant="body2" color="text.secondary">No entries yet.</Typography>
                    ) : (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Type</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="right">Qty</TableCell>
                            <TableCell align="right">Price/Unit</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(entriesByAccount[acc.id] || []).map((e) => (
                            <TableRow key={e.id}>
                              <TableCell sx={{ textTransform: 'capitalize' }}>{e.entry_type.replace('_', ' ')}</TableCell>
                              <TableCell align="right" sx={{ color: e.amount < 0 ? 'error.main' : 'success.main' }}>
                                {e.amount > 0 ? '+' : ''}{e.amount.toLocaleString()}
                              </TableCell>
                              <TableCell align="right">{e.quantity ?? '—'}</TableCell>
                              <TableCell align="right">{e.price_per_unit ?? '—'}</TableCell>
                              <TableCell>{e.description || '—'}</TableCell>
                              <TableCell>
                                <IconButton size="small" onClick={() => onDeleteEntry(acc.id, e.id)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Box>
                </Collapse>
              </Box>
            ))}
          </Paper>
        );
      })}

      <Dialog open={accountDialogOpen} onClose={() => setAccountDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Investment Account</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Name" value={accountForm.name}
            placeholder="e.g. Groww - Axis Bluechip Fund"
            onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
          />
          <TextField
            select label="Category" value={accountForm.category}
            onChange={(e) => setAccountForm({ ...accountForm, category: e.target.value })}
          >
            {Object.entries(CATEGORY_META).map(([value, m]) => (
              <MenuItem key={value} value={value}>{m.label}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccountDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onSaveAccount} disabled={!accountForm.name}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!entryDialogAccount} onClose={() => setEntryDialogAccount(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Entry — {entryDialogAccount?.name}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select label="Type" value={entryForm.entry_type}
            onChange={(e) => setEntryForm({ ...entryForm, entry_type: e.target.value })}
          >
            {ENTRY_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label={entryForm.entry_type === 'value_update' ? 'New current value' : 'Amount'}
            type="number" value={entryForm.amount}
            onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })}
          />
          {entryTypeMeta.unitBased && (
            <>
              <TextField
                label="Quantity (units)" type="number" value={entryForm.quantity}
                onChange={(e) => setEntryForm({ ...entryForm, quantity: e.target.value })}
              />
              <TextField
                label="Price per unit" type="number" value={entryForm.price_per_unit}
                onChange={(e) => setEntryForm({ ...entryForm, price_per_unit: e.target.value })}
              />
            </>
          )}
          <TextField
            label="Description (optional)" value={entryForm.description}
            onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEntryDialogAccount(null)}>Cancel</Button>
          <Button variant="contained" onClick={onSaveEntry} disabled={!entryForm.amount}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
