import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  LinearProgress, Grid, Dialog, DialogTitle, DialogContent, DialogActions, Chip,
  FormControlLabel, Switch, MenuItem,
} from '@mui/material';
import { Add, Delete, Edit, Savings, CheckCircle, RadioButtonUnchecked } from '@mui/icons-material';
import { listGoals, createGoal, updateGoal, deleteGoal, sweepRoundups, contributeToGoal } from '../services/api';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const blank = {
  name: '', target_amount: '', current_amount: '', target_date: '', color: '#4e79a7',
  roundup_enabled: false, roundup_to: 10, monthly_target: '',
};

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [sweeping, setSweeping] = useState(null);
  const [contributing, setContributing] = useState(null);
  const [contribAmount, setContribAmount] = useState('');

  const load = async () => {
    try { setGoals(await listGoals()); } catch (e) { setErr('Failed to load goals'); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (g) => {
    setEditing(g.id);
    setForm({
      name: g.name, target_amount: g.target_amount, current_amount: g.current_amount,
      target_date: g.target_date ? g.target_date.slice(0, 10) : '', color: g.color || '#4e79a7',
      roundup_enabled: g.roundup_enabled || false, roundup_to: g.roundup_to || 10,
      monthly_target: g.monthly_target || '',
    });
    setOpen(true);
  };

  const save = async () => {
    setErr(''); setMsg('');
    if (!form.name || !form.target_amount) { setErr('Name and target amount are required.'); return; }
    const payload = {
      name: form.name,
      target_amount: parseFloat(form.target_amount) || 0,
      current_amount: parseFloat(form.current_amount) || 0,
      target_date: form.target_date || null,
      color: form.color,
      roundup_enabled: form.roundup_enabled,
      roundup_to: parseInt(form.roundup_to, 10) || 10,
      monthly_target: form.monthly_target ? parseFloat(form.monthly_target) : null,
    };
    try {
      if (editing) await updateGoal(editing, payload);
      else await createGoal(payload);
      setOpen(false); setMsg('Goal saved.'); load();
    } catch (e) { setErr('Failed to save goal'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this goal?')) return;
    try { await deleteGoal(id); load(); } catch (e) { setErr('Failed to delete goal'); }
  };

  const contribute = async (goal) => {
    const amount = parseFloat(contribAmount);
    if (!amount || amount <= 0) { setErr('Enter an amount greater than zero.'); return; }
    setErr(''); setMsg('');
    try {
      await contributeToGoal(goal.id, amount);
      setMsg(`Added ${inr(amount)} to "${goal.name}".`);
      setContributing(null);
      setContribAmount('');
      load();
    } catch (e) {
      setErr('Failed to record contribution.');
    }
  };

  const sweep = async (goal) => {
    setErr(''); setMsg(''); setSweeping(goal.id);
    try {
      const result = await sweepRoundups(goal.id);
      setMsg(
        result.swept_amount > 0
          ? `Swept ${inr(result.swept_amount)} from ${result.transaction_count} transaction(s) into "${goal.name}".`
          : `No new spare change to sweep into "${goal.name}" right now.`
      );
      load();
    } catch (e) {
      setErr('Failed to sweep round-ups.');
    } finally {
      setSweeping(null);
    }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4">Savings Goals</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openNew}>New Goal</Button>
      </Box>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {goals.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No goals yet. Create one to start tracking your savings targets.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {goals.map((g) => (
            <Grid item xs={12} sm={6} md={4} key={g.id}>
              <Paper sx={{ p: 2.5, height: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: g.color }} />
                    <Typography variant="subtitle1" fontWeight={600}>{g.name}</Typography>
                  </Box>
                  <Box>
                    <IconButton size="small" onClick={() => openEdit(g)}><Edit fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(g.id)}><Delete fontSize="small" /></IconButton>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, mb: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">{inr(g.current_amount)} / {inr(g.target_amount)}</Typography>
                  <Typography variant="body2" fontWeight={600}>{g.pct}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={Math.min(100, g.pct)} sx={{ height: 8, borderRadius: 1, '& .MuiLinearProgress-bar': { bgcolor: g.color } }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">{inr(g.remaining)} to go</Typography>
                  {g.target_date && <Chip label={`by ${g.target_date.slice(0, 10)}`} size="small" variant="outlined" />}
                </Box>
                {g.monthly_target != null && (
                  <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      {g.monthly_target_met ? (
                        <CheckCircle fontSize="small" color="success" />
                      ) : (
                        <RadioButtonUnchecked fontSize="small" color="disabled" />
                      )}
                      <Typography variant="body2" color={g.monthly_target_met ? 'success.main' : 'text.secondary'}>
                        This month: {inr(g.this_month_saved)} of {inr(g.monthly_target)} saved
                        {g.monthly_target_met ? ' — target met' : ''}
                      </Typography>
                    </Box>
                    {contributing === g.id ? (
                      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <TextField
                          size="small" type="number" placeholder="Amount" value={contribAmount}
                          onChange={(e) => setContribAmount(e.target.value)} autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') contribute(g); }}
                        />
                        <Button size="small" variant="contained" onClick={() => contribute(g)}>Add</Button>
                        <Button size="small" onClick={() => { setContributing(null); setContribAmount(''); }}>Cancel</Button>
                      </Box>
                    ) : (
                      <Button size="small" onClick={() => setContributing(g.id)}>Add Contribution</Button>
                    )}
                  </Box>
                )}
                {g.roundup_enabled && (
                  <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip icon={<Savings fontSize="small" />} label={`Round-up to ₹${g.roundup_to}`} size="small" variant="outlined" />
                    <Button size="small" onClick={() => sweep(g)} disabled={sweeping === g.id}>
                      {sweeping === g.id ? 'Sweeping…' : 'Sweep Now'}
                    </Button>
                  </Box>
                )}
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? 'Edit Goal' : 'New Goal'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
            <TextField label="Target amount (₹)" type="number" value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} fullWidth />
            <TextField label="Current amount (₹)" type="number" value={form.current_amount} onChange={(e) => setForm({ ...form, current_amount: e.target.value })} fullWidth />
            <TextField label="Target date" type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField label="Color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} sx={{ width: 100 }} />
            <TextField
              label="Monthly savings target (₹, optional)" type="number"
              value={form.monthly_target} onChange={(e) => setForm({ ...form, monthly_target: e.target.value })}
              helperText="e.g. 10000 — tracks whether you've put away that much toward this goal each calendar month"
              fullWidth
            />
            <FormControlLabel
              control={<Switch checked={form.roundup_enabled} onChange={(e) => setForm({ ...form, roundup_enabled: e.target.checked })} />}
              label="Round-up savings — round each expense up and sweep the spare change here"
            />
            {form.roundup_enabled && (
              <TextField
                select label="Round up to nearest" value={form.roundup_to}
                onChange={(e) => setForm({ ...form, roundup_to: e.target.value })}
                helperText="Only one goal at a time can claim the round-up backlog — sweeping consumes it."
              >
                {[10, 50, 100].map((v) => <MenuItem key={v} value={v}>₹{v}</MenuItem>)}
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
