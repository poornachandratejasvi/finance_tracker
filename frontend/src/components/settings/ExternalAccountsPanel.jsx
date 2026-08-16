import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Alert, Chip, Divider, Stack, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer,
  CircularProgress, Tooltip,
} from '@mui/material';
import {
  Email, Refresh, PlayArrow, Sync as SyncIcon, LinkOff, Add, UploadFile, CheckCircle, Forum,
} from '@mui/icons-material';
import api, {
  getGmailAccountsStatus, getGmailAuthUrl, checkGmailAccountNow, testGmailNotification,
  disconnectGmailAccount, getGoogleCredentialsStatus, uploadGoogleCredentials,
  getDiscordConfig, updateDiscordWebhook, testDiscordWebhook,
} from '../../services/api';
import { formatDate, timeAgo } from '../../utils/format';

const apiError = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return fallback;
};

const gmailStatusChip = (account) => {
  if (account.status === 'connected') return <Chip size="small" color="success" label="Active" />;
  if (account.status === 'error') return <Chip size="small" color="warning" label="Transient error" />;
  return <Chip size="small" color="error" label="Needs Reauth" />;
};

export default function ExternalAccountsPanel() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Gmail
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [checkingId, setCheckingId] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [disconnectingId, setDisconnectingId] = useState(null);

  // Google API credentials
  const [credStatus, setCredStatus] = useState(null);
  const [credUploading, setCredUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Discord
  const [discordWebhookSet, setDiscordWebhookSet] = useState(false);
  const [discordUrlInput, setDiscordUrlInput] = useState('');
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordTesting, setDiscordTesting] = useState(false);
  const [discordTestResult, setDiscordTestResult] = useState(null);

  // Other notification services (Apprise)
  const [notifyUrlsText, setNotifyUrlsText] = useState('');
  const [notifyUrlsLoading, setNotifyUrlsLoading] = useState(false);
  const [notifyUrlsSaved, setNotifyUrlsSaved] = useState(false);
  const [notifyUrlsStatus, setNotifyUrlsStatus] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, credRes, discordRes, notifyRes] = await Promise.all([
        getGmailAccountsStatus().catch(() => ({ accounts: [] })),
        getGoogleCredentialsStatus().catch(() => null),
        getDiscordConfig().catch(() => null),
        api.get('/api/settings/notify-urls').catch(() => null),
      ]);
      setAccounts(statusRes?.accounts || []);
      setCredStatus(credRes);
      setDiscordWebhookSet(!!discordRes?.webhook_set);
      setNotifyUrlsText((notifyRes?.data?.urls || []).join('\n'));
    } catch (e) {
      setError(apiError(e, 'Failed to load external accounts'));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSaveNotifyUrls = async () => {
    setNotifyUrlsLoading(true);
    try {
      const urls = notifyUrlsText.split('\n').map((u) => u.trim()).filter(Boolean);
      await api.post('/api/settings/notify-urls', { urls });
      setNotifyUrlsSaved(true); setTimeout(() => setNotifyUrlsSaved(false), 3000);
    } catch (_) {} finally { setNotifyUrlsLoading(false); }
  };

  const handleTestNotifyUrls = async () => {
    setNotifyUrlsLoading(true); setNotifyUrlsStatus(null);
    try {
      const resp = await api.post('/api/settings/notify-urls/test');
      setNotifyUrlsStatus({ success: true, message: resp.data?.message || 'Test sent!' });
    } catch (err) {
      setNotifyUrlsStatus({ success: false, error: err?.response?.data?.detail || err.message });
    } finally { setNotifyUrlsLoading(false); }
  };

  useEffect(() => { load(); }, [load]);

  const handleConnect = async () => {
    setConnecting(true);
    setError('');
    try {
      const authData = await getGmailAuthUrl();
      window.open(authData.auth_url, '_blank', 'width=600,height=700');
      setSuccess('Opening Gmail authorization in a new window. Come back and click Refresh once you finish.');
    } catch (e) {
      setError(apiError(e, 'Failed to start Gmail authorization. Ensure credentials.json is configured below.'));
    } finally {
      setConnecting(false);
    }
  };

  const handleCheckNow = async (account) => {
    setCheckingId(account.id);
    setError('');
    try {
      await checkGmailAccountNow(account.id);
      await load();
    } catch (e) {
      setError(apiError(e, 'Health check failed'));
    } finally {
      setCheckingId(null);
    }
  };

  const handleTestNotification = async (account) => {
    setTestingId(account.id);
    setTestResult(null);
    setError('');
    try {
      const res = await testGmailNotification(account.id);
      setTestResult({ email: account.email, ...res.result });
    } catch (e) {
      setError(apiError(e, 'Failed to send test notification'));
    } finally {
      setTestingId(null);
    }
  };

  const handleDisconnect = async (account) => {
    if (!window.confirm(`Disconnect ${account.email}? Its synced transaction history is kept — only the connection itself is removed.`)) return;
    setDisconnectingId(account.id);
    setError('');
    try {
      await disconnectGmailAccount(account.id);
      setSuccess('Gmail account disconnected.');
      await load();
    } catch (e) {
      setError(apiError(e, 'Failed to disconnect'));
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCredUploading(true);
    setError('');
    setSuccess('');
    try {
      const res = await uploadGoogleCredentials(file);
      setSuccess(`credentials.json updated (client type: ${res.client_type}).`);
      await load();
    } catch (err) {
      setError(apiError(err, 'Upload failed — make sure this is a valid Google OAuth credentials.json.'));
    } finally {
      setCredUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveDiscordWebhook = async () => {
    setDiscordSaving(true);
    setDiscordTestResult(null);
    setError('');
    try {
      const res = await updateDiscordWebhook(discordUrlInput.trim() || null);
      setDiscordWebhookSet(!!res.webhook_set);
      setDiscordUrlInput('');
      setSuccess(res.webhook_set ? 'Discord webhook saved.' : 'Discord webhook removed.');
    } catch {
      setError('Failed to save the Discord webhook URL');
    } finally {
      setDiscordSaving(false);
    }
  };

  const handleTestDiscordWebhook = async () => {
    setDiscordTesting(true);
    setDiscordTestResult(null);
    setError('');
    try {
      const res = await testDiscordWebhook();
      setDiscordTestResult(res);
    } catch {
      setDiscordTestResult({ ok: false, message: 'Request failed.' });
    } finally {
      setDiscordTesting(false);
    }
  };

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6">External Accounts</Typography>
        <Typography variant="body2" color="text.secondary">
          Every external service this app connects to — Gmail (statement sync), Discord (alerts), and
          the underlying Google API credentials — all in one place.
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {testResult && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setTestResult(null)}>
          <strong>Test — {testResult.email}:</strong>{' '}
          {['discord', 'task'].filter((k) => testResult[k]).map((k) => `${k}: ${testResult[k]}`).join(' · ')}
        </Alert>
      )}

      {/* ── Gmail ───────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ mb: 3, p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Email color="action" />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Gmail</Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh"><IconButton size="small" onClick={load}><Refresh fontSize="small" /></IconButton></Tooltip>
            <Button
              size="small" variant="contained" startIcon={connecting ? <CircularProgress size={16} color="inherit" /> : <Add />}
              onClick={handleConnect} disabled={connecting}
            >
              Connect Gmail Account
            </Button>
          </Stack>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Connected inboxes bank statements are synced from. Health is checked automatically every
          couple hours — if a connection breaks, you'll be alerted via Discord and/or a Google Task.
        </Typography>

        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Checked</TableCell>
                <TableCell>Synced</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No Gmail accounts connected yet. Click "Connect Gmail Account" to add one.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : accounts.map((account) => (
                <TableRow key={account.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Email fontSize="small" color="action" />
                      {account.email}
                    </Box>
                    {account.last_error && (
                      <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
                        {account.last_error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{gmailStatusChip(account)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {account.last_checked_at ? timeAgo(account.last_checked_at) : 'never'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {account.last_synced ? formatDate(account.last_synced) : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Re-check this account's connection now">
                      <span>
                        <IconButton size="small" disabled={checkingId === account.id} onClick={() => handleCheckNow(account)}>
                          {checkingId === account.id ? <CircularProgress size={16} /> : <SyncIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Send a test Discord/Google-Task alert">
                      <span>
                        <IconButton size="small" color="primary" disabled={testingId === account.id} onClick={() => handleTestNotification(account)}>
                          {testingId === account.id ? <CircularProgress size={16} /> : <PlayArrow fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Disconnect this account">
                      <span>
                        <IconButton size="small" color="error" disabled={disconnectingId === account.id} onClick={() => handleDisconnect(account)}>
                          {disconnectingId === account.id ? <CircularProgress size={16} /> : <LinkOff fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* ── Discord ─────────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ mb: 3, p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Forum color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Discord</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          One webhook, used everywhere: Automatic Rules' "Notify on Discord", Notification Rules,
          sync-lifecycle alerts, and Gmail health alerts.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label={discordWebhookSet ? 'Replace webhook URL' : 'Discord webhook URL'}
            placeholder="https://discord.com/api/webhooks/..."
            value={discordUrlInput}
            onChange={(e) => setDiscordUrlInput(e.target.value)}
            sx={{ minWidth: 340, flex: 1 }}
          />
          <Button
            variant="contained" size="small"
            onClick={handleSaveDiscordWebhook}
            disabled={discordSaving || !discordUrlInput.trim()}
          >
            {discordSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="outlined" size="small"
            onClick={handleTestDiscordWebhook}
            disabled={discordTesting || !discordWebhookSet}
          >
            {discordTesting ? 'Sending…' : 'Send test message'}
          </Button>
          <Chip
            size="small"
            color={discordWebhookSet ? 'success' : 'default'}
            variant="outlined"
            label={discordWebhookSet ? 'Webhook configured' : 'Not configured'}
          />
        </Box>
        {discordTestResult && (
          <Alert severity={discordTestResult.ok ? 'success' : 'error'} sx={{ mt: 1.5 }} onClose={() => setDiscordTestResult(null)}>
            {discordTestResult.message}
          </Alert>
        )}
      </Paper>

      {/* ── Other notification services (Apprise) ───────────────────────── */}
      <Paper variant="outlined" sx={{ mb: 3, p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Forum color="action" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Other Notification Services</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Slack, Telegram, ntfy, Pushover, email, and 80+ others via{' '}
          <a href="https://github.com/caronc/apprise" target="_blank" rel="noreferrer">Apprise</a> — one URL
          per line, sent alongside the Discord webhook above to every notification this app sends.
        </Typography>
        <TextField
          fullWidth multiline minRows={2} size="small"
          placeholder={'slack://TokenA/TokenB/TokenC\ntgram://bottoken/ChatID\nmailto://user:pass@gmail.com'}
          value={notifyUrlsText}
          onChange={(e) => setNotifyUrlsText(e.target.value)}
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
          <Button variant="contained" size="small" onClick={handleSaveNotifyUrls} disabled={notifyUrlsLoading}>
            {notifyUrlsSaved ? '✓ Saved' : 'Save'}
          </Button>
          <Button variant="outlined" size="small" onClick={handleTestNotifyUrls} disabled={notifyUrlsLoading}>
            Test
          </Button>
        </Box>
        {notifyUrlsStatus && (
          <Alert severity={notifyUrlsStatus.success ? 'success' : 'error'} sx={{ mt: 1.5 }} onClose={() => setNotifyUrlsStatus(null)}>
            {notifyUrlsStatus.success ? notifyUrlsStatus.message : notifyUrlsStatus.error}
          </Alert>
        )}
      </Paper>

      {/* ── Google API credentials ──────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Google API credentials</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The <code>credentials.json</code> OAuth client used for Gmail, Drive, and Google Tasks — upload it
          here instead of copying the file onto the server by hand.
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {credStatus?.configured ? (
            <Chip
              icon={<CheckCircle />} color="success" variant="outlined"
              label={`Configured (${credStatus.client_type}, ${credStatus.client_id_preview || 'unknown client'})`}
            />
          ) : (
            <Chip color="default" variant="outlined" label="Not configured" />
          )}
          <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handleFileChosen} />
          <Button
            variant="outlined" size="small"
            startIcon={credUploading ? <CircularProgress size={16} /> : <UploadFile />}
            disabled={credUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {credStatus?.configured ? 'Replace credentials.json' : 'Upload credentials.json'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
