import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  LinearProgress, Grid, Divider, MenuItem, Chip,
} from '@mui/material';
import { Add, Delete, Save } from '@mui/icons-material';
import { getBudgetSettings, saveBudgetSettings, getBudgetStatus } from '../services/api';

const CATEGORIES = [
  'Food & Dining', 'Shopping', 'Transportation', 'Bills & Utilities', 'Entertainment',
  'Healthcare', 'Transfer', 'ATM Withdrawal', 'Others',
];

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function Budgets() {
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
  const barColor = (pct, over) => (over ? 'error' : pct >= 80 ? 'warning' : 'success');

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h4" gutterBottom>Budgets</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Set a monthly spend limit per category. {status?.period ? `Tracking ${status.period}.` : ''} Alerts are sent to Discord when a category crosses its threshold (configure the webhook in Settings).
      </Typography>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {/* Current-month progress */}
      {status && (status.budgets || []).length > 0 && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6">This month</Typography>
            <Typography variant="body2" color="text.secondary">
              {inr(status.total_spent)} of {inr(status.total_limit)}
            </Typography>
          </Box>
          <Grid container spacing={2}>
            {status.budgets.map((b) => (
              <Grid item xs={12} sm={6} key={b.category}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2">{b.category}</Typography>
                  <Typography variant="body2" color={b.over ? 'error' : 'text.secondary'}>
                    {inr(b.spent)} / {inr(b.monthly_limit)} {b.over && <Chip label="over" size="small" color="error" sx={{ ml: 0.5, height: 18 }} />}
                  </Typography>
                </Box>
                <LinearProgress variant="determinate" value={Math.min(100, b.pct)} color={barColor(b.pct, b.over)} sx={{ height: 8, borderRadius: 1 }} />
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}

      {/* Config */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>Configure budgets</Typography>
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
