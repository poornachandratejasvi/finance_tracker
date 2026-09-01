import React, { useEffect, useMemo, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, useTheme,
} from '@mui/material';
import { Add, LocalShipping, Payments, EventBusy, Event } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { getCalendar, createSubscription } from '../services/api';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const blankSub = { name: '', item_type: 'subscription', amount: '', due_date: '', recurrence: 'none', notes: '' };

const fmtGroupHeading = (dateStr) => {
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
};

export default function CalendarPage() {
  const theme = useTheme();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankSub);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    try { setItems(await getCalendar(60)); } catch (e) { setErr('Failed to load calendar'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr(''); setMsg('');
    if (!form.name || !form.due_date) { setErr('Name and due date are required.'); return; }
    try {
      await createSubscription({ ...form, amount: form.amount ? parseFloat(form.amount) : null });
      setOpen(false); setForm(blankSub); setMsg('Added to calendar.'); load();
    } catch (e) { setErr('Failed to save'); }
  };

  const groups = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const key = new Date(item.date).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries());
  }, [items]);

  const now = new Date();
  const in7 = new Date(now); in7.setDate(now.getDate() + 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const next7Count = items.filter((i) => new Date(i.date) <= in7 && !i.is_overdue).length;
  const thisMonthCount = items.filter((i) => { const d = new Date(i.date); return d >= startOfMonth && d <= endOfMonth; }).length;
  const overdueCount = items.filter((i) => i.is_overdue).length;

  const heroCard = (label, value, color, Icon) => (
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
      <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.15 }}>{value}</Typography>
    </Paper>
  );

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Calendar</Typography>
          <Typography variant="body1" color="text.secondary">Upcoming deliveries, bills, and subscriptions in one place.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)}>Add Subscription/Bill</Button>
      </Box>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      <Box display="flex" gap={2} flexWrap="wrap" mb={3} mt={2}>
        {heroCard('Next 7 Days', next7Count, theme.palette.info.main, Event)}
        {heroCard('This Month', thisMonthCount, theme.palette.primary.main, Payments)}
        {heroCard('Overdue', overdueCount, theme.palette.error.main, EventBusy)}
      </Box>

      <Paper sx={{ p: 3 }}>
        {groups.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            Nothing coming up in the next 60 days.
          </Typography>
        ) : groups.map(([dateKey, groupItems]) => (
          <Box key={dateKey} sx={{ mb: 2 }}>
            <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              {fmtGroupHeading(dateKey)}
            </Typography>
            {groupItems.map((item, i) => (
              <Box
                key={`${item.type}-${item.id}-${i}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5, py: 1,
                  borderBottom: '1px solid', borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                }}
              >
                {item.type === 'package'
                  ? <LocalShipping fontSize="small" color={item.is_overdue ? 'error' : 'info'} />
                  : <Payments fontSize="small" color={item.is_overdue ? 'error' : 'primary'} />}
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" noWrap>{item.title}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {item.subtitle}{item.is_overdue ? ' · Overdue' : ''}
                  </Typography>
                </Box>
                {item.amount != null && (
                  <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                    {inr(item.amount)}
                  </Typography>
                )}
                {item.link && (
                  <Button size="small" href={item.link} target="_blank" rel="noopener noreferrer">Track</Button>
                )}
              </Box>
            ))}
          </Box>
        ))}
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Subscription/Bill</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Name" value={form.name} fullWidth onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField
            select label="Type" value={form.item_type} fullWidth
            onChange={(e) => setForm({ ...form, item_type: e.target.value })}
          >
            <MenuItem value="subscription">Subscription</MenuItem>
            <MenuItem value="bill">Bill</MenuItem>
            <MenuItem value="custom">Custom</MenuItem>
          </TextField>
          <TextField label="Amount (optional)" type="number" value={form.amount} fullWidth onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <TextField
            label="Due date" type="date" fullWidth InputLabelProps={{ shrink: true }}
            value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
          <TextField
            select label="Recurrence" value={form.recurrence} fullWidth
            onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
          >
            <MenuItem value="none">One-time</MenuItem>
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="yearly">Yearly</MenuItem>
          </TextField>
          <TextField label="Notes" value={form.notes} fullWidth multiline minRows={2} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
