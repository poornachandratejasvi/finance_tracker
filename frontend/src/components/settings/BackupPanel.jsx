import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Alert, Chip, Divider, Stack,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  TextField, MenuItem, FormControlLabel, Switch, CircularProgress, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText,
} from '@mui/material';
import {
  CloudDone, CloudOff, CloudUpload, Backup as BackupIcon, Save, Download, Refresh, LinkOff,
  RestoreOutlined, UploadFile, WarningAmber,
} from '@mui/icons-material';
import {
  getBackupStatus, runBackup, getBackupHistory, getBackupConfig,
  saveBackupConfig, disconnectDrive, downloadBackup, getDriveAuthUrl, startSync,
  restoreBackup, restoreBackupUpload,
} from '../../services/api';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../contexts/AuthContext';

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

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
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [syncingAndBackingUp, setSyncingAndBackingUp] = useState(false);

  // Restore (destructive, admin-only) — confirm dialog requires typing RESTORE.
  const [restoreTarget, setRestoreTarget] = useState(null); // { filename } | { file: File }
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef(null);

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

  // Offline Drive connection: reuses the same credentials.json OAuth client as Gmail
  // (different scope grant, requested separately). This is a real, persistent
  // refresh-token connection — it can power scheduled/unattended backups, unlike a
  // browser-only sign-in. Google redirects the browser away and back via
  // /api/backup/google/callback -> /settings?drive_connected=1 (handled in Settings.js).
  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    setError('');
    try {
      const { auth_url, configured } = await getDriveAuthUrl();
      if (!configured || !auth_url) {
        setError('Google Drive is not configured (credentials.json missing on the server).');
        return;
      }
      window.location.href = auth_url;
    } catch (e) {
      setError(apiError(e, 'Could not start the Google Drive connection.'));
      setConnectingGoogle(false);
    }
  };

  const handleDriveBackup = async () => {
    setDriveBackingUp(true);
    setError('');
    setSuccess('');
    try {
      const entry = await runBackup({ destination: 'drive' });
      if (entry?.destination !== 'drive') {
        setError(entry?.error || 'Drive upload failed — kept a local copy instead.');
      } else {
        setSuccess(`Backed up to Google Drive (${humanSize(entry?.size)}).`);
      }
      await load();
    } catch (e) {
      setError(apiError(e, 'Google Drive backup failed.'));
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

  // One click: sync Gmail (existing linked account) and back up to Drive together.
  const handleSyncAndBackup = async () => {
    setSyncingAndBackingUp(true);
    setError('');
    setSuccess('');
    const results = [];
    try {
      try {
        await startSync({ gmail_account_id: null, sync_type: 'incremental' });
        results.push('Gmail sync started');
      } catch (e) {
        results.push(`Gmail sync failed: ${apiError(e, 'unknown error')}`);
      }
      try {
        const entry = await runBackup({ destination: 'drive' });
        results.push(entry?.destination === 'drive'
          ? `Drive backup done (${humanSize(entry?.size)})`
          : `Drive backup failed — kept a local copy${entry?.error ? ` (${entry.error})` : ''}`);
      } catch (e) {
        results.push(`Drive backup failed: ${apiError(e, 'unknown error')}`);
      }
      setSuccess(results.join(' · '));
      await load();
    } finally {
      setSyncingAndBackingUp(false);
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
        setError(entry?.error || 'Backup was created locally, but the Google Drive upload was skipped or failed.');
        setSuccess(`Backup created locally (${humanSize(entry?.size)}).`);
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

  const closeRestoreDialog = () => {
    if (restoring) return;
    setRestoreTarget(null);
    setRestoreConfirmText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChosen = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setRestoreTarget({ file });
      setRestoreConfirmText('');
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget || restoreConfirmText !== 'RESTORE') return;
    setRestoring(true);
    setError('');
    setSuccess('');
    try {
      const result = restoreTarget.file
        ? await restoreBackupUpload(restoreTarget.file)
        : await restoreBackup(restoreTarget.filename);
      const totalRows = Object.values(result.row_counts || {}).reduce((a, b) => a + b, 0);
      setSuccess(
        `Restore complete: ${result.tables_restored} table(s), ${totalRows} row(s) restored from the ` +
        `snapshot taken ${result.generated_at ? formatDate(result.generated_at) : 'at an earlier time'}. ` +
        `Reload the app to see the restored data.`
      );
      closeRestoreDialog();
      await load();
    } catch (e) {
      setError(apiError(e, 'Restore failed.'));
    } finally {
      setRestoring(false);
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
          <Box sx={{ flexGrow: 1, minWidth: 220 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Google Drive</Typography>
              <Chip
                size="small"
                label={connected ? 'Connected — scheduled backups enabled' : 'Not connected'}
                color={connected ? 'success' : 'default'}
                variant={connected ? 'filled' : 'outlined'}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              Reuses the same Google OAuth client as your Gmail connection (separate consent,
              Drive-file-only access). This is a real, persistent connection — it can run
              scheduled/unattended backups, not just while you're in the browser.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant={connected ? 'outlined' : 'contained'} color="primary"
              disabled={connectingGoogle} onClick={handleConnectGoogle}
            >
              {connectingGoogle ? 'Connecting…' : connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}
            </Button>
            {connected && (
              <Button
                variant="contained" color="primary"
                startIcon={syncingAndBackingUp ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
                disabled={syncingAndBackingUp} onClick={handleSyncAndBackup}
              >
                {syncingAndBackingUp ? 'Working…' : 'Sync Gmail & Backup Now'}
              </Button>
            )}
            {connected && (
              <Button
                variant="outlined" color="primary"
                startIcon={driveBackingUp ? <CircularProgress size={16} color="inherit" /> : <CloudUpload />}
                disabled={driveBackingUp} onClick={handleDriveBackup}
              >
                {driveBackingUp ? 'Uploading…' : 'Back up to Drive only'}
              </Button>
            )}
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
          "Connect Google Drive" opens Google's consent screen once; after that, both manual and
          scheduled backups upload into a <strong>FinanceTrackerBackups</strong> Drive folder with no
          further prompts. Uses the same <code>credentials.json</code> already set up for Gmail —
          nothing new to configure in Google Cloud Console. This same connection also enables the
          "Create a Google Task" channel in Settings → Notification Rules.
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

      {/* Restore from an uploaded snapshot file (admin-only, destructive) */}
      {isAdmin && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Restore</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Restore replaces the ENTIRE database (every user's data) with the contents of a
            snapshot — either from the history below or a <code>.json.gz</code> file you
            previously downloaded. This cannot be undone except by restoring another backup.
          </Typography>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gz,.json.gz,application/gzip"
            style={{ display: 'none' }}
            onChange={handleFileChosen}
          />
          <Button
            variant="outlined" color="warning" startIcon={<UploadFile />}
            onClick={() => fileInputRef.current?.click()}
          >
            Restore from uploaded file…
          </Button>
        </Paper>
      )}

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
                {isAdmin && <TableCell align="right">Restore</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5}>
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
                    {isAdmin && (
                      <TableCell align="right">
                        <Tooltip title="Restore the entire database from this backup">
                          <IconButton
                            size="small" color="warning"
                            onClick={() => { setRestoreTarget({ filename: h.filename }); setRestoreConfirmText(''); }}
                          >
                            <RestoreOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Restore confirmation dialog — type RESTORE to arm the destructive action */}
      <Dialog open={!!restoreTarget} onClose={closeRestoreDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningAmber color="warning" />
          Restore database
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This replaces ALL current data (every user, every transaction, every setting) with the
            contents of{' '}
            <strong>{restoreTarget?.filename || restoreTarget?.file?.name || 'this backup'}</strong>.
            Anything created or changed since that snapshot was taken will be lost. This cannot be
            undone except by restoring a different backup.
          </Alert>
          <DialogContentText sx={{ mb: 1 }}>
            Type <strong>RESTORE</strong> to confirm.
          </DialogContentText>
          <TextField
            fullWidth autoFocus size="small"
            value={restoreConfirmText}
            onChange={(e) => setRestoreConfirmText(e.target.value)}
            placeholder="RESTORE"
            disabled={restoring}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeRestoreDialog} disabled={restoring}>Cancel</Button>
          <Button
            variant="contained" color="warning"
            startIcon={restoring ? <CircularProgress size={16} color="inherit" /> : <RestoreOutlined />}
            disabled={restoring || restoreConfirmText !== 'RESTORE'}
            onClick={handleConfirmRestore}
          >
            {restoring ? 'Restoring…' : 'Restore database'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
