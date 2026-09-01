import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  Divider,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import PersonIcon from '@mui/icons-material/Person';
import { getFamilyDashboard } from '../services/api';

const roleColor = (role) => {
  if (role === 'ADMIN') return 'primary';
  if (role === 'VIEWER') return 'default';
  return 'success';
};

export default function FamilyDashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getFamilyDashboard()
      .then(setData)
      .catch((e) => setErr(e?.response?.data?.detail || 'Failed to load family dashboard'));
  }, []);

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <GroupsIcon color="primary" />
        <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5 }}>Family Dashboard</Typography>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      {!data ? null : (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">Total Assets</Typography>
                  <Typography variant="h5" color="success.main">
                    {data.totals.total_assets.toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">Total Liabilities</Typography>
                  <Typography variant="h5" color="error.main">
                    {data.totals.total_liabilities.toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">Family Net Worth</Typography>
                  <Typography variant="h5">{data.totals.net_worth.toLocaleString()}</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {data.members.length === 0 && (
            <Typography color="text.secondary">No household members found.</Typography>
          )}

          {data.members.map((m) => (
            <Paper key={m.user_id} sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <PersonIcon fontSize="small" color="action" />
                <Typography variant="subtitle1" fontWeight={700}>
                  {m.full_name || m.username}{m.is_you ? ' (You)' : ''}
                </Typography>
                <Chip size="small" label={m.role} color={roleColor(m.role)} />
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  Net: <strong>{m.net.toLocaleString()}</strong>
                </Typography>
              </Box>
              <Divider sx={{ mb: 1 }} />
              {m.banks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No accounts.</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Account</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Balance</TableCell>
                      <TableCell>Currency</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {m.banks.map((b) => (
                      <TableRow key={b.bank_id}>
                        <TableCell>{b.bank_name}</TableCell>
                        <TableCell sx={{ textTransform: 'capitalize' }}>{b.bank_type}</TableCell>
                        <TableCell align="right" sx={{ color: b.bank_type === 'credit' ? 'error.main' : 'success.main' }}>
                          {b.current_balance.toLocaleString()}
                        </TableCell>
                        <TableCell>{b.currency_code}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paper>
          ))}
        </>
      )}
    </Container>
  );
}
