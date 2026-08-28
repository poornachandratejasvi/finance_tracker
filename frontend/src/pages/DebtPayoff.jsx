import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, Alert, Grid,
  ToggleButton, ToggleButtonGroup, List, ListItem, ListItemText, Chip, CircularProgress,
} from '@mui/material';
import { getDebtSummary, getDebtPayoffPlan } from '../services/api';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function DebtPayoff() {
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

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>Debt Payoff Planner</Typography>
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {!summary?.debts?.length ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
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

          <Paper sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>Your debts</Typography>
            <List dense disablePadding>
              {summary.debts.map((d) => (
                <ListItem key={d.bank_id} disableGutters>
                  <ListItemText
                    primary={d.name}
                    secondary={`${d.interest_rate != null ? d.interest_rate + '% APR' : 'rate not set'} · min payment ${inr(d.minimum_payment)}${d.minimum_payment_is_estimated ? ' (estimated)' : ''}`}
                  />
                  <Typography fontWeight={700} color="error.main">{inr(d.balance)}</Typography>
                </ListItem>
              ))}
            </List>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
              <Typography fontWeight={700}>Total</Typography>
              <Typography fontWeight={700}>{inr(summary.total_balance)}</Typography>
            </Box>
          </Paper>

          <Paper sx={{ p: 2.5, mb: 3 }}>
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
                <Grid container spacing={2} sx={{ mb: 2 }}>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">Debt-free in</Typography>
                    <Typography variant="h6">{plan.months != null ? `${plan.months} mo` : '30+ yrs'}</Typography>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="text.secondary">Total interest paid</Typography>
                    <Typography variant="h6" color="error.main">{inr(plan.total_interest)}</Typography>
                  </Grid>
                </Grid>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Payoff order</Typography>
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
