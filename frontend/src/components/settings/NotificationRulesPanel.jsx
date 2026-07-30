import React, { useState, useEffect } from 'react';
import {
  Paper,
  Box,
  Typography,
  Button,
  Divider,
  Chip,
  Alert,
  CircularProgress,
  TextField,
  Autocomplete,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { Add, Edit, Delete, NotificationsActive, PlayArrow } from '@mui/icons-material';
import {
  getNotificationRules,
  createNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  testNotificationRule,
  getBanks,
} from '../../services/api';

const TRIGGER_TYPES = [
  { value: 'match', label: 'Transaction matches keyword(s)' },
  { value: 'absence', label: 'Expected transaction is missing this month' },
];

const RECORD_TYPES = [
  { value: 'any', label: 'Any' },
  { value: 'debit', label: 'Expense' },
  { value: 'credit', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];
const recordTypeLabel = (val) => RECORD_TYPES.find((r) => r.value === val)?.label || 'Any';
const triggerTypeLabel = (val) => TRIGGER_TYPES.find((t) => t.value === val)?.label || val;

const AMOUNT_OPERATORS = [
  { value: 'none', label: 'No amount condition' },
  { value: 'eq', label: 'Equals' },
  { value: 'gte', label: 'At least (≥)' },
  { value: 'lte', label: 'At most (≤)' },
  { value: 'between', label: 'Between' },
];
const amountConditionLabel = (rule) => {
  const op = rule.amount_operator || 'none';
  if (op === 'none') return null;
  const neg = rule.amount_negate ? 'NOT ' : '';
  if (op === 'eq') return `${neg}= ${rule.amount_value}`;
  if (op === 'gte') return `${neg}≥ ${rule.amount_value}`;
  if (op === 'lte') return `${neg}≤ ${rule.amount_value}`;
  if (op === 'between') return `${neg}${rule.amount_value}–${rule.amount_value_max}`;
  return null;
};

const emptyForm = {
  name: '',
  trigger_type: 'match',
  keywords: [],
  keyword_negate: false,
  record_type: 'any',
  bank_id: '',
  amount_operator: 'none',
  amount_value: '',
  amount_value_max: '',
  amount_negate: false,
  condition_logic: 'and',
  check_day_of_month: 28,
  notify_discord: false,
  notify_email: false,
  email_to: '',
  notify_task: false,
  is_active: true,
};

export default function NotificationRulesPanel() {
  const [rules, setRules] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [kwInputValue, setKwInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  const [testingId, setTestingId] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ruleData, bankData] = await Promise.all([getNotificationRules(), getBanks()]);
      setRules(ruleData || []);
      setBanks(bankData || []);
    } catch {
      setError('Failed to load notification rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setKwInputValue('');
    setDialogOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm({
      name: rule.name || '',
      trigger_type: rule.trigger_type || 'match',
      keywords: Array.isArray(rule.keywords) ? [...rule.keywords] : [],
      keyword_negate: !!rule.keyword_negate,
      record_type: rule.record_type || 'any',
      bank_id: rule.bank_id || '',
      amount_operator: rule.amount_operator || 'none',
      amount_value: rule.amount_value ?? '',
      amount_value_max: rule.amount_value_max ?? '',
      amount_negate: !!rule.amount_negate,
      condition_logic: rule.condition_logic || 'and',
      check_day_of_month: rule.check_day_of_month || 28,
      notify_discord: !!rule.notify_discord,
      notify_email: !!rule.notify_email,
      email_to: rule.email_to || '',
      notify_task: !!rule.notify_task,
      is_active: rule.is_active !== false,
    });
    setKwInputValue('');
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const setKeywords = (list) => {
    const seen = new Set();
    const cleaned = [];
    (list || []).forEach((raw) => {
      const kw = String(raw).trim();
      if (!kw) return;
      const low = kw.toLowerCase();
      if (seen.has(low)) return;
      seen.add(low);
      cleaned.push(kw);
    });
    setForm((f) => ({ ...f, keywords: cleaned }));
  };

  const commitPendingKeyword = () => {
    const pending = kwInputValue.trim();
    if (!pending) return form.keywords;
    const already = form.keywords.some((k) => k.toLowerCase() === pending.toLowerCase());
    const next = already ? form.keywords : [...form.keywords, pending];
    setForm((f) => ({ ...f, keywords: next }));
    setKwInputValue('');
    return next;
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    const keywords = commitPendingKeyword();
    const amountOp = form.amount_operator || 'none';
    const hasAmountCondition = amountOp !== 'none';
    if (!keywords.length && !hasAmountCondition) {
      setError('Configure at least one condition: keywords or an amount condition');
      return;
    }
    if (hasAmountCondition && form.amount_value === '') {
      setError('Enter an amount value');
      return;
    }
    if (amountOp === 'between' && form.amount_value_max === '') {
      setError('Enter both amount values for a "Between" condition');
      return;
    }
    if (!(form.notify_discord || form.notify_email || form.notify_task)) {
      setError('Enable at least one notification channel (Discord, Email, or Google Task)');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name,
      trigger_type: form.trigger_type,
      keywords,
      keyword_negate: !!form.keyword_negate,
      record_type: form.record_type || 'any',
      bank_id: form.bank_id || null,
      amount_operator: amountOp,
      amount_value: hasAmountCondition ? Number(form.amount_value) : null,
      amount_value_max: amountOp === 'between' ? Number(form.amount_value_max) : null,
      amount_negate: !!form.amount_negate,
      condition_logic: form.condition_logic || 'and',
      check_day_of_month: Number(form.check_day_of_month) || 28,
      notify_discord: !!form.notify_discord,
      notify_email: !!form.notify_email,
      email_to: form.notify_email ? (form.email_to.trim() || null) : null,
      notify_task: !!form.notify_task,
      is_active: !!form.is_active,
    };
    try {
      if (editing) {
        await updateNotificationRule(editing.id, payload);
        setSuccess('Notification rule updated');
      } else {
        await createNotificationRule(payload);
        setSuccess('Notification rule created');
      }
      closeDialog();
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to save notification rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule) => {
    if (!window.confirm(`Delete notification rule "${rule.name}"?`)) return;
    setError('');
    try {
      await deleteNotificationRule(rule.id);
      setSuccess('Notification rule deleted');
      fetchData();
    } catch {
      setError('Failed to delete notification rule');
    }
  };

  const handleToggleActive = async (rule) => {
    setError('');
    try {
      await updateNotificationRule(rule.id, { is_active: !rule.is_active });
      fetchData();
    } catch {
      setError('Failed to update notification rule');
    }
  };

  const handleTest = async (rule) => {
    setTestingId(rule.id);
    setTestResult(null);
    setError('');
    try {
      const res = await testNotificationRule(rule.id);
      setTestResult({ ruleName: rule.name, ...res.result });
    } catch {
      setError('Failed to send test notification');
    } finally {
      setTestingId(null);
    }
  };

  const channelChips = (rule) => {
    const chips = [];
    if (rule.notify_discord) chips.push({ key: 'discord', label: 'Discord' });
    if (rule.notify_email) chips.push({ key: 'email', label: 'Email' });
    if (rule.notify_task) chips.push({ key: 'task', label: 'Google Task' });
    if (!chips.length) return <Typography variant="body2" color="text.secondary">—</Typography>;
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {chips.map((c) => (
          <Chip key={c.key} label={c.label} size="small" variant="outlined" color="primary" />
        ))}
      </Box>
    );
  };

  const bankName = (id) => banks.find((b) => b.id === id)?.name;

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 1 }}>
        <Box>
          <Typography variant="h6">Notification Rules</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
            Get alerted by Discord, email, or a Google Task — either the moment a transaction
            matches your keywords, or when an expected transaction hasn't shown up by a certain
            day of the month (e.g. "alert me if the Nokia salary from ABC Bank hasn't appeared by
            the 28th").
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd} sx={{ flexShrink: 0 }}>
          Add
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}
      {testResult && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setTestResult(null)}>
          <strong>Test — {testResult.ruleName}:</strong>{' '}
          {['discord', 'email', 'task']
            .filter((k) => testResult[k])
            .map((k) => `${k}: ${testResult[k]}`)
            .join(' · ') || 'No channels enabled'}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No notification rules yet. Click "Add" to create your first one.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Trigger</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Condition</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Channels</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Active</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Test</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Edit</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Delete</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id} hover>
                  <TableCell>{rule.name}</TableCell>
                  <TableCell>
                    <Tooltip title={triggerTypeLabel(rule.trigger_type)}>
                      <Chip
                        size="small"
                        label={rule.trigger_type === 'absence' ? `Missing by day ${rule.check_day_of_month}` : recordTypeLabel(rule.record_type)}
                        color={rule.trigger_type === 'absence' ? 'warning' : 'default'}
                        variant="outlined"
                      />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const kws = rule.keywords || [];
                      const amtLabel = amountConditionLabel(rule);
                      if (!kws.length && !amtLabel) return <Typography variant="body2" color="text.secondary">—</Typography>;
                      return (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>
                          {kws.map((kw) => (
                            <Chip key={kw} label={rule.keyword_negate ? `NOT ${kw}` : kw} size="small" variant="outlined" />
                          ))}
                          {kws.length > 0 && amtLabel && (
                            <Typography variant="caption" color="text.secondary" sx={{ px: 0.25 }}>
                              {(rule.condition_logic || 'and').toUpperCase()}
                            </Typography>
                          )}
                          {amtLabel && <Chip label={`Amount ${amtLabel}`} size="small" variant="outlined" color="secondary" />}
                        </Box>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{rule.bank_name || bankName(rule.bank_id) || <Typography variant="body2" color="text.secondary">Any</Typography>}</TableCell>
                  <TableCell>{channelChips(rule)}</TableCell>
                  <TableCell>
                    <Switch size="small" checked={!!rule.is_active} onChange={() => handleToggleActive(rule)} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Send a test notification now">
                      <span>
                        <IconButton size="small" color="primary" disabled={testingId === rule.id} onClick={() => handleTest(rule)}>
                          {testingId === rule.id ? <CircularProgress size={16} /> : <PlayArrow fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(rule)}>
                      <Edit fontSize="small" />
                    </IconButton>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleDelete(rule)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <NotificationsActive fontSize="small" />
          {editing ? 'Edit Notification Rule' : 'Add Notification Rule'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="Rule name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              sx={{ mb: 3 }}
              required
              autoFocus
            />

            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
              When should this fire?
            </Typography>
            <Divider sx={{ mb: 2, mt: 0.5 }} />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Trigger</InputLabel>
              <Select
                value={form.trigger_type}
                label="Trigger"
                onChange={(e) => setForm({ ...form, trigger_type: e.target.value })}
              >
                {TRIGGER_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.keywords}
              onChange={(e, newValue) => setKeywords(newValue)}
              inputValue={kwInputValue}
              onInputChange={(e, newInput, reason) => {
                if (reason !== 'reset') setKwInputValue(newInput);
              }}
              onBlur={commitPendingKeyword}
              renderTags={(value, getTagProps) =>
                value.map((kw, index) => (
                  <Chip label={kw} color="primary" variant="outlined" {...getTagProps({ index })} key={kw} />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Keywords"
                  placeholder={form.keywords.length ? 'Add another…' : 'e.g. NOKIA, SALARY'}
                  helperText={
                    form.trigger_type === 'absence'
                      ? 'If none of these appear in a transaction description this month, the rule fires.'
                      : 'Type a keyword and press Enter — fires when a new transaction description matches any of these.'
                  }
                />
              )}
              sx={{ mb: form.keywords.length ? 1 : 2 }}
            />
            {form.keywords.length > 0 && (
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={!!form.keyword_negate}
                    onChange={(e) => setForm({ ...form, keyword_negate: e.target.checked })}
                  />
                }
                label="Negate — fire when these keywords do NOT match"
                sx={{ mb: 2, display: 'block' }}
              />
            )}

            {form.keywords.length > 0 && (form.amount_operator || 'none') !== 'none' && (
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Combine keyword + amount conditions</InputLabel>
                <Select
                  value={form.condition_logic}
                  label="Combine keyword + amount conditions"
                  onChange={(e) => setForm({ ...form, condition_logic: e.target.value })}
                >
                  <MenuItem value="and">AND — both must match</MenuItem>
                  <MenuItem value="or">OR — either matching is enough</MenuItem>
                </Select>
              </FormControl>
            )}

            <FormControl fullWidth sx={{ mb: 1 }}>
              <InputLabel>Amount condition (optional)</InputLabel>
              <Select
                value={form.amount_operator}
                label="Amount condition (optional)"
                onChange={(e) => setForm({ ...form, amount_operator: e.target.value })}
              >
                {AMOUNT_OPERATORS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {form.amount_operator !== 'none' && (
              <Box sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <TextField
                    fullWidth
                    type="number"
                    label={form.amount_operator === 'between' ? 'Min amount' : 'Amount'}
                    value={form.amount_value}
                    onChange={(e) => setForm({ ...form, amount_value: e.target.value })}
                  />
                  {form.amount_operator === 'between' && (
                    <TextField
                      fullWidth
                      type="number"
                      label="Max amount"
                      value={form.amount_value_max}
                      onChange={(e) => setForm({ ...form, amount_value_max: e.target.value })}
                    />
                  )}
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={!!form.amount_negate}
                      onChange={(e) => setForm({ ...form, amount_negate: e.target.checked })}
                    />
                  }
                  label="Negate — fire when the amount does NOT match this condition"
                  sx={{ mt: 0.5, display: 'block' }}
                />
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              At least one of Keywords or Amount condition must be configured.
            </Typography>

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Record type</InputLabel>
              <Select
                value={form.record_type}
                label="Record type"
                onChange={(e) => setForm({ ...form, record_type: e.target.value })}
              >
                {RECORD_TYPES.map((r) => (
                  <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth sx={{ mb: form.trigger_type === 'absence' ? 2 : 3 }}>
              <InputLabel>Account (optional)</InputLabel>
              <Select
                value={form.bank_id}
                label="Account (optional)"
                onChange={(e) => setForm({ ...form, bank_id: e.target.value })}
              >
                <MenuItem value=""><em>Any account</em></MenuItem>
                {banks.map((b) => (
                  <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {form.trigger_type === 'absence' && (
              <TextField
                fullWidth
                type="number"
                label="Check by day of month"
                value={form.check_day_of_month}
                onChange={(e) => setForm({ ...form, check_day_of_month: e.target.value })}
                inputProps={{ min: 1, max: 28 }}
                helperText="Once this day of the month is reached, fires if no matching transaction has appeared yet (checked once per day, at most once per month)."
                sx={{ mb: 3 }}
              />
            )}

            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
              Notify via
            </Typography>
            <Divider sx={{ mb: 1, mt: 0.5 }} />

            <FormControlLabel
              control={<Switch checked={!!form.notify_discord} onChange={(e) => setForm({ ...form, notify_discord: e.target.checked })} />}
              label="Discord"
            />
            <FormControlLabel
              control={<Switch checked={!!form.notify_email} onChange={(e) => setForm({ ...form, notify_email: e.target.checked })} />}
              label="Email"
              sx={{ display: 'block' }}
            />
            {form.notify_email && (
              <TextField
                fullWidth
                size="small"
                label="Send email to (optional — defaults to your account email)"
                value={form.email_to}
                onChange={(e) => setForm({ ...form, email_to: e.target.value })}
                sx={{ mb: 1, mt: 0.5 }}
              />
            )}
            <FormControlLabel
              control={<Switch checked={!!form.notify_task} onChange={(e) => setForm({ ...form, notify_task: e.target.checked })} />}
              label="Create a Google Task"
              sx={{ display: 'block' }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Google Task requires connecting Google Drive under Settings → Backup (one connection covers both).
            </Typography>

            <FormControlLabel
              control={<Switch checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />}
              label="Rule active"
              sx={{ mt: 2, display: 'block' }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3 }}>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name.trim() || saving}>
            {saving ? 'Saving…' : editing ? 'Update Rule' : 'Create Rule'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
