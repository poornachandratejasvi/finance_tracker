import React, { useCallback, useEffect, useState } from 'react';
import {
  Paper, Box, Typography, Table, TableHead, TableRow, TableCell, TableBody,
  TableContainer, IconButton, Tooltip, CircularProgress, Alert, Button, Snackbar,
} from '@mui/material';
import { AutoAwesome, Refresh, Add } from '@mui/icons-material';
import { detectRecurringTransactions, createWatcher } from '../services/api';

const apiError = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return fallback;
};

export default function RecurringTransactionsCard() {
  const [detected, setDetected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingIdx, setCreatingIdx] = useState(null);
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDetected(await detectRecurringTransactions());
    } catch (e) {
      setError(apiError(e, 'Failed to scan for recurring transactions'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreateWatcher = async (pattern, idx) => {
    setCreatingIdx(idx);
    try {
      const name = pattern.suggested_keywords[0] || pattern.signature || 'Recurring transaction';
      await createWatcher({
        name,
        match_keywords: pattern.suggested_keywords || [],
        match_amount: pattern.amount,
        frequency: pattern.frequency || 'monthly',
        is_active: true,
      });
      setSuccess(`Watcher "${name}" created — manage it in Automation → Reminders`);
      setDetected((prev) => prev.filter((_, i) => i !== idx));
    } catch (e) {
      setError(apiError(e, 'Failed to create watcher'));
    } finally {
      setCreatingIdx(null);
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesome fontSize="small" color="primary" /> Detected Recurring Transactions
        </Typography>
        <Tooltip title="Re-scan transaction history">
          <span>
            <IconButton size="small" onClick={load} disabled={loading}>
              {loading ? <CircularProgress size={18} /> : <Refresh fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Subscriptions, standing instructions, and regular transfers found by scanning your
        transaction history. Create a watcher to get a Google Task reminder each period that
        auto-clears when the transaction shows up.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Sample description</TableCell>
              <TableCell>Account</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Frequency</TableCell>
              <TableCell>Seen</TableCell>
              <TableCell>Last</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : detected.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">
                <Typography variant="body2" color="text.secondary">No new recurring patterns found.</Typography>
              </TableCell></TableRow>
            ) : (
              detected.map((r, idx) => (
                <TableRow key={idx}>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" noWrap title={r.sample_description}>{r.sample_description}</Typography>
                  </TableCell>
                  <TableCell>{r.bank_name || '—'}</TableCell>
                  <TableCell>₹{r.amount}</TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>{r.frequency}</TableCell>
                  <TableCell>{r.occurrences}×</TableCell>
                  <TableCell>{new Date(r.last_date).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small" startIcon={creatingIdx === idx ? <CircularProgress size={14} /> : <Add />}
                      disabled={creatingIdx === idx}
                      onClick={() => handleCreateWatcher(r, idx)}
                    >
                      Create Watcher
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar
        open={!!success} autoHideDuration={4000} onClose={() => setSuccess('')}
        message={success}
      />
    </Paper>
  );
}
