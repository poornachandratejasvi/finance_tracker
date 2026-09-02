import React, { useEffect, useMemo, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, useTheme,
  ToggleButtonGroup, ToggleButton, IconButton, Tooltip, Popover, Divider,
  CircularProgress, List, ListItemButton, ListItemText,
} from '@mui/material';
import {
  Add, LocalShipping, Payments, EventBusy, Event, ChevronLeft, ChevronRight,
  ViewList, CalendarViewMonth, Today, Receipt, Notifications, CreditCard, Description,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, isSameMonth, isToday, format,
} from 'date-fns';
import {
  getCalendar, createSubscription, deleteSubscription,
  getBillPaymentCandidates, confirmBillPayment, markBillPaid,
} from '../services/api';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const blankEvent = { name: '', item_type: 'subscription', amount: '', due_date: '', recurrence: 'none', notes: '' };

const TYPE_META = {
  package: { color: '#4e79a7', Icon: LocalShipping, label: 'Delivery' },
  subscription: { color: '#59a14f', Icon: Receipt, label: 'Subscription' },
  bill: { color: '#e15759', Icon: Payments, label: 'Bill' },
  custom: { color: '#af7aa1', Icon: Notifications, label: 'Reminder' },
  credit_card_statement: { color: '#76b7b2', Icon: Description, label: 'Statement' },
  credit_card_due: { color: '#f28e2b', Icon: CreditCard, label: 'Card payment due' },
};

