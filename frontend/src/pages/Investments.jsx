import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
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
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip } from 'recharts';
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
import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import CollectionsIcon from '@mui/icons-material/Collections';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  getInvestmentsDashboard, createInvestmentAccount, updateInvestmentAccount, deleteInvestmentAccount,
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
  crypto: { label: 'Crypto', icon: <CurrencyBitcoinIcon /> },
  collectible: { label: 'Collectibles', icon: <CollectionsIcon /> },
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
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const CAT_COLORS = ['#1aa565', '#3f78de', '#e08a2a', '#d666c4', '#2ab6c9', '#c94f4f', '#7c5cd6', '#9aa32a', '#e05a8a', '#5a9ae0'];

export default function Investments() {
  const theme = useTheme();
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [entriesByAccount, setEntriesByAccount] = useState({});
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [entryDialogAccount, setEntryDialogAccount] = useState(null);
  const [entryForm, setEntryForm] = useState(emptyEntryForm);
  const [refreshDialogAccount, setRefreshDialogAccount] = useState(null);
  const [refreshForm, setRefreshForm] = useState({ external_ref: '', units_held: '', tax_section: '' });
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

  const openRefreshDialog = (acc) => {
    setRefreshForm({ external_ref: acc.external_ref || '', units_held: acc.units_held ?? '', tax_section: acc.tax_section || '' });
    setRefreshDialogAccount(acc);
  };

  const onSaveRefresh = async () => {
    setErr('');
    try {
      await updateInvestmentAccount(refreshDialogAccount.id, {
        external_ref: refreshForm.external_ref || null,
        units_held: refreshForm.units_held === '' ? null : parseFloat(refreshForm.units_held),
        tax_section: refreshForm.tax_section || '',
      });
      setRefreshDialogAccount(null);
      setMsg('Account settings saved.');
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Failed to save account settings');
    }
  };

  const entryTypeMeta = ENTRY_TYPES.find((t) => t.value === entryForm.entry_type) || {};

  const maxCatValue = data?.categories?.length ? Math.max(...data.categories.map((c) => c.total_value || 0)) : 0;
  const donutData = (data?.categories || [])
    .map((cat, idx) => ({
      name: (CATEGORY_META[cat.category] || { label: cat.category }).label,
      value: cat.total_value || 0,
      color: CAT_COLORS[idx % CAT_COLORS.length],
    }))
    .filter((d) => d.value > 0);

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Investments</Typography>
          <Typography variant="body1" color="text.secondary">Every fund, stock, and asset in one place.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openAccountDialog()} sx={{ flexShrink: 0 }}>
          Add Account
        </Button>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2, mt: 2 }} onClose={() => setErr('')}>{err}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2, mt: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

      {data && (
        <Paper variant="outlined" sx={{
          p: 2.75, mb: 3, mt: 2, borderRadius: 4, maxWidth: 320,
          backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(theme.palette.primary.main, 0)} 65%)`,
        }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>Total Investments Value</Typography>
          <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.5 }}>{inr(data.total_value)}</Typography>
          <Typography variant="caption" color="text.secondary">Tracked separately from your bank accounts and net worth.</Typography>
        </Paper>
      )}

      {data && donutData.length > 0 && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, borderRadius: 4 }}>
          <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>Asset Allocation</Typography>
          <Box display="flex" flexWrap="wrap" alignItems="center" gap={4}>
            <Box sx={{ width: 200, height: 200, position: 'relative', flexShrink: 0, mx: 'auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={2} startAngle={90} endAngle={-270} isAnimationActive stroke="none">
                    {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <ReTooltip formatter={(v) => inr(v)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <Box sx={{ flex: '1 1 240px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {donutData.map((d, i) => {
                const pct = data.total_value > 0 ? (d.value / data.total_value) * 100 : 0;
                return (
                  <Box key={i} display="flex" alignItems="center" gap={1.5}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ flex: 1 }} noWrap>{d.name}</Typography>
                    <Typography variant="body2" fontWeight={700} sx={{ minWidth: 42, textAlign: 'right' }}>{pct.toFixed(0)}%</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 90, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(d.value)}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Paper>
      )}

      {data && data.categories.length === 0 && (
        <Typography color="text.secondary">
          No investment accounts yet. Add one (PPF is auto-detected from linked bank statements when available).
        </Typography>
      )}

      {data && data.categories.map((cat, catIdx) => {
        const meta = CATEGORY_META[cat.category] || { label: cat.category, icon: <SavingsIcon /> };
        const barColor = CAT_COLORS[catIdx % CAT_COLORS.length];
        const barPct = maxCatValue > 0 ? Math.min(100, (cat.total_value / maxCatValue) * 100) : 0;
        return (
          <Paper variant="outlined" key={cat.category} sx={{ p: 2.5, mb: 2, borderRadius: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              {meta.icon}
              <Typography variant="h6" fontWeight={800}>{meta.label}</Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Typography variant="h6" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>{inr(cat.total_value)}</Typography>
              <Button size="small" onClick={() => openAccountDialog(cat.category)}>+ Add</Button>
            </Box>
            <Box sx={{ mb: 1.5, height: 4, borderRadius: 2, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${barPct}%`, borderRadius: 2, bgcolor: barColor }} />
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
                  <Typography fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{inr(acc.current_value)}</Typography>
                  <Button size="small" onClick={() => openEntryDialog(acc)}>+ Entry</Button>
                  <IconButton size="small" title="Auto-refresh & tax settings" onClick={() => openRefreshDialog(acc)}>
                    <SettingsIcon fontSize="small" />
                  </IconButton>
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

      <Dialog open={!!refreshDialogAccount} onClose={() => setRefreshDialogAccount(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Auto-refresh & Tax — {refreshDialogAccount?.name}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Set both fields below to auto-refresh this account's value daily from a public NAV/price feed.
            Leave blank to keep updating the value manually as today.
          </Typography>
          <TextField
            label="External Ref (MF scheme code or stock ticker)" value={refreshForm.external_ref}
            placeholder="e.g. 119598 or RELIANCE.NS"
            onChange={(e) => setRefreshForm({ ...refreshForm, external_ref: e.target.value })}
          />
          <TextField
            label="Units Held" type="number" value={refreshForm.units_held}
            helperText="Bump this up yourself whenever you buy more units"
            onChange={(e) => setRefreshForm({ ...refreshForm, units_held: e.target.value })}
          />
          <TextField
            select label="Tax section (optional)" value={refreshForm.tax_section}
            helperText="Tag an ELSS fund as 80C, or an NPS-like account as 80CCD(1B)"
            onChange={(e) => setRefreshForm({ ...refreshForm, tax_section: e.target.value })}
          >
            <MenuItem value="">None</MenuItem>
            <MenuItem value="80c">80C</MenuItem>
            <MenuItem value="80ccd_1b">80CCD(1B)</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRefreshDialogAccount(null)}>Cancel</Button>
          <Button variant="contained" onClick={onSaveRefresh}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
