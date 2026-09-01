import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  Divider, MenuItem, Chip, useTheme,
} from '@mui/material';
import { Add, Delete, Save, AccountBalanceWallet, TrendingDown, Savings } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { getBudgetSettings, saveBudgetSettings, getBudgetStatus } from '../services/api';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { useCategoryMeta } from '../utils/categories';

const CATEGORIES = [
  'Food & Dining', 'Shopping', 'Transportation', 'Bills & Utilities', 'Entertainment',
  'Healthcare', 'Transfer', 'ATM Withdrawal', 'Others',
];

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function Budgets() {
  const theme = useTheme();
  const { getMeta } = useCategoryMeta();
  const [rows, setRows] = useState([]);           // [{category, monthly_limit, alert_at_pct}]
  const [discordAlerts, setDiscordAlerts] = useState(true);
  const [status, setStatus] = useState(null);      // {period, budgets:[{category,spent,pct,over,...}]}
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [cfg, st] = await Promise.all([
        getBudgetSettings().catch(() => ({ budgets: [] })),
        getBudgetStatus().catch(() => null),
      ]);
      setRows((cfg.budgets || []).map((b) => ({ category: b.category, monthly_limit: b.monthly_limit, alert_at_pct: b.alert_at_pct ?? 80 })));
      setDiscordAlerts(cfg.discord_alerts !== false);
      setStatus(st);
    } catch (e) { setErr('Failed to load budgets'); }
  };
  useEffect(() => { load(); }, []);

  const addRow = () => setRows((r) => [...r, { category: CATEGORIES[0], monthly_limit: 0, alert_at_pct: 80 }]);
  const upd = (i, k, v) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const del = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    setErr(''); setMsg('');
    try {
      await saveBudgetSettings({
        budgets: rows.map((r) => ({ category: r.category, monthly_limit: parseFloat(r.monthly_limit) || 0, alert_at_pct: parseInt(r.alert_at_pct) || 80 })),
        alert_email: '',
        discord_alerts: discordAlerts,
      });
      setMsg('Budgets saved.');
      const st = await getBudgetStatus().catch(() => null);
      setStatus(st);
    } catch (e) {
      setErr(e?.response?.data?.detail ? JSON.stringify(e.response.data.detail) : 'Failed to save budgets');
    }
  };

  const statusFor = (cat) => (status?.budgets || []).find((b) => b.category === cat);
  const barColorFor = (pct, over) => (over ? theme.palette.error.main : pct >= 80 ? theme.palette.warning.main : theme.palette.success.main);

  const totalSpent = status?.total_spent || 0;
  const totalLimit = status?.total_limit || 0;
  const remaining = totalLimit - totalSpent;

  const heroCard = (label, value, mode, Icon) => {
    const color = mode === 'over' ? theme.palette.error.main : mode === 'remaining' ? (remaining < 0 ? theme.palette.error.main : theme.palette.success.main) : theme.palette.primary.main;
    return (
      <Paper variant="outlined" sx={{
        p: 2.75, flex: '1 1 220px', minWidth: 220, borderRadius: 4,
        backgroundImage: `linear-gradient(135deg, ${alpha(color, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(color, 0)} 65%)`,
      }}>
        <Box display="flex" alignItems="center" gap={1.25} mb={1.5}>
          <Box sx={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: color, color: '#fff', flexShrink: 0 }}>
            <Icon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>{label}</Typography>
        </Box>
        <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.15 }}>{inr(value)}</Typography>
      </Paper>
    );
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Budgets</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Set a monthly spend limit per category{status?.period ? ` — tracking ${status.period}` : ''}. Alerts go to Discord when a category crosses its threshold.
      </Typography>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {/* Current-month progress */}
      {status && (status.budgets || []).length > 0 && (
        <>
          <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
            {heroCard('Total Budgeted', totalLimit, 'limit', AccountBalanceWallet)}
            {heroCard('Spent So Far', totalSpent, 'over', TrendingDown)}
            {heroCard('Remaining', remaining, 'remaining', Savings)}
          </Box>

          <Paper variant="outlined" sx={{ p: 3, mb: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>This Month by Category</Typography>
            {status.budgets.map((b) => {
              const meta = getMeta(b.category);
              const barColor = barColorFor(b.pct, b.over);
              return (
                <Box key={b.category} sx={{ py: 1.1, borderBottom: `1px solid ${theme.palette.divider}` }}>
                  <Box display="flex" alignItems="center" gap={1.25} mb={0.75}>
                    <CategoryIcon name={b.category} size={30} meta={meta} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{b.category}</Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: b.over ? 'error.main' : 'text.primary' }}>
                      {inr(b.spent)} <Typography component="span" variant="caption" color="text.secondary">/ {inr(b.monthly_limit)}</Typography>
                    </Typography>
                    {b.over && <Chip label="Over" size="small" color="error" sx={{ height: 20, fontWeight: 700 }} />}
                  </Box>
                  <Box sx={{ height: 6, borderRadius: 3, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${Math.min(100, b.pct)}%`, borderRadius: 3, bgcolor: barColor, transition: 'width 0.4s ease' }} />
                  </Box>
                </Box>
              );
            })}
          </Paper>
        </>
      )}

      {/* Config */}
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 4 }}>
        <Typography variant="h6" fontWeight={800} gutterBottom>Configure Budgets</Typography>
        {rows.map((row, i) => {
          const st = statusFor(row.category);
          return (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
              <TextField size="small" select label="Category" value={row.category} onChange={(e) => upd(i, 'category', e.target.value)} sx={{ minWidth: 190 }}>
                {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Monthly limit (₹)" type="number" value={row.monthly_limit} onChange={(e) => upd(i, 'monthly_limit', e.target.value)} sx={{ width: 160 }} />
              <TextField size="small" label="Alert at %" type="number" value={row.alert_at_pct} onChange={(e) => upd(i, 'alert_at_pct', e.target.value)} sx={{ width: 110 }} />
              {st && <Typography variant="caption" color={st.over ? 'error' : 'text.secondary'}>{inr(st.spent)} spent ({st.pct}%)</Typography>}
              <IconButton size="small" color="error" onClick={() => del(i)}><Delete fontSize="small" /></IconButton>
            </Box>
          );
        })}
        <Button size="small" startIcon={<Add />} onClick={addRow} sx={{ mt: 1 }}>Add budget</Button>
        <Divider sx={{ my: 2 }} />
        <Button variant="contained" startIcon={<Save />} onClick={save}>Save Budgets</Button>
      </Paper>
    </Container>
  );
}
