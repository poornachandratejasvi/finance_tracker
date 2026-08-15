import React, { useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, Chip, LinearProgress, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress, Tooltip, IconButton,
} from '@mui/material';
import { Refresh, PlayArrow, ClearAll } from '@mui/icons-material';
import { useActivity } from '../contexts/ActivityContext';
import { startSync, clearStuckSyncs } from '../services/api';

const statusColor = (s) => ({
  processing: 'warning', queued: 'info', success: 'success', partial: 'warning', failed: 'error',
}[s] || 'default');

const fmt = (iso) => {
  if (!iso) return '—';
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const pct = (s) => (s.total_emails > 0 ? Math.min(100, Math.round((100 * (s.processed_emails || 0)) / s.total_emails)) : null);

export default function Jobs() {
  const { recentSyncs = [], activeSyncs = [], runningCount, refresh } = useActivity();
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [starting, setStarting] = useState(false);

  const runSync = async () => {
    setErr(''); setMsg(''); setStarting(true);
    try {
      const res = await startSync({ sync_type: 'incremental', gmail_account_id: null });
      setMsg(`Sync started (job #${res.sync_log_id || '?'}, status ${res.status || 'processing'}).`);
      setTimeout(refresh, 500);
    } catch (e) {
      setErr(e?.response?.data?.detail ? String(e.response.data.detail) : 'Failed to start sync');
    } finally {
      setStarting(false);
    }
  };

  const clearStuck = async () => {
    if (!window.confirm('Mark all in-flight jobs as failed? Use this if a job is stuck.')) return;
    setErr(''); setMsg('');
    try {
      const res = await clearStuckSyncs();
      setMsg(`Cleared ${res.cleared ?? 0} stuck job(s).`);
      setTimeout(refresh, 300);
    } catch (e) {
      setErr('Failed to clear stuck jobs');
    }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h4">Jobs & Activity</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip label={`${runningCount || 0} running`} color={runningCount > 0 ? 'warning' : 'default'} size="small" />
          <Tooltip title="Refresh"><span><IconButton onClick={refresh}><Refresh /></IconButton></span></Tooltip>
          <Button variant="outlined" color="warning" size="small" startIcon={<ClearAll />} onClick={clearStuck} disabled={(activeSyncs || []).length === 0}>
            Clear stuck
          </Button>
          <Button variant="contained" startIcon={starting ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />} onClick={runSync} disabled={starting}>
            Run Sync Now
          </Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 0.5 }}>
        Auto-refreshes every few seconds. Scheduled syncs also appear here.
      </Typography>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {/* Active jobs */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Active jobs</Typography>
        {activeSyncs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No jobs running right now.</Typography>
        ) : activeSyncs.map((s) => {
          const p = pct(s);
          return (
            <Box key={s.sync_log_id} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5, flexWrap: 'wrap' }}>
                <Chip label={s.status} size="small" color={statusColor(s.status)} />
                <Typography variant="body2">{s.sync_type || 'sync'} · #{s.sync_log_id}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {s.current_step || (s.status === 'queued' ? 'Waiting for worker…' : 'Starting…')}
                  {s.current_bank ? ` · ${s.current_bank}` : ''}
                  {s.total_emails > 0 ? ` · ${s.processed_emails || 0}/${s.total_emails} emails` : ''}
                  {s.transactions_added > 0 ? ` · ${s.transactions_added} txns` : ''}
                  {s.started_at ? ` · started ${fmt(s.started_at)}` : ''}
                </Typography>
              </Box>
              <LinearProgress variant={p === null ? 'indeterminate' : 'determinate'} value={p === null ? undefined : p} />
            </Box>
          );
        })}
      </Paper>

      {/* Recent jobs */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>Recent jobs</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>#</TableCell><TableCell>Type</TableCell><TableCell>Status</TableCell><TableCell>Account / Bank</TableCell>
              <TableCell align="right">Emails</TableCell><TableCell align="right">Txns</TableCell><TableCell align="right">Dupes</TableCell>
              <TableCell>Started</TableCell><TableCell>Completed</TableCell><TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {recentSyncs.length === 0 ? (
              <TableRow><TableCell colSpan={10}><Typography variant="body2" color="text.secondary">No jobs yet.</Typography></TableCell></TableRow>
            ) : recentSyncs.map((s) => (
              <TableRow key={s.sync_log_id}>
                <TableCell>{s.sync_log_id}</TableCell>
                <TableCell>{s.sync_type || 'sync'}</TableCell>
                <TableCell><Chip label={s.status} size="small" color={statusColor(s.status)} /></TableCell>
                <TableCell sx={{ maxWidth: 160, wordBreak: 'break-word' }}>
                  <Typography variant="caption" color="text.secondary">
                    {[s.gmail_email, s.current_bank].filter(Boolean).join(' · ') || '—'}
                  </Typography>
                </TableCell>
                <TableCell align="right">{s.emails_processed || 0}</TableCell>
                <TableCell align="right">{s.transactions_added || 0}</TableCell>
                <TableCell align="right">{s.duplicates_found || 0}</TableCell>
                <TableCell>{fmt(s.started_at)}</TableCell>
                <TableCell>{fmt(s.completed_at)}</TableCell>
                <TableCell sx={{ maxWidth: 220 }}>
                  <Typography variant="caption" color={s.error_message ? 'error' : 'text.secondary'} sx={{ wordBreak: 'break-word' }}>
                    {s.error_message ? s.error_message.slice(0, 140) : (s.current_step || '')}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Container>
  );
}
