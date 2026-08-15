import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Box, Typography, Grid, Card, CardContent, CardHeader,
  Chip, CircularProgress, Alert, Divider, Tooltip, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  LinearProgress,
} from '@mui/material';
import { Refresh, CheckCircle, Warning, Error as ErrorIcon, AccountBalance } from '@mui/icons-material';
import api from '../services/api';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (_) { return iso; }
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return iso; }
};

const currencyFmt = (n) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** Returns { color, label, icon } based on days_until_next */
function nextStatementStatus(days) {
  if (days == null) return { color: 'default', label: 'No data', severity: 'default' };
  if (days < 0) return { color: 'error', label: `Overdue by ${Math.abs(days)}d`, severity: 'error' };
  if (days <= 5) return { color: 'warning', label: `Due in ${days}d`, severity: 'warning' };
  return { color: 'success', label: `In ${days}d`, severity: 'success' };
}

export default function BankStatements() {
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const resp = await api.get('/api/banks/statement-dashboard');
      setBanks(resp.data?.banks || []);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const overdue = banks.filter((b) => b.days_until_next != null && b.days_until_next < 0);
  const dueSoon = banks.filter((b) => b.days_until_next != null && b.days_until_next >= 0 && b.days_until_next <= 5);

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom>Bank Statement Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">
            Track when each bank statement was last received and when the next one is expected.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          {/* span wrapper lets the Tooltip attach listeners even while the button is disabled */}
          <span>
            <IconButton onClick={fetchData} disabled={loading}>
              {loading ? <CircularProgress size={22} /> : <Refresh />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Summary banners ── */}
      {overdue.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }} icon={<ErrorIcon />}>
          <strong>{overdue.length} bank(s) have overdue statements:</strong>{' '}
          {overdue.map((b) => b.bank_name).join(', ')}
        </Alert>
      )}
      {dueSoon.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} icon={<Warning />}>
          <strong>{dueSoon.length} bank(s) expecting a statement soon:</strong>{' '}
          {dueSoon.map((b) => `${b.bank_name} (${b.days_until_next}d)`).join(', ')}
        </Alert>
      )}

      {/* ── Summary cards ── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Total Banks</Typography>
              <Typography variant="h4">{banks.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Total Statements</Typography>
              <Typography variant="h4">{banks.reduce((s, b) => s + (b.total_statements || 0), 0)}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Total Transactions</Typography>
              <Typography variant="h4">{banks.reduce((s, b) => s + (b.total_transactions || 0), 0).toLocaleString()}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Card sx={{ bgcolor: overdue.length > 0 ? 'error.light' : 'success.light' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary">Statements Overdue</Typography>
              <Typography variant="h4" color={overdue.length > 0 ? 'error.main' : 'success.main'}>
                {overdue.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ── Per-bank cards ── */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress />
        </Box>
      ) : banks.length === 0 ? (
        <Alert severity="info">No banks configured yet. Add banks in the Banks page.</Alert>
      ) : (
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {banks.map((bank) => {
            const ns = nextStatementStatus(bank.days_until_next);
            return (
              <Grid item xs={12} sm={6} md={4} key={bank.bank_id}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardHeader
                    avatar={<AccountBalance color="primary" />}
                    title={<Typography variant="h6">{bank.bank_name}</Typography>}
                    subheader={
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                        <Chip label={bank.bank_type} size="small" variant="outlined" />
                        {bank.bank_code && <Chip label={bank.bank_code} size="small" />}
                        <Chip label={ns.label} size="small" color={ns.color} />
                      </Box>
                    }
                  />
                  <CardContent>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Current Balance</Typography>
                        <Typography variant="body2" fontWeight={600}>{currencyFmt(bank.current_balance)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Balance Updated</Typography>
                        <Typography variant="body2">{fmtDate(bank.balance_updated_at)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Statements</Typography>
                        <Typography variant="body2" fontWeight={600}>{bank.total_statements}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Transactions</Typography>
                        <Typography variant="body2" fontWeight={600}>{bank.total_transactions?.toLocaleString()}</Typography>
                      </Box>
                    </Box>

                    <Divider sx={{ my: 1.5 }} />

                    <Typography variant="caption" color="text.secondary">Latest Statement Period End</Typography>
                    <Typography variant="body2" fontWeight={600}>{fmtDate(bank.latest_statement_period_end)}</Typography>

                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Last Email Received
                    </Typography>
                    <Typography variant="body2">{fmtDateTime(bank.latest_received_date)}</Typography>

                    {bank.latest_email_subject && (
                      <>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Subject</Typography>
                        <Typography variant="body2" sx={{ fontSize: '0.78rem', wordBreak: 'break-word' }}>
                          {bank.latest_email_subject}
                        </Typography>
                      </>
                    )}

                    {bank.latest_pdf_filename && (
                      <>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Latest File</Typography>
                        <Typography variant="body2" sx={{ fontSize: '0.78rem', wordBreak: 'break-word' }}>
                          {bank.latest_pdf_filename}
                          {bank.latest_pdf_processed ? (
                            <CheckCircle color="success" fontSize="inherit" sx={{ ml: 0.5, verticalAlign: 'middle' }} />
                          ) : (
                            <Warning color="warning" fontSize="inherit" sx={{ ml: 0.5, verticalAlign: 'middle' }} />
                          )}
                        </Typography>
                      </>
                    )}

                    <Divider sx={{ my: 1.5 }} />

                    <Box>
                      <Typography variant="caption" color="text.secondary">Expected Next Statement</Typography>
                      <Typography variant="body2" fontWeight={600} color={ns.color + '.main'}>
                        {fmtDate(bank.expected_next_statement)}
                      </Typography>
                      {bank.days_until_next != null && (
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, Math.max(0, ((30 - bank.days_until_next) / 30) * 100))}
                          color={ns.color === 'default' ? 'inherit' : ns.color}
                          sx={{ mt: 0.5, borderRadius: 1 }}
                        />
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* ── Compact table view ── */}
      {!loading && banks.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>All Banks — Statement Status Table</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Bank</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Statements</TableCell>
                  <TableCell>Transactions</TableCell>
                  <TableCell>Last Received</TableCell>
                  <TableCell>Period End</TableCell>
                  <TableCell>Expected Next</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {banks.map((bank) => {
                  const ns = nextStatementStatus(bank.days_until_next);
                  return (
                    <TableRow key={bank.bank_id} hover>
                      <TableCell>{bank.bank_name}</TableCell>
                      <TableCell><Chip label={bank.bank_type} size="small" variant="outlined" /></TableCell>
                      <TableCell>{bank.total_statements}</TableCell>
                      <TableCell>{bank.total_transactions?.toLocaleString()}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(bank.latest_received_date)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(bank.latest_statement_period_end)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(bank.expected_next_statement)}</TableCell>
                      <TableCell><Chip label={ns.label} size="small" color={ns.color} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{currencyFmt(bank.current_balance)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Container>
  );
}
