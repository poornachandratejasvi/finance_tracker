import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Container, Box, Typography, Paper, Tabs, Tab, Grid,
  TextField, Button, Alert, CircularProgress, Chip,
  FormControl, InputLabel, Select, MenuItem, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Switch, FormControlLabel, Slider, Tooltip,
  InputAdornment, Checkbox, LinearProgress,
} from '@mui/material';
import {
  Send, Download, Refresh,
  Add, Delete, Schedule, NotificationsActive, AccountBalance,
  SelectAll, Deselect, TaskAlt,
} from '@mui/icons-material';
import { getBanks, emailLatestBankCSV, generateAllCSV, startSync, syncAlertsNow } from '../services/api';
import api from '../services/api';
import { useActivity } from '../contexts/ActivityContext';
import WatchersPanel from '../components/settings/WatchersPanel.jsx';

function TabPanel({ children, value, index }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

const CATEGORIES = [
  'Food & Dining', 'Shopping', 'Transportation', 'Bills & Utilities',
  'Entertainment', 'Healthcare', 'Transfer', 'ATM Withdrawal', 'Others',
];

const FREQUENCIES = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'every4h', label: 'Every 4 hours' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const TAB_KEYS = ['sync', 'csv', 'budget-alerts', 'discord', 'reminders'];

export default function Automation() {
  const location = useLocation();
  const [tab, setTab] = useState(() => {
    const key = new URLSearchParams(location.search).get('tab');
    const idx = TAB_KEYS.indexOf(key);
    return idx === -1 ? 0 : idx;
  });
  const { addJob, updateJob, refresh: refreshActivity } = useActivity();

  // ── Banks ──────────────────────────────────────────────────────────────
  const [banks, setBanks] = useState([]);
  const [banksLoading, setBanksLoading] = useState(true);

  // ── Scheduled Sync ─────────────────────────────────────────────────────
  const [schedule, setSchedule] = useState({
    enabled: false, frequency: 'daily', hour: 9, day_of_week: 1,
    notify_on_completion: true, auto_generate_csv: false, csv_email_on_sync: false,
  });
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // ── CSV Export ─────────────────────────────────────────────────────────
  const [selectedBankId, setSelectedBankId] = useState('');
  const [recipientEmails, setRecipientEmails] = useState(['']);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  // Multi-PDF selection
  const [pdfList, setPdfList] = useState([]);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [selectedPdfIds, setSelectedPdfIds] = useState(new Set());
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkProgress, setBulkProgress] = useState(null); // { done, total }
  const [downloading, setDownloading] = useState(false);

  // ── Budget Alerts ──────────────────────────────────────────────────────
  const [budgets, setBudgets] = useState([]);
  const [alertEmail, setAlertEmail] = useState('');
  const [discordAlerts, setDiscordAlerts] = useState(true);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [newBudgetCat, setNewBudgetCat] = useState('Food & Dining');
  const [newBudgetLimit, setNewBudgetLimit] = useState('');

  // ── Discord ────────────────────────────────────────────────────────────
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSaved, setWebhookSaved] = useState(false);

  // ── Other notification services (Apprise) ─────────────────────────────
  const [notifyUrlsText, setNotifyUrlsText] = useState('');
  const [notifyUrlsLoading, setNotifyUrlsLoading] = useState(false);
  const [notifyUrlsSaved, setNotifyUrlsSaved] = useState(false);
  const [notifyUrlsStatus, setNotifyUrlsStatus] = useState(null);

  // ── Job History ────────────────────────────────────────────────────────
  const [serverJobs, setServerJobs] = useState([]);
  const [serverJobsLoading, setServerJobsLoading] = useState(false);

  useEffect(() => {
    fetchBanks();
    fetchWebhook();
    fetchNotifyUrls();
    fetchSchedule();
    fetchBudgets();
    fetchServerJobs();
  }, []);

  const fetchBanks = async () => {
    setBanksLoading(true);
    try {
      const data = await getBanks();
      setBanks(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0) {
        setSelectedBankId(data[0].id);
      }
    } catch (_) {}
    finally { setBanksLoading(false); }
  };

  const fetchPdfs = useCallback(async (bankId) => {
    if (!bankId) return;
    setPdfLoading(true);
    setSelectedPdfIds(new Set());
    setBulkResult(null);
    try {
      const resp = await api.get('/api/pdfs/', { params: { bank_id: bankId, limit: 200 } });
      setPdfList(resp.data?.items || []);
    } catch (_) {
      setPdfList([]);
    } finally {
      setPdfLoading(false);
    }
  }, []);

  const fetchWebhook = async () => {
    try {
      const resp = await api.get('/api/settings/discord-webhook');
      setWebhookUrl(resp.data.webhook_url || '');
    } catch (_) {}
  };

  const fetchNotifyUrls = async () => {
    try {
      const resp = await api.get('/api/settings/notify-urls');
      setNotifyUrlsText((resp.data.urls || []).join('\n'));
    } catch (_) {}
  };

  const fetchSchedule = async () => {
    try {
      const resp = await api.get('/api/settings/schedule');
      setSchedule(resp.data);
    } catch (_) {}
  };

  const fetchBudgets = async () => {
    try {
      const resp = await api.get('/api/settings/budgets');
      setBudgets(resp.data.budgets || []);
      setAlertEmail(resp.data.alert_email || '');
      setDiscordAlerts(resp.data.discord_alerts !== false);
    } catch (_) {}
  };

  const fetchServerJobs = async () => {
    setServerJobsLoading(true);
    try {
      const resp = await api.get('/api/sync/recent?limit=20');
      setServerJobs(resp.data || []);
    } catch (_) {}
    finally { setServerJobsLoading(false); }
  };

  const selectedBank = banks.find((b) => b.id === selectedBankId);

  // Load PDFs whenever bank changes
  useEffect(() => {
    if (selectedBankId) fetchPdfs(selectedBankId);
  }, [selectedBankId, fetchPdfs]);

  // ── Scheduled Sync handlers ────────────────────────────────────────────
  const handleSaveSchedule = async () => {
    setScheduleLoading(true);
    try {
      await api.post('/api/settings/schedule', schedule);
      setScheduleSaved(true);
      setTimeout(() => setScheduleSaved(false), 3000);
    } catch (_) {} finally { setScheduleLoading(false); }
  };

  const handleManualSync = async () => {
    const jobId = `sync-${Date.now()}`;
    addJob(jobId, 'sync', 'Manual Gmail Sync');
    try {
      const data = await startSync({ sync_type: 'incremental', gmail_account_id: null });
      // The sync is only queued/processing here — leave it "running"; server polling
      // (ActivityContext → /api/sync/active) drives the real completion state.
      updateJob(jobId, { status: 'running', syncLogId: data.sync_log_id });
      refreshActivity();
    } catch (err) {
      updateJob(jobId, { status: 'failed', error: err?.response?.data?.detail || err.message });
    }
  };

  const [checkingAlerts, setCheckingAlerts] = useState(false);
  const [alertsResult, setAlertsResult] = useState(null);
  const handleCheckAlertsNow = async () => {
    setCheckingAlerts(true);
    setAlertsResult(null);
    try {
      const data = await syncAlertsNow();
      setAlertsResult({ ok: true, message: `Found ${data.created} new pending transaction${data.created === 1 ? '' : 's'}.` });
    } catch (err) {
      setAlertsResult({ ok: false, message: err?.response?.data?.detail || 'Failed to check for new alerts.' });
    } finally {
      setCheckingAlerts(false);
    }
  };

  // ── CSV Export handlers ────────────────────────────────────────────────
  const handleSendCSV = async () => {
    if (!selectedBankId) return;
    const emails = recipientEmails.filter((e) => e.trim());
    if (emails.length === 0 && !selectedBank?.csv_email) {
      setSendResult({ success: false, error: 'Please enter at least one recipient email' });
      return;
    }
    setSending(true); setSendResult(null);
    const targets = emails.length > 0 ? emails : [selectedBank.csv_email];
    const results = [];
    for (const email of targets) {
      try {
        await emailLatestBankCSV(selectedBankId, { to_email: email });
        results.push({ email, success: true });
      } catch (err) {
        const msg = err?.response?.data?.detail || err.message;
        results.push({ email, success: false, error: msg });
      }
    }
    const allOk = results.every((r) => r.success);
    setSendResult({ success: allOk, emails: targets, results });
    setSending(false);
  };

  const handleGenerateAll = async () => {
    if (!selectedBankId) return;
    setGenerating(true); setGenerateResult(null);
    try {
      const data = await generateAllCSV(selectedBankId);
      const queued = data.queued ?? 0;
      const msg = queued > 0
        ? `Queued ${queued} PDFs for background CSV generation. Download ZIP will have all ready files.`
        : `Generated CSVs for ${data.processed ?? 0} PDFs`;
      setGenerateResult({ success: true, message: msg });
    } catch (err) {
      setGenerateResult({ success: false, error: err?.response?.data?.detail || err.message });
    } finally { setGenerating(false); }
  };

  // Generate CSV for selected PDFs one-by-one with progress, then offer download
  const handleBulkGenerate = async () => {
    const ids = [...selectedPdfIds];
    if (ids.length === 0) return;
    setBulkResult(null);
    setBulkProgress({ done: 0, total: ids.length });
    let ok = 0; let fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        await api.post(`/api/csv/pdfs/${ids[i]}/generate`);
        ok++;
      } catch (_) { fail++; }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setBulkProgress(null);
    setBulkResult({ ok, fail, total: ids.length });
  };

  // Download ZIP using axios so the JWT interceptor handles auth properly
  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const params = selectedBankId ? `?bank_id=${selectedBankId}` : '';
      const resp = await api.get(`/api/csv/pdfs/download-zip${params}`, {
        responseType: 'blob',
      });
      const cd = resp.headers['content-disposition'] || '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : 'statements.zip';
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // For blob responses the backend's JSON {detail} arrives as a Blob — read it out.
      let msg = err?.message || 'Download failed';
      try {
        const data = err?.response?.data;
        if (data instanceof Blob) {
          const parsed = JSON.parse(await data.text());
          msg = parsed.detail || msg;
        } else if (data?.detail) {
          msg = data.detail;
        }
      } catch (_) { /* keep fallback msg */ }
      setGenerateResult({ success: false, error: msg });
    } finally { setDownloading(false); }
  };

  // ── Budget handlers ────────────────────────────────────────────────────
  const handleAddBudget = () => {
    if (!newBudgetLimit || parseFloat(newBudgetLimit) <= 0) return;
    const exists = budgets.find((b) => b.category === newBudgetCat);
    if (exists) {
      setBudgets(budgets.map((b) => b.category === newBudgetCat ? { ...b, monthly_limit: parseFloat(newBudgetLimit) } : b));
    } else {
      setBudgets([...budgets, { category: newBudgetCat, monthly_limit: parseFloat(newBudgetLimit), alert_at_pct: 80 }]);
    }
    setNewBudgetLimit('');
  };

  const handleSaveBudgets = async () => {
    setBudgetLoading(true);
    try {
      await api.post('/api/settings/budgets', { budgets, alert_email: alertEmail, discord_alerts: discordAlerts });
      setBudgetSaved(true);
      setTimeout(() => setBudgetSaved(false), 3000);
    } catch (_) {} finally { setBudgetLoading(false); }
  };

  // ── Discord handlers ───────────────────────────────────────────────────
  const handleSaveWebhook = async () => {
    setWebhookLoading(true);
    try {
      await api.post('/api/settings/discord-webhook', { webhook_url: webhookUrl });
      setWebhookSaved(true); setTimeout(() => setWebhookSaved(false), 3000);
    } catch (_) {} finally { setWebhookLoading(false); }
  };

  const handleTestWebhook = async () => {
    setWebhookLoading(true); setWebhookStatus(null);
    try {
      const resp = await api.post('/api/settings/discord-webhook/test');
      setWebhookStatus({ success: true, message: resp.data?.message || 'Test sent!' });
    } catch (err) {
      setWebhookStatus({ success: false, error: err?.response?.data?.detail || err.message });
    } finally { setWebhookLoading(false); }
  };

  // ── Apprise (other services) handlers ──────────────────────────────────
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

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5 }} gutterBottom>Automation</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Schedule syncs, configure CSV email delivery, set budget alerts, and manage notification webhooks.
      </Typography>

      <Paper>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }} variant="scrollable">
          <Tab icon={<Schedule />} iconPosition="start" label="Scheduled Sync" />
          <Tab icon={<Send />} iconPosition="start" label="CSV Export & Email" />
          <Tab icon={<NotificationsActive />} iconPosition="start" label="Budget Alerts" />
          <Tab icon={<AccountBalance />} iconPosition="start" label="Discord" />
          <Tab icon={<TaskAlt />} iconPosition="start" label="Reminders" />
          <Tab label="Job History" />
        </Tabs>

        {/* ══ Tab 0: Scheduled Sync ══ */}
        <TabPanel value={tab} index={0}>
          <Box sx={{ px: 3, pb: 3 }}>
            <Typography variant="h6" gutterBottom>Scheduled Auto-Sync</Typography>

            <Grid container spacing={3}>
              <Grid item xs={12}>
                <FormControlLabel
                  control={<Switch checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />}
                  label={<Typography fontWeight={500}>Enable automatic Gmail sync</Typography>}
                />
              </Grid>

              <Grid item xs={12} md={4}>
                <FormControl fullWidth disabled={!schedule.enabled}>
                  <InputLabel>Frequency</InputLabel>
                  <Select value={schedule.frequency} label="Frequency"
                    onChange={(e) => setSchedule({ ...schedule, frequency: e.target.value })}>
                    {FREQUENCIES.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>

              {(schedule.frequency === 'daily' || schedule.frequency === 'weekly') && (
                <Grid item xs={12} md={4}>
                  <TextField fullWidth type="number" label="Hour of day (0–23)"
                    value={schedule.hour} disabled={!schedule.enabled}
                    onChange={(e) => setSchedule({ ...schedule, hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })}
                    helperText={`Sync at ${String(schedule.hour).padStart(2, '0')}:00 UTC`} />
                </Grid>
              )}

              {schedule.frequency === 'weekly' && (
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth disabled={!schedule.enabled}>
                    <InputLabel>Day of week</InputLabel>
                    <Select value={schedule.day_of_week} label="Day of week"
                      onChange={(e) => setSchedule({ ...schedule, day_of_week: e.target.value })}>
                      {['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d, i) =>
                        <MenuItem key={i+1} value={i+1}>{d}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              )}

              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>Post-sync actions</Typography>
                <FormControlLabel
                  control={<Switch checked={schedule.notify_on_completion}
                    onChange={(e) => setSchedule({ ...schedule, notify_on_completion: e.target.checked })} />}
                  label="Send Discord notification on completion" />
                <FormControlLabel
                  control={<Switch checked={schedule.auto_generate_csv}
                    onChange={(e) => setSchedule({ ...schedule, auto_generate_csv: e.target.checked })} />}
                  label="Auto-generate CSV after sync" />
                <FormControlLabel
                  control={<Switch checked={schedule.csv_email_on_sync}
                    onChange={(e) => setSchedule({ ...schedule, csv_email_on_sync: e.target.checked })} />}
                  label="Email CSV to bank's default address after sync" />
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button variant="contained" onClick={handleSaveSchedule} disabled={scheduleLoading}>
                    {scheduleSaved ? '✓ Saved' : 'Save Schedule'}
                  </Button>
                  <Button variant="outlined" onClick={handleManualSync} startIcon={<Refresh />}>
                    Run Sync Now
                  </Button>
                  <Button
                    variant="outlined" color="warning" onClick={handleCheckAlertsNow}
                    disabled={checkingAlerts}
                    startIcon={checkingAlerts ? <CircularProgress size={16} /> : <NotificationsActive />}
                  >
                    {checkingAlerts ? 'Checking…' : 'Check for New Alerts Now'}
                  </Button>
                </Box>
              </Grid>

              {alertsResult && (
                <Grid item xs={12}>
                  <Alert severity={alertsResult.ok ? 'success' : 'error'} onClose={() => setAlertsResult(null)}>
                    {alertsResult.message}
                  </Alert>
                </Grid>
              )}

              <Grid item xs={12}>
                <Alert severity="info">
                  <strong>Note:</strong> The scheduler runs automatically — saved schedules take effect within about a minute, no restart needed. Times are in UTC. You can always trigger a manual sync with "Run Sync Now", or check for new real-time
                  spend/credit alert emails (normally checked every 15 minutes) immediately with "Check for New Alerts Now".
                </Alert>
              </Grid>
            </Grid>
          </Box>
        </TabPanel>

        {/* ══ Tab 1: CSV Export & Email ══ */}
        <TabPanel value={tab} index={1}>
          <Box sx={{ px: 3, pb: 3 }}>
            {banksLoading ? <CircularProgress size={24} /> : (
              <Grid container spacing={3}>

                {/* ── Bank selector + action buttons ── */}
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <FormControl sx={{ minWidth: 220 }}>
                      <InputLabel>Select Bank</InputLabel>
                      <Select value={selectedBankId} label="Select Bank"
                        onChange={(e) => { setSelectedBankId(e.target.value); setBulkResult(null); }}>
                        {banks.map((b) => (
                          <MenuItem key={b.id} value={b.id}>
                            {b.name} <Chip label={b.bank_type} size="small" sx={{ ml: 1 }} />
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <Button variant="outlined" startIcon={<Download />} onClick={handleGenerateAll}
                      disabled={generating || !selectedBankId}>
                      {generating ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
                      Generate All CSVs (background)
                    </Button>

                    <Button variant="contained" color="success" startIcon={downloading ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <Download />}
                      onClick={handleDownloadZip} disabled={!selectedBankId || downloading}>
                      Download ZIP
                    </Button>
                  </Box>
                  {generateResult && (
                    <Box sx={{ mt: 1 }}>
                      {generateResult.success
                        ? <Alert severity="info" onClose={() => setGenerateResult(null)}>{generateResult.message}</Alert>
                        : <Alert severity="error" onClose={() => setGenerateResult(null)}>{generateResult.error}</Alert>}
                    </Box>
                  )}
                </Grid>

                <Grid item xs={12}><Divider /></Grid>

                {/* ── Multi-PDF selection table ── */}
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="h6">
                      Select PDFs to Export as CSV
                      {selectedPdfIds.size > 0 && (
                        <Chip label={`${selectedPdfIds.size} selected`} color="primary" size="small" sx={{ ml: 1 }} />
                      )}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" startIcon={<SelectAll />}
                        onClick={() => setSelectedPdfIds(new Set(pdfList.map((p) => p.id)))}>
                        Select All
                      </Button>
                      <Button size="small" startIcon={<Deselect />}
                        onClick={() => setSelectedPdfIds(new Set())} disabled={selectedPdfIds.size === 0}>
                        Clear
                      </Button>
                      <Button variant="contained" size="small" startIcon={<Download />}
                        onClick={handleBulkGenerate}
                        disabled={selectedPdfIds.size === 0 || !!bulkProgress}>
                        Export Selected ({selectedPdfIds.size})
                      </Button>
                    </Box>
                  </Box>

                  {bulkProgress && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ mb: 0.5 }}>
                        Processing {bulkProgress.done} / {bulkProgress.total}…
                      </Typography>
                      <LinearProgress variant="determinate"
                        value={Math.round((bulkProgress.done / bulkProgress.total) * 100)} />
                    </Box>
                  )}

                  {bulkResult && (
                    <Alert severity={bulkResult.fail === 0 ? 'success' : 'warning'} sx={{ mb: 1 }}
                      onClose={() => setBulkResult(null)}>
                      Done — {bulkResult.ok} CSVs generated
                      {bulkResult.fail > 0 ? `, ${bulkResult.fail} failed (password-protected or no tables)` : ''}
                      {' '}&nbsp;
                      <Button size="small" variant="outlined" startIcon={<Download />}
                        onClick={handleDownloadZip} disabled={downloading}>
                        {downloading ? 'Downloading…' : 'Download ZIP'}
                      </Button>
                    </Alert>
                  )}

                  {pdfLoading ? <CircularProgress size={24} /> : (
                    <TableContainer sx={{ maxHeight: 400 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                indeterminate={selectedPdfIds.size > 0 && selectedPdfIds.size < pdfList.length}
                                checked={pdfList.length > 0 && selectedPdfIds.size === pdfList.length}
                                onChange={(e) => setSelectedPdfIds(e.target.checked ? new Set(pdfList.map((p) => p.id)) : new Set())}
                              />
                            </TableCell>
                            <TableCell>File</TableCell>
                            <TableCell>Date</TableCell>
                            <TableCell>Transactions</TableCell>
                            <TableCell>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {pdfList.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} align="center">
                                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                                  No PDFs found for this bank
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ) : pdfList.map((pdf) => (
                            <TableRow key={pdf.id} hover selected={selectedPdfIds.has(pdf.id)}
                              onClick={() => setSelectedPdfIds((prev) => {
                                const next = new Set(prev);
                                next.has(pdf.id) ? next.delete(pdf.id) : next.add(pdf.id);
                                return next;
                              })}
                              sx={{ cursor: 'pointer' }}>
                              <TableCell padding="checkbox">
                                <Checkbox checked={selectedPdfIds.has(pdf.id)}
                                  onChange={() => {}} onClick={(e) => e.stopPropagation()} />
                              </TableCell>
                              <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <Typography variant="body2" noWrap title={pdf.file_name}>{pdf.file_name}</Typography>
                                {pdf.email_subject && (
                                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                                    {pdf.email_subject}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {pdf.created_at ? new Date(pdf.created_at).toLocaleDateString() : '—'}
                              </TableCell>
                              <TableCell>{pdf.transaction_count ?? 0}</TableCell>
                              <TableCell>
                                {pdf.is_processed
                                  ? <Chip label="Processed" size="small" color="success" />
                                  : pdf.is_password_protected
                                    ? <Chip label="Locked" size="small" color="warning" />
                                    : <Chip label="Pending" size="small" />}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Grid>

                <Grid item xs={12}><Divider /></Grid>

                {/* ── Email CSV ── */}
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom>Email Latest CSV</Typography>
                </Grid>
                <Grid item xs={12} md={5}>
                  <Typography variant="subtitle2" gutterBottom>Recipient Emails</Typography>
                  {selectedBank?.csv_email && (
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                      Bank default: {selectedBank.csv_email}
                    </Typography>
                  )}
                  {recipientEmails.map((email, idx) => (
                    <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <TextField size="small" fullWidth type="email"
                        placeholder={idx === 0 ? selectedBank?.csv_email || 'Email address' : 'Additional recipient'}
                        value={email} onChange={(e) => {
                          const updated = [...recipientEmails];
                          updated[idx] = e.target.value;
                          setRecipientEmails(updated);
                        }} />
                      {recipientEmails.length > 1 && (
                        <IconButton size="small" onClick={() => setRecipientEmails(recipientEmails.filter((_, i) => i !== idx))}>
                          <Delete fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  ))}
                  <Button size="small" startIcon={<Add />}
                    onClick={() => setRecipientEmails([...recipientEmails, ''])}>
                    Add recipient
                  </Button>
                </Grid>
                <Grid item xs={12} md={3}>
                  <Button variant="contained" startIcon={<Send />} onClick={handleSendCSV}
                    disabled={sending || !selectedBankId} fullWidth>
                    {sending ? <CircularProgress size={20} /> : 'Send Latest CSV'}
                  </Button>
                </Grid>
                {sendResult && (
                  <Grid item xs={12}>
                    {sendResult.success
                      ? <Alert severity="success">✓ CSV sent to: {sendResult.emails?.join(', ')}</Alert>
                      : <Alert severity="error">
                          {sendResult.results?.map((r, i) => (
                            <div key={i}>{r.email}: {r.success ? '✓' : `✗ ${r.error}`}</div>
                          ))}
                        </Alert>}
                  </Grid>
                )}

              </Grid>
            )}
          </Box>
        </TabPanel>

        {/* ══ Tab 2: Budget Alerts ══ */}
        <TabPanel value={tab} index={2}>
          <Box sx={{ px: 3, pb: 3 }}>
            <Typography variant="h6" gutterBottom>Monthly Budget Limits & Alerts</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Set spending limits per category. You'll be alerted when you approach or exceed the limit.
            </Typography>

            {/* Add new budget row */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>Category</InputLabel>
                  <Select value={newBudgetCat} label="Category" onChange={(e) => setNewBudgetCat(e.target.value)}>
                    {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField size="small" fullWidth type="number" label="Monthly limit (₹)"
                  value={newBudgetLimit} onChange={(e) => setNewBudgetLimit(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
              </Grid>
              <Grid item xs={12} md={4}>
                <Button variant="outlined" startIcon={<Add />} onClick={handleAddBudget}
                  disabled={!newBudgetLimit}>
                  Add / Update
                </Button>
              </Grid>
            </Grid>

            {/* Budget list */}
            {budgets.length > 0 ? (
              <TableContainer sx={{ mb: 3 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Category</TableCell>
                      <TableCell>Monthly Limit</TableCell>
                      <TableCell>Alert at %</TableCell>
                      <TableCell align="right">Remove</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {budgets.map((b, idx) => (
                      <TableRow key={b.category}>
                        <TableCell>{b.category}</TableCell>
                        <TableCell>₹{b.monthly_limit.toLocaleString()}</TableCell>
                        <TableCell>
                          <Box sx={{ width: 120 }}>
                            <Slider size="small" min={50} max={100} value={b.alert_at_pct}
                              onChange={(_, v) => {
                                const updated = [...budgets];
                                updated[idx] = { ...b, alert_at_pct: v };
                                setBudgets(updated);
                              }}
                              valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}%`} />
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <IconButton size="small" onClick={() => setBudgets(budgets.filter((_, i) => i !== idx))}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info" sx={{ mb: 3 }}>No budgets set yet. Add one above.</Alert>
            )}

            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" gutterBottom>Alert Delivery</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField fullWidth size="small" label="Alert email address" type="email"
                  value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)}
                  helperText="Leave blank to skip email alerts" />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={<Switch checked={discordAlerts} onChange={(e) => setDiscordAlerts(e.target.checked)} />}
                  label="Discord alerts when budget is exceeded" />
              </Grid>
              <Grid item xs={12}>
                <Button variant="contained" onClick={handleSaveBudgets} disabled={budgetLoading}>
                  {budgetSaved ? '✓ Saved' : 'Save Budgets'}
                </Button>
              </Grid>
            </Grid>
          </Box>
        </TabPanel>

        {/* ══ Tab 3: Discord ══ */}
        <TabPanel value={tab} index={3}>
          <Box sx={{ px: 3, pb: 3 }}>
            <Typography variant="h6" gutterBottom>Discord Webhook Notifications</Typography>
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} md={8}>
                <TextField fullWidth label="Discord Webhook URL" value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  helperText="Create a webhook in Discord: Channel settings → Integrations → Webhooks" />
              </Grid>
              <Grid item xs={12} md={4}>
                <Box display="flex" gap={1}>
                  <Button variant="contained" onClick={handleSaveWebhook} disabled={webhookLoading || !webhookUrl}>
                    {webhookSaved ? '✓ Saved' : 'Save'}
                  </Button>
                  <Button variant="outlined" onClick={handleTestWebhook} disabled={webhookLoading || !webhookUrl}>Test</Button>
                </Box>
              </Grid>
              {webhookStatus && (
                <Grid item xs={12}>
                  {webhookStatus.success
                    ? <Alert severity="success">{webhookStatus.message}</Alert>
                    : <Alert severity="error">{webhookStatus.error}</Alert>}
                </Grid>
              )}
            </Grid>

            <Divider sx={{ my: 3 }} />
            <Typography variant="h6" gutterBottom>Other Notification Services</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Powered by <a href="https://github.com/caronc/apprise" target="_blank" rel="noreferrer">Apprise</a> —
              add one service URL per line (Telegram, Slack, email, ntfy, Pushover, and 100+ others). This also
              covers plain custom webhooks: use <code>json://host/path</code> (or <code>jsons://</code> for https)
              to POST a JSON payload to an n8n webhook trigger or Home Assistant automation, so you can flash
              lights, send a phone push, or run any automation you want off these events. Every notification
              below (budget alerts, upcoming bill/subscription renewals, rule matches, sync events, reward-point
              expiry) goes to these plus the Discord webhook above.
            </Typography>
            <Grid container spacing={2} alignItems="flex-start">
              <Grid item xs={12} md={8}>
                <TextField fullWidth multiline minRows={3} label="Apprise service URLs (one per line)"
                  value={notifyUrlsText} onChange={(e) => setNotifyUrlsText(e.target.value)}
                  placeholder={'tgram://bottoken/ChatID\nmailto://user:pass@gmail.com\nntfy://topic\njsons://n8n.home.lan/webhook/finance-tracker'}
                  helperText={<>See the <a href="https://github.com/caronc/apprise#popular-notification-services" target="_blank" rel="noreferrer">full service list</a> for URL formats, or <a href="https://github.com/caronc/apprise/wiki/Notify_json" target="_blank" rel="noreferrer">Custom JSON</a> for a generic webhook (n8n, Home Assistant, ...).</>} />
              </Grid>
              <Grid item xs={12} md={4}>
                <Box display="flex" gap={1}>
                  <Button variant="contained" onClick={handleSaveNotifyUrls} disabled={notifyUrlsLoading}>
                    {notifyUrlsSaved ? '✓ Saved' : 'Save'}
                  </Button>
                  <Button variant="outlined" onClick={handleTestNotifyUrls} disabled={notifyUrlsLoading}>Test</Button>
                </Box>
              </Grid>
              {notifyUrlsStatus && (
                <Grid item xs={12}>
                  {notifyUrlsStatus.success
                    ? <Alert severity="success">{notifyUrlsStatus.message}</Alert>
                    : <Alert severity="error">{notifyUrlsStatus.error}</Alert>}
                </Grid>
              )}
            </Grid>

            <Divider sx={{ my: 3 }} />
            <Typography variant="h6" gutterBottom>Notification Events</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Event</TableCell><TableCell>Trigger</TableCell><TableCell>Colour</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    { event: '✅ Sync Completed', trigger: 'New transactions found after Gmail sync', color: 'Green' },
                    { event: '❌ Sync Failed', trigger: 'Unhandled exception during sync', color: 'Red' },
                    { event: '⚠️ PDF Parse Failed', trigger: 'PDF could not be parsed', color: 'Yellow' },
                    { event: '📊 New Data', trigger: 'New transactions added to DB', color: 'Green' },
                    { event: '💰 Budget Alert', trigger: 'Category spending exceeds threshold', color: 'Orange' },
                  ].map((row) => (
                    <TableRow key={row.event}>
                      <TableCell>{row.event}</TableCell>
                      <TableCell>{row.trigger}</TableCell>
                      <TableCell><Chip label={row.color} size="small" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </TabPanel>

        {/* ══ Tab 4: Reminders (transaction watchers → Google Tasks) ══ */}
        <TabPanel value={tab} index={4}>
          <Box sx={{ px: 3, pb: 3 }}>
            <WatchersPanel />
          </Box>
        </TabPanel>

        {/* ══ Tab 5: Job History ══ */}
        <TabPanel value={tab} index={5}>
          <Box sx={{ px: 3, pb: 3 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6">Job History (last 20 syncs)</Typography>
              <Tooltip title="Refresh from server">
                <IconButton onClick={fetchServerJobs} disabled={serverJobsLoading}>
                  {serverJobsLoading ? <CircularProgress size={20} /> : <Refresh />}
                </IconButton>
              </Tooltip>
            </Box>
            {serverJobs.length === 0 ? (
              <Alert severity="info">No sync jobs found.</Alert>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell><TableCell>Type</TableCell><TableCell>Status</TableCell>
                      <TableCell>Emails</TableCell><TableCell>Txns</TableCell>
                      <TableCell>Started</TableCell><TableCell>Completed</TableCell><TableCell>Error</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {serverJobs.map((j) => (
                      <TableRow key={j.sync_log_id}>
                        <TableCell>#{j.sync_log_id}</TableCell>
                        <TableCell>{j.sync_type}</TableCell>
                        <TableCell>
                          <Chip label={j.status}
                            color={j.status === 'success' ? 'success' : j.status === 'failed' ? 'error' : 'warning'}
                            size="small" />
                        </TableCell>
                        <TableCell>{j.emails_processed}</TableCell>
                        <TableCell>{j.transactions_added}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {j.started_at ? new Date(j.started_at).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {j.completed_at ? new Date(j.completed_at).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {j.error_message || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </TabPanel>
      </Paper>
    </Container>
  );
}