const typeMetaFor = (item) => {
  if (item.type === 'subscription') return TYPE_META[item.subtitle] || TYPE_META.custom;
  if (item.type === 'credit_card_statement' || item.type === 'credit_card_due') return TYPE_META[item.type];
  return TYPE_META.package;
};

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
  const [view, setView] = useState('month'); // 'month' | 'agenda'
  const [cursor, setCursor] = useState(new Date());
  const [dayAnchor, setDayAnchor] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankEvent);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [matchBill, setMatchBill] = useState(null); // the credit_card_due item being mapped
  const [candidates, setCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const load = async () => {
    try { setItems(await getCalendar(180)); } catch (e) { setErr('Failed to load calendar'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr(''); setMsg('');
    if (!form.name || !form.due_date) { setErr('Name and due date are required.'); return; }
    try {
      await createSubscription({ ...form, amount: form.amount ? parseFloat(form.amount) : null });
      setOpen(false); setForm(blankEvent); setMsg('Added to calendar.'); load();
    } catch (e) { setErr('Failed to save'); }
  };

  const removeSubscription = async (id) => {
    if (!window.confirm('Remove this from the calendar?')) return;
    try { await deleteSubscription(id); setDayAnchor(null); load(); } catch (e) { setErr('Failed to remove'); }
  };

  const openDayFor = (date) => (e) => {
    setSelectedDay(date);
    setDayAnchor(e.currentTarget);
  };

  const openMatchDialog = async (item) => {
    setMatchBill(item);
    setLoadingCandidates(true);
    try { setCandidates(await getBillPaymentCandidates(item.id)); }
    catch (e) { setErr('Failed to load possible matches'); }
    finally { setLoadingCandidates(false); }
  };

  const pickCandidate = async (transactionId) => {
    try {
      await confirmBillPayment(matchBill.id, transactionId);
      setMatchBill(null); setMsg('Payment mapped.'); load();
    } catch (e) { setErr('Failed to confirm payment'); }
  };

  const markPaidNoMatch = async () => {
    try {
      await markBillPaid(matchBill.id);
      setMatchBill(null); setMsg('Marked as paid.'); load();
    } catch (e) { setErr('Failed to mark paid'); }
  };

  const itemsByDay = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const key = new Date(item.date).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }, [items]);

  const agendaGroups = useMemo(() => {
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 60);
    return Array.from(itemsByDay.entries()).filter(([key]) => new Date(key) <= horizon);
  }, [itemsByDay]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const end = endOfWeek(endOfMonth(cursor));
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const now = new Date();
  const in7 = new Date(now); in7.setDate(now.getDate() + 7);
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const next7Count = items.filter((i) => new Date(i.date) <= in7 && !i.is_overdue).length;
  const thisMonthCount = items.filter((i) => { const d = new Date(i.date); return d >= startOfThisMonth && d <= endOfThisMonth; }).length;
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

  const renderItemRow = (item, i) => {
    const meta = typeMetaFor(item);
    const Icon = meta.Icon;
    return (
      <Box
        key={`${item.type}-${item.id}-${i}`}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5, py: 1,
          borderBottom: '1px solid', borderColor: 'divider',
          '&:last-child': { borderBottom: 'none' },
        }}
      >
        <Box sx={{ width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(item.is_overdue ? theme.palette.error.main : meta.color, 0.15), color: item.is_overdue ? theme.palette.error.main : meta.color, flexShrink: 0 }}>
          <Icon sx={{ fontSize: 16 }} />
        </Box>
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
        {item.type === 'subscription' && (
          <Button size="small" color="error" onClick={() => removeSubscription(item.id)}>Remove</Button>
        )}
        {item.type === 'credit_card_due' && item.payment_status === 'unpaid' && (
          <Button size="small" onClick={() => openMatchDialog(item)}>Check payment</Button>
        )}
        {item.type === 'credit_card_due' && item.payment_status !== 'unpaid' && (
          <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 700 }}>✓ Paid</Typography>
        )}
      </Box>
    );
  };

  const dayItems = selectedDay ? (itemsByDay.get(selectedDay.toDateString()) || []) : [];

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Calendar</Typography>
          <Typography variant="body1" color="text.secondary">
            Deliveries, bills, subscriptions, and reminders — anything with a date.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <ToggleButtonGroup size="small" value={view} exclusive onChange={(e, v) => v && setView(v)}>
            <ToggleButton value="month"><CalendarViewMonth fontSize="small" sx={{ mr: 0.5 }} />Month</ToggleButton>
            <ToggleButton value="agenda"><ViewList fontSize="small" sx={{ mr: 0.5 }} />Agenda</ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)}>Add Event</Button>
        </Box>
      </Box>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      <Box display="flex" gap={2} flexWrap="wrap" mb={3} mt={2}>
        {heroCard('Next 7 Days', next7Count, theme.palette.info.main, Event)}
        {heroCard('This Month', thisMonthCount, theme.palette.primary.main, Payments)}
        {heroCard('Overdue', overdueCount, theme.palette.error.main, EventBusy)}
      </Box>

      {view === 'month' ? (
        <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={700}>{format(cursor, 'MMMM yyyy')}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Today"><IconButton size="small" onClick={() => setCursor(new Date())}><Today fontSize="small" /></IconButton></Tooltip>
              <Tooltip title="Previous month"><IconButton size="small" onClick={() => setCursor((c) => subMonths(c, 1))}><ChevronLeft /></IconButton></Tooltip>
              <Tooltip title="Next month"><IconButton size="small" onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight /></IconButton></Tooltip>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: { xs: 0.5, sm: 1 } }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary', pb: 0.5 }}>{d}</Typography>
            ))}
            {monthDays.map((day) => {
              const dayEvents = itemsByDay.get(day.toDateString()) || [];
              const inMonth = isSameMonth(day, cursor);
              const today = isToday(day);
              return (
                <Paper
                  key={day.toISOString()}
                  variant="outlined"
                  onClick={dayEvents.length ? openDayFor(day) : undefined}
                  sx={{
                    minHeight: { xs: 56, sm: 88 }, p: 0.75, borderRadius: 2,
                    opacity: inMonth ? 1 : 0.4,
                    borderColor: today ? 'primary.main' : 'divider',
                    borderWidth: today ? 2 : 1,
                    cursor: dayEvents.length ? 'pointer' : 'default',
                    display: 'flex', flexDirection: 'column', gap: 0.5,
                    '&:hover': dayEvents.length ? { bgcolor: 'action.hover' } : undefined,
                  }}
                >
                  <Typography variant="caption" fontWeight={today ? 800 : 500} sx={{ color: today ? 'primary.main' : 'text.primary' }}>
                    {format(day, 'd')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                    {dayEvents.slice(0, 2).map((ev, i) => {
                      const meta = typeMetaFor(ev);
                      return (
                        <Box key={i} sx={{
                          fontSize: 10.5, px: 0.5, py: 0.15, borderRadius: 0.75, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          bgcolor: alpha(ev.is_overdue ? theme.palette.error.main : meta.color, 0.16),
                          color: ev.is_overdue ? theme.palette.error.main : meta.color, fontWeight: 600,
                        }}>
                          {ev.title}
                        </Box>
                      );
                    })}
                    {dayEvents.length > 2 && (
                      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>+{dayEvents.length - 2} more</Typography>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Box>
        </Paper>
      ) : (
        <Paper sx={{ p: 3 }}>
          {agendaGroups.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              Nothing coming up in the next 60 days.
            </Typography>
          ) : agendaGroups.map(([dateKey, groupItems]) => (
            <Box key={dateKey} sx={{ mb: 2 }}>
              <Typography variant="overline" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                {fmtGroupHeading(dateKey)}
              </Typography>
              {groupItems.map(renderItemRow)}
            </Box>
          ))}
        </Paper>
      )}

      <Popover
        open={Boolean(dayAnchor)} anchorEl={dayAnchor} onClose={() => setDayAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Box sx={{ p: 2, minWidth: 320, maxWidth: 400 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {selectedDay ? format(selectedDay, 'EEEE, d MMMM yyyy') : ''}
          </Typography>
          <Divider sx={{ mb: 1 }} />
          {dayItems.map(renderItemRow)}
        </Box>
      </Popover>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add to Calendar</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label="Name" value={form.name} fullWidth autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField
            select label="Type" value={form.item_type} fullWidth
            onChange={(e) => setForm({ ...form, item_type: e.target.value })}
          >
            <MenuItem value="subscription">Subscription</MenuItem>
            <MenuItem value="bill">Bill</MenuItem>
            <MenuItem value="custom">Reminder / Other</MenuItem>
          </TextField>
          <TextField label="Amount (optional)" type="number" value={form.amount} fullWidth onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <TextField
            label="Date" type="date" fullWidth InputLabelProps={{ shrink: true }}
            value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
          <TextField
            select label="Repeats" value={form.recurrence} fullWidth
            onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
          >
            <MenuItem value="none">Doesn't repeat</MenuItem>
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

      <Dialog open={Boolean(matchBill)} onClose={() => setMatchBill(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Which transaction paid this bill?</DialogTitle>
        <DialogContent>
          {loadingCandidates ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
          ) : candidates.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No matching transaction found automatically (nothing close to {matchBill ? inr(matchBill.amount) : ''} near the due date).
            </Typography>
          ) : (
            <List dense>
              {candidates.map((c) => (
                <ListItemButton key={c.id} onClick={() => pickCandidate(c.id)} sx={{ borderRadius: 1, mb: 0.5 }}>
                  <ListItemText
                    primary={`${c.description} — ${inr(c.amount)}`}
                    secondary={new Date(c.transaction_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMatchBill(null)}>Cancel</Button>
          <Button onClick={markPaidNoMatch}>Mark paid without a transaction</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
