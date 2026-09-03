import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, TextField, MenuItem, LinearProgress,
  List, ListItem, ListItemText, Alert, CircularProgress, useTheme, alpha,
  FormControlLabel, Switch, Divider,
} from '@mui/material';
import { UploadFile, Savings, HealthAndSafety, AccountBalance, Home } from '@mui/icons-material';
import { getTaxDashboard, uploadPayslip, listPayslips, deletePayslip } from '../services/api';
import api from '../services/api';
import { formatCurrency } from '../utils/format';

const currentFY = () => {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
};

const FY_OPTIONS = (() => {
  const [startYear] = currentFY().split('-').map(Number);
  return [startYear - 1, startYear, startYear + 1].map((y) => `${y}-${String(y + 1).slice(2)}`);
})();

export default function TaxDashboard() {
  const theme = useTheme();
  const [fy, setFy] = useState(currentFY());
  const [seniorCitizen, setSeniorCitizen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [payslips, setPayslips] = useState([]);
  const [rent, setRent] = useState('');
  const [metro, setMetro] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [dash, ps] = await Promise.all([
        getTaxDashboard(fy, seniorCitizen),
        listPayslips().catch(() => []),
      ]);
      setData(dash);
      setPayslips(ps);
      if (dash?.hra_exemption) {
        setRent(dash.hra_exemption.monthly_rent || '');
        setMetro(!!dash.hra_exemption.city_metro);
      }
    } catch {
      setError('Failed to load tax dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [fy, seniorCitizen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await uploadPayslip(file);
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || 'Failed to parse this payslip');
    } finally {
      setUploading(false);
    }
  };

  const removePayslip = async (id) => {
    try { await deletePayslip(id); load(); } catch { setError('Failed to delete payslip'); }
  };

  const saveRentPrefs = async () => {
    setSavingPrefs(true);
    try {
      await api.put('/api/users/me/preferences', { monthly_rent: rent === '' ? 0 : parseFloat(rent), city_metro: metro });
      load();
    } catch {
      setError('Failed to save rent/city');
    } finally {
      setSavingPrefs(false);
    }
  };

  const sectionCard = (key, label, Icon, color) => {
    const s = data?.sections?.[key];
    if (!s) return null;
    const pct = s.limit ? Math.min(100, (s.utilized / s.limit) * 100) : 0;
    return (
      <Paper variant="outlined" sx={{
        p: 2.5, flex: '1 1 260px', minWidth: 260, borderRadius: 4,
        backgroundImage: `linear-gradient(135deg, ${alpha(color, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(color, 0)} 65%)`,
      }}>
        <Box display="flex" alignItems="center" gap={1} mb={1}>
          <Icon sx={{ color }} />
          <Typography variant="subtitle1" fontWeight={700}>{label}</Typography>
        </Box>
        <Typography variant="h5" fontWeight={800}>{formatCurrency(s.utilized)}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          of {formatCurrency(s.limit)} limit — {formatCurrency(s.remaining)} remaining
        </Typography>
        <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4, mb: 1.5 }} />
        {s.breakdown.length > 0 ? (
          <List dense disablePadding>
            {s.breakdown.map((b, i) => (
              <ListItem key={i} disablePadding sx={{ py: 0.25 }}>
                <ListItemText primary={b.label} secondary={formatCurrency(b.amount)} />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="caption" color="text.secondary">Nothing tracked yet for this section.</Typography>
        )}
      </Paper>
    );
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Tax Dashboard</Typography>
          <Typography variant="body1" color="text.secondary">
            80C / 80D / 80CCD(1B) utilization, computed from your insurance, investments, and payslips — plus an HRA exemption estimate.
          </Typography>
        </Box>
        <Box display="flex" gap={1} alignItems="center">
          <TextField select size="small" label="Financial Year" value={fy} onChange={(e) => setFy(e.target.value)} sx={{ minWidth: 140 }}>
            {FY_OPTIONS.map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <FormControlLabel
            control={<Switch checked={seniorCitizen} onChange={(e) => setSeniorCitizen(e.target.checked)} />}
            label="Senior citizen (80D ₹50k)"
          />
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : (
        <>
          <Box display="flex" gap={2} flexWrap="wrap" mb={3}>
            {sectionCard('80c', '80C', Savings, theme.palette.primary.main)}
            {sectionCard('80d', '80D (Health Insurance)', HealthAndSafety, theme.palette.success.main)}
            {sectionCard('80ccd_1b', '80CCD(1B) — NPS', AccountBalance, theme.palette.warning.main)}
          </Box>

          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Home color="action" />
              <Typography variant="subtitle1" fontWeight={700}>HRA Exemption</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Rent and city aren't on a payslip, so set them here once — the exemption is computed from your uploaded payslips' Basic/HRA.
            </Typography>
            <Box display="flex" gap={2} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
              <TextField size="small" label="Monthly Rent" type="number" value={rent} onChange={(e) => setRent(e.target.value)} sx={{ width: 160 }} />
              <FormControlLabel control={<Switch checked={metro} onChange={(e) => setMetro(e.target.checked)} />} label="Metro city (50% vs 40% of Basic)" />
              <Button variant="outlined" size="small" onClick={saveRentPrefs} disabled={savingPrefs}>
                {savingPrefs ? 'Saving…' : 'Save'}
              </Button>
            </Box>
            {data?.hra_exemption?.configured ? (
              <Box>
                <Typography variant="h5" fontWeight={800} color="success.main">
                  {formatCurrency(data.hra_exemption.exemption)} exempt
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Basic {formatCurrency(data.hra_exemption.basic_total)} · HRA received {formatCurrency(data.hra_exemption.hra_received_total)} ·
                  {' '}Rent paid {formatCurrency(data.hra_exemption.rent_paid_total)} · from {data.hra_exemption.months_on_file} payslip(s) on file
                </Typography>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">Set a monthly rent above and upload at least one payslip to see this.</Typography>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle1" fontWeight={700}>Payslips</Typography>
              <Button component="label" variant="contained" size="small" startIcon={<UploadFile />} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload Payslip'}
                <input type="file" hidden accept=".pdf" onChange={(e) => handleUpload(e.target.files?.[0])} />
              </Button>
            </Box>
            {payslips.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No payslips uploaded yet.</Typography>
            ) : (
              <List dense>
                {payslips.map((p) => (
                  <React.Fragment key={p.id}>
                    <ListItem
                      secondaryAction={<Button size="small" color="error" onClick={() => removePayslip(p.id)}>Remove</Button>}
                    >
                      <ListItemText
                        primary={`${p.month} — ${formatCurrency(p.net_pay)} net`}
                        secondary={`Basic ${formatCurrency(p.basic)} · HRA ${formatCurrency(p.hra_received)} · PF ${formatCurrency(p.provident_fund)} · Tax ${formatCurrency(p.income_tax_deducted)}`}
                      />
                    </ListItem>
                    <Divider component="li" />
                  </React.Fragment>
                ))}
              </List>
            )}
          </Paper>
        </>
      )}
    </Container>
  );
}
