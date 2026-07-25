import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Alert, Chip, Divider, Link, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  TextField, MenuItem, FormControlLabel, Switch, CircularProgress, Tooltip,
} from '@mui/material';
import {
  CloudDone, CloudOff, CloudUpload, Backup as BackupIcon, Save, Download, Refresh, LinkOff,
} from '@mui/icons-material';
import {
  getBackupStatus, runBackup, getBackupHistory, getBackupConfig,
  saveBackupConfig, disconnectDrive, downloadBackup,
  getGoogleClientId, runBackupWithDriveToken,
} from '../../services/api';
import { requestAccessToken } from '../../utils/googleGis';
import { formatDate } from '../../utils/format';

const FREQUENCIES = ['hourly', 'daily', 'weekly'];

// Human-readable byte size (1024-based).
const humanSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const destLabel = (d) => (d === 'drive' ? 'Google Drive' : 'Local');

const apiError = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return fallback;
};

export default function BackupPanel() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [config, setConfig] = useState({ enabled: false, frequency: 'daily', destination: 'local' });
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [runDest, setRunDest] = useState('local');
  const [running, setRunning] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [driveBackingUp, setDriveBackingUp] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const connected = !!status?.drive_connected;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [st, hist, cfg] = await Promise.all([
        getBackupStatus(),
        getBackupHistory().catch(() => []),
        getBackupConfig().catch(() => null),
      ]);
      setStatus(st);
      setHistory(Array.isArray(hist) ? hist : []);
      const mergedCfg = cfg || st?.config || { enabled: false, frequency: 'daily', destination: 'local' };
      setConfig({
        enabled: !!mergedCfg.enabled,
        frequency: mergedCfg.frequency || 'daily',
        destination: mergedCfg.destination || 'local',
      });
      // Default the "backup now" destination to whatever is usable.
      setRunDest(st?.drive_connected ? (mergedCfg.destination || 'local') : 'local');
    } catch (e) {
      setError(apiError(e, 'Failed to load backup status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Client-ID-only manual Drive backup: get a Drive access token in the browser
  // (GIS) and let the server upload the snapshot with it. No secret / credentials.json.
  const handleDriveTokenBackup = async () => {
    setDriveBackingUp(true);
    setError('');
    setSuccess('');
    try {
      const { client_id, configured } = await getGoogleClientId();
      if (!configured || !client_id) {
        setError('Google is not configured. Set GOOGLE_CLIENT_ID on the server (Settings → AI / env).');
        return;
      }
      const token = await requestAccessToken(client_id, 'https://www.googleapis.com/auth/drive.file');
      const entry = await runBackupWithDriveToken(token);
      setSuccess(`Backed up to Google Drive (${humanSize(entry?.size)}).`);
      await load();
    } catch (e) {
      setError(apiError(e, e?.message || 'Google Drive backup failed.'));
    } finally {
      setDriveBackingUp(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError('');
    try {
      await disconnectDrive();
      setSuccess('Google Drive disconnected.');
      await load();
    } catch (e) {
      setError(apiError(e, 'Could not disconnect Google Drive.'));
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const entry = await runBackup({ destination: runDest });
      const where = destLabel(entry?.destination || runDest);
      if (runDest === 'drive' && entry?.destination !== 'drive') {
        setSuccess(`Backup created locally (${humanSize(entry?.size)}). Drive upload was skipped or failed — kept a local copy.`);
      } else {
        setSuccess(`Backup created to ${where} (${humanSize(entry?.size)}).`);
      }
      await load();
    } catch (e) {
      setError(apiError(e, 'Backup failed.'));
    } finally {
      setRunning(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingCfg(true);
    setError('');
    setSuccess('');
    try {
      const saved = await saveBackupConfig({
        enabled: config.enabled,
        frequency: config.frequency,
        destination: config.destination,
      });
      setConfig({
        enabled: !!saved.enabled,
        frequency: saved.frequency || 'daily',
        destination: saved.destination || 'local',
      });
      setSuccess('Backup schedule saved.');
    } catch (e) {
      setError(apiError(e, 'Could not save backup schedule.'));
    } finally {
      setSavingCfg(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h6">Backup</Typography>
          <Typography variant="body2" color="text.secondary">
            Snapshot your data locally or to Google Drive.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton onClick={load}><Refresh /></IconButton>
        </Tooltip>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Google Drive connection status */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {connected
            ? <CloudDone color="primary" sx={{ fontSize: 40 }} />
            : <CloudOff color="disabled" sx={{ fontSize: 40 }} />}
          <Box sx={{ flexGrow: 1, minWidth: 180 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Google Drive</Typography>
              <Chip
                size="small"
                label={connected ? 'Connected' : 'Not connected'}
                color={connected ? 'success' : 'default'}
                variant={connected ? 'filled' : 'outlined'}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Back up to your Google Drive with one click — sign in with Google (Client ID only).
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained" color="primary"
              startIcon={driveBackingUp ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
              disabled={driveBackingUp} onClick={handleDriveTokenBackup}
            >
              {driveBackingUp ? 'Uploading…' : 'Back up to Google Drive'}
            </Button>
            {connected && (
              <Button
                variant="outlined" color="error" startIcon={<LinkOff />}
                disabled={disconnecting} onClick={handleDisconnect}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
          </Stack>
        </Box>
        <Alert severity="info" icon={false} sx={{ mt: 2 }}>
          Manual Drive backup uses "Sign in with Google" (your public Client ID only — no
          <code> credentials.json</code>). You'll grant Drive access, then this snapshot uploads
          to a <strong>FinanceTrackerBackups</strong> folder. Automatic/scheduled Drive uploads
          need offline access (advanced); otherwise scheduled backups run locally.
        </Alert>
      </Paper>

      {/* Backup now */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Backup now</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <TextField
            label="Destination" select size="small" value={runDest}
            onChange={(e) => setRunDest(e.target.value)} sx={{ minWidth: 200 }}
          >
            <MenuItem value="local">Local</MenuItem>
            <MenuItem value="drive" disabled={!connected}>
              Google Drive{!connected ? ' (connect first)' : ''}
            </MenuItem>
          </TextField>
          <Button
            variant="contained" color="primary"
            startIcon={running ? <CircularProgress size={16} color="inherit" /> : <BackupIcon />}
            disabled={running} onClick={handleRun}
          >
            {running ? 'Backing up…' : 'Backup now'}
          </Button>
          {status?.last_backup?.created_at && (
            <Typography variant="body2" color="text.secondary">
              Last backup: {formatDate(status.last_backup.created_at)} ({destLabel(status.last_backup.destination)})
            </Typography>
          )}
        </Stack>
      </Paper>

      {/* Schedule / config */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Automatic backups</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={config.enabled}
              onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
            />
          }
          label="Enable automatic backups"
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1.5 }}>
          <TextField
            label="Frequency" select size="small" value={config.frequency}
            disabled={!config.enabled} sx={{ minWidth: 180 }}
            onChange={(e) => setConfig((c) => ({ ...c, frequency: e.target.value }))}
          >
            {FREQUENCIES.map((f) => (
              <MenuItem key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Destination" select size="small" value={config.destination}
            disabled={!config.enabled} sx={{ minWidth: 200 }}
            onChange={(e) => setConfig((c) => ({ ...c, destination: e.target.value }))}
          >
            <MenuItem value="local">Local</MenuItem>
            <MenuItem value="drive" disabled={!connected}>
              Google Drive{!connected ? ' (connect first)' : ''}
            </MenuItem>
          </TextField>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Button
          variant="contained" color="primary"
          startIcon={savingCfg ? <CircularProgress size={16} color="inherit" /> : <Save />}
          disabled={savingCfg} onClick={handleSaveConfig}
        >
          {savingCfg ? 'Saving…' : 'Save schedule'}
        </Button>
      </Paper>

      {/* History */}
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Backup history</Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>File</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Destination</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Download</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No backups yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : history.map((h, idx) => {
                const isLocal = (h.destination || 'local') === 'local';
                return (
                  <TableRow key={`${h.filename}-${idx}`} hover>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{h.filename}</TableCell>
                    <TableCell>{humanSize(h.size)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small" label={destLabel(h.destination)}
                        color={h.destination === 'drive' ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{formatDate(h.created_at)}</TableCell>
                    <TableCell align="right">
                      {isLocal ? (
                        <Tooltip title="Download backup">
                          <IconButton
                            size="small"
                            onClick={() => downloadBackup(h.filename).catch(() => {})}
                          >
                            <Download fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">On Drive</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
