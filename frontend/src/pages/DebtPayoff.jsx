import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, Alert,
  ToggleButton, ToggleButtonGroup, List, ListItem, ListItemText, Chip, CircularProgress,
  useTheme,
} from '@mui/material';
import { CreditCard, EventBusy, TrendingDown } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { getDebtSummary, getDebtPayoffPlan } from '../services/api';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const DEBT_COLORS = ['#c94f4f', '#e08a2a', '#7c5cd6', '#3f78de', '#2ab6c9', '#d666c4'];

export default function DebtPayoff() {
  const theme = useTheme();
  const [summary, setSummary] = useState(null);
  const [strategy, setStrategy] = useState('avalanche');
  const [extraPayment, setExtraPayment] = useState('0');
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const loadSummary = async () => {
    try { setSummary(await getDebtSummary()); } catch (e) { setErr('Failed to load debt accounts'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadSummary(); }, []);

  const runPlan = async () => {
    setErr('');
    try {
      setPlan(await getDebtPayoffPlan(strategy, parseFloat(extraPayment) || 0));
    } catch (e) {
      setErr('Failed to compute payoff plan');
    }
  };
  useEffect(() => { if (summary?.debts?.length) runPlan(); }, [strategy, summary]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;
  }

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

  const maxBalance = summary?.debts?.length ? Math.max(...summary.debts.map((d) => d.balance || 0)) : 0;

  return (
    <Container maxWidth="md" sx={{ mt: 3, mb: 4 }}>
      <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Debt Payoff Planner</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Compare payoff strategies and see exactly when you'll be debt-free.
      </Typography>
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {!summary?.debts?.length ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 4 }}>
          <Typography color="text.secondary">
            No credit cards or loans with an outstanding balance found. Set account type to
            "Credit Card" or "Loan" on a Bank account (with a balance) in Banks to track it here.
          </Typography>
        </Paper>
      ) : (
        <>
          {summary.missing_interest_rate.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No interest rate set for: {summary.missing_interest_rate.join(', ')} — the plan below
              still runs, but avalanche ordering and total-interest figures will be more accurate once
              you add rates in Banks → edit account.
            </Alert>
          )}

          <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
            {heroCard('Total Debt', inr(summary.total_balance), theme.palette.error.main, CreditCard)}
            {heroCard('Debt-Free In', plan?.months != null ? `${plan.months} mo` : '30+ yrs', theme.palette.primary.main, EventBusy)}
            {heroCard('Total Interest', plan ? inr(plan.total_interest) : '—', theme.palette.warning.main, TrendingDown)}
          </Box>

          <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight={800} sx={{ mb: 1.5 }}>Your Debts</Typography>
            {summary.debts.map((d, idx) => {
              const color = DEBT_COLORS[idx % DEBT_COLORS.length];
              const barPct = maxBalance > 0 ? Math.min(100, (d.balance / maxBalance) * 100) : 0;
              return (
                <Box key={d.bank_id} sx={{ py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center" gap={1.25} sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{d.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {d.interest_rate != null ? `${d.interest_rate}% APR` : 'rate not set'} · min {inr(d.minimum_payment)}{d.minimum_payment_is_estimated ? ' (est.)' : ''}
                        </Typography>
                      </Box>
                    </Box>
                    <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>{inr(d.balance)}</Typography>
                  </Box>
                  <Box sx={{ mt: 0.75, height: 4, borderRadius: 2, bgcolor: theme.palette.action.hover, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${barPct}%`, borderRadius: 2, bgcolor: color }} />
                  </Box>
                </Box>
              );
            })}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
              <Typography fontWeight={700}>Total</Typography>
              <Typography fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{inr(summary.total_balance)}</Typography>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 4 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
              <ToggleButtonGroup
                exclusive value={strategy} onChange={(e, v) => v && setStrategy(v)} size="small"
              >
                <ToggleButton value="avalanche">Avalanche (least interest)</ToggleButton>
                <ToggleButton value="snowball">Snowball (quick wins)</ToggleButton>
              </ToggleButtonGroup>
              <TextField
                label="Extra monthly payment (₹)" type="number" size="small" value={extraPayment}
                onChange={(e) => setExtraPayment(e.target.value)}
                sx={{ width: 220 }}
              />
              <Button variant="contained" onClick={runPlan}>Recalculate</Button>
            </Box>

            {plan && (
              <>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Payoff order</Typography>
                <List dense disablePadding>
                  {plan.schedule.map((s, i) => (
                    <ListItem key={s.bank_id} disableGutters>
                      <ListItemText primary={`${i + 1}. ${s.name}`} />
                      <Chip
                        size="small"
                        label={s.payoff_month ? `paid off month ${s.payoff_month}` : 'beyond plan horizon'}
                        color={s.payoff_month ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </Paper>
        </>
      )}
    </Container>
  );
}
