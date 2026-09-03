import React, { useEffect, useMemo, useState } from 'react';
import {
  Container, Paper, Box, Typography, ToggleButtonGroup, ToggleButton, useTheme, alpha,
} from '@mui/material';
import {
  ShowChart, AccountBalanceWallet, TrendingDown,
} from '@mui/icons-material';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip as ReTooltip, CartesianGrid,
} from 'recharts';
import { getNetWorth } from '../services/api';
import { formatCurrency } from '../utils/format';

const PERIODS = [30, 90, 180, 365];

const dayTick = (d) => {
  if (!d) return '';
  const p = String(d).split('-');
  return p[1] && p[2] ? `${p[1]}/${p[2]}` : String(d);
};

export default function NetWorth() {
  const theme = useTheme();
  const [days, setDays] = useState(180);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getNetWorth(days)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  const money = (v) => formatCurrency(v, { currency: 'INR' });
  const moneyC = (v) => formatCurrency(v, { currency: 'INR', compact: true });

  const series = useMemo(() => (data?.series || []).map((s) => ({
    ...s,
    assets_total: (s.savings_total || 0) + (s.investments_total || 0),
    liabilities_total: (s.credit_total || 0) + (s.loan_total || 0),
  })), [data]);

  const current = data?.current || {};
  const currentAssets = (current.savings_total || 0) + (current.investments_total || 0);
  const currentLiabilities = (current.credit_total || 0) + (current.loan_total || 0);

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
      <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.15 }}>{money(value)}</Typography>
    </Paper>
  );

  const tooltipStyle = {
    borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    background: theme.palette.background.paper,
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Net Worth</Typography>
          <Typography variant="body1" color="text.secondary">
            Bank balances plus investments, minus credit cards and loans — the fuller picture beyond the Dashboard's bank-only figure.
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive size="small" value={days}
          onChange={(_e, v) => v && setDays(v)}
        >
          {PERIODS.map((p) => <ToggleButton key={p} value={p}>{p}d</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>

      <Box display="flex" gap={2} flexWrap="wrap" mb={3} mt={2}>
        {heroCard('Full Net Worth', current.full_net_worth ?? 0, theme.palette.primary.main, ShowChart)}
        {heroCard('Total Assets', currentAssets, theme.palette.success.main, AccountBalanceWallet)}
        {heroCard('Total Liabilities', currentLiabilities, theme.palette.error.main, TrendingDown)}
      </Box>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Trend</Typography>
        {loading ? (
          <Typography color="text.secondary" sx={{ py: 4 }}>Loading…</Typography>
        ) : series.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4 }}>
            Not enough history yet — net worth is snapshotted daily.
          </Typography>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fullNetWorthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} vertical={false} />
              <XAxis dataKey="date" tickFormatter={dayTick} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={moneyC} tick={{ fontSize: 11 }} width={60} />
              <ReTooltip formatter={(v) => money(v)} contentStyle={tooltipStyle} />
              <Area
                type="monotone" dataKey="full_net_worth" name="Net Worth"
                stroke={theme.palette.primary.main} strokeWidth={2} fill="url(#fullNetWorthFill)"
              />
              <Line type="monotone" dataKey="assets_total" name="Assets" stroke={theme.palette.success.main} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="liabilities_total" name="Liabilities" stroke={theme.palette.error.main} strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Paper>
    </Container>
  );
}
