import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Button, Alert, CircularProgress,
  FormControl, InputLabel, Select, MenuItem, IconButton, Tooltip,
  FormControlLabel, Switch, Grid, LinearProgress,
} from '@mui/material';
import { Refresh, ContentCopy } from '@mui/icons-material';
import { getBackendLogs, getContainerLogs, getSystemInfo } from '../../services/api';

const SOURCES = [
  { value: 'backend_app', label: 'Backend — application log' },
  { value: 'finance_tracker_backend', label: 'Container — backend' },
  { value: 'finance_tracker_frontend', label: 'Container — frontend' },
  { value: 'finance_tracker_worker', label: 'Container — worker (Celery)' },
  { value: 'finance_tracker_beat', label: 'Container — beat (scheduler)' },
  { value: 'finance_tracker_db', label: 'Container — database' },
  { value: 'finance_tracker_redis', label: 'Container — redis' },
];
const LINE_OPTIONS = [50, 100, 200, 500, 1000];

export default function LogsPanel() {
  const [source, setSource] = useState('backend_app');
  const [lines, setLines] = useState(200);
  const [logText, setLogText] = useState('');
  const [logMeta, setLogMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sysInfo, setSysInfo] = useState(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (source === 'backend_app') {
        const res = await getBackendLogs(lines);
        setLogText(res.logs || '');
        setLogMeta({ status: res.status, source: res.source });
      } else {
        const res = await getContainerLogs(lines);
        const c = res.containers?.[source];
        setLogText(c?.logs || '');
        setLogMeta({ status: c?.status, message: c?.message });
      }
    } catch (err) {
      setError(err?.response?.status === 403
        ? 'Admin access required to view application logs.'
        : 'Failed to load logs.');
      setLogText('');
    } finally {
      setLoading(false);
    }
  }, [source, lines]);

  const fetchSysInfo = useCallback(async () => {
    try {
      setSysInfo(await getSystemInfo());
    } catch {
      /* non-fatal — the log viewer still works without system metrics */
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
  useEffect(() => { fetchSysInfo(); }, [fetchSysInfo]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => { fetchLogs(); fetchSysInfo(); }, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchLogs, fetchSysInfo]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logText || '');
    } catch {
      /* clipboard may be unavailable over plain http — non-fatal */
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Application Logs</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Live logs from the backend and each Docker service — useful for checking whether a
        scheduled sync ran, why a PDF failed to parse, or general troubleshooting. Admin only.
      </Typography>

      {sysInfo && !sysInfo.message && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[
            { label: 'CPU', value: sysInfo.cpu_percent },
            { label: 'Memory', value: sysInfo.memory_percent },
            { label: 'Disk', value: sysInfo.disk_percent },
          ].map((m) => (
            <Grid item xs={12} sm={4} key={m.label}>
              <Typography variant="caption" color="text.secondary">{m.label}</Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, Number(m.value) || 0)}
                color={Number(m.value) > 85 ? 'error' : Number(m.value) > 60 ? 'warning' : 'primary'}
                sx={{ height: 8, borderRadius: 1, mt: 0.5 }}
              />
              <Typography variant="caption" color="text.secondary">{Number(m.value ?? 0).toFixed(0)}%</Typography>
            </Grid>
          ))}
        </Grid>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel>Source</InputLabel>
          <Select value={source} label="Source" onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Lines</InputLabel>
          <Select value={lines} label="Lines" onChange={(e) => setLines(e.target.value)}>
            {LINE_OPTIONS.map((n) => (
              <MenuItem key={n} value={n}>{n}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title="Refresh now">
          <span>
            <IconButton onClick={() => { fetchLogs(); fetchSysInfo(); }} disabled={loading}>
              <Refresh />
            </IconButton>
          </span>
        </Tooltip>
        <FormControlLabel
          control={<Switch checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />}
          label="Auto-refresh (10s)"
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" startIcon={<ContentCopy />} onClick={handleCopy} disabled={!logText}>
          Copy
        </Button>
      </Box>

      {logMeta?.status && logMeta.status !== 'success' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {logMeta.status === 'not_configured' && 'No logs available yet for this source.'}
          {logMeta.status === 'docker_not_found' && "The docker CLI isn't available inside this container, so container logs can't be read from here."}
          {logMeta.status === 'timeout' && 'Timed out reading logs from this container.'}
          {logMeta.status === 'error' && (logMeta.message || 'Failed to read logs.')}
        </Alert>
      )}

      <Box
        sx={{
          bgcolor: 'grey.900',
          color: 'grey.100',
          fontFamily: 'monospace',
          fontSize: 12.5,
          p: 2,
          borderRadius: 1,
          height: 480,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          position: 'relative',
        }}
      >
        {loading && !logText ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} sx={{ color: 'grey.100' }} />
          </Box>
        ) : (
          logText || 'No log output.'
        )}
      </Box>
    </Paper>
  );
}
