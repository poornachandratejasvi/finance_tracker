import React, { useState, useEffect, useMemo } from 'react';
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
  Stack,
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
  Checkbox,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { Add, Edit, Delete, Refresh, PlaylistAddCheck } from '@mui/icons-material';
import {
  getAutoRules,
  createAutoRule,
  updateAutoRule,
  deleteAutoRule,
  applyAutoRules,
  previewRuleMatches,
  applyRuleToSelected,
  applyRuleToAllMatching,
  getCategories,
  getLabels,
  createLabel,
  getDiscordConfig,
} from '../../services/api';
import CategoryIcon from '../CategoryIcon';
import { formatCurrency, formatDate } from '../../utils/format';

// Record-type trigger options. 'any' matches every transaction regardless of flow.
const RECORD_TYPES = [
  { value: 'any', label: 'Use any' },
  { value: 'debit', label: 'Expense' },
  { value: 'credit', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];
const recordTypeLabel = (val) =>
  RECORD_TYPES.find((r) => r.value === val)?.label || 'Use any';

const emptyForm = {
  name: '',
  keywords: [],
  record_type: 'any',
  category: '',
  label_ids: [],
  notify_discord: false,
};

export default function AutomaticRulesPanel() {
  const [rules, setRules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  // Text currently typed (but not yet committed via Enter) in the Keywords field —
  // committed on blur / before save so a keyword isn't silently lost if the user
  // clicks "Update Rule" without pressing Enter first.
  const [kwInputValue, setKwInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Inline label creation (inside the dialog)
  const [showCreateLabel, setShowCreateLabel] = useState(false);
  const [newLabel, setNewLabel] = useState({ name: '', color: '#1aa565' });
  const [creatingLabel, setCreatingLabel] = useState(false);

  // Re-apply action
  const [applying, setApplying] = useState(false);

  // "Found existing records" matcher dialog
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchRecords, setMatchRecords] = useState([]);
  const [matchTotal, setMatchTotal] = useState(0);
  const [matchSelected, setMatchSelected] = useState(() => new Set());
  const [matchContext, setMatchContext] = useState({ category: '', label_ids: [], keywords: [], record_type: 'any' });
  const [applyingAll, setApplyingAll] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchApplying, setMatchApplying] = useState(false);

  // Discord webhook status (read-only here — configured in Settings -> External Accounts,
  // used by any rule with "Notify on Discord" enabled)
  const [discordWebhookSet, setDiscordWebhookSet] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ruleData, catData, labelData] = await Promise.all([
        getAutoRules(),
        getCategories(),
        getLabels(),
      ]);
      setRules(ruleData || []);
      setCategories(catData || []);
      setLabels(labelData || []);
    } catch (err) {
      setError('Failed to load rules');
    } finally {
      setLoading(false);
    }
  };

  const fetchDiscordConfig = async () => {
    try {
      const cfg = await getDiscordConfig();
      setDiscordWebhookSet(!!cfg.webhook_set);
    } catch {
      /* non-fatal — the panel still works without Discord configured */
    }
  };

  useEffect(() => {
    fetchData();
    fetchDiscordConfig();
  }, []);

  // Flattened category hierarchy: roots then indented children (built from parent_id).
  const categoryItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    const byOrder = (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.name || '').localeCompare(b.name || '');
    const roots = categories.filter((c) => c.parent_id == null).sort(byOrder);
    const childrenOf = (pid) => categories.filter((c) => c.parent_id === pid).sort(byOrder);
    roots.forEach((r) => {
      items.push({ cat: r, depth: 0 });
      seen.add(r.id);
      childrenOf(r.id).forEach((k) => { items.push({ cat: k, depth: 1 }); seen.add(k.id); });
    });
    // Any categories whose parent isn't a listed root (defensive) appear at depth 0.
    categories.filter((c) => !seen.has(c.id)).sort(byOrder).forEach((c) => items.push({ cat: c, depth: 0 }));
    return items;
  }, [categories]);

  // Fast lookups by name (category meta) and by id (labels).
  const catByName = useMemo(() => {
    const m = {};
    categories.forEach((c) => { m[c.name] = c; });
    return m;
  }, [categories]);
  const labelById = useMemo(() => {
    const m = {};
    labels.forEach((l) => { m[l.id] = l; });
    return m;
  }, [labels]);

  const catMeta = (name) => {
    const c = catByName[name];
    return c ? { icon: c.icon, color: c.color, kind: c.kind } : undefined;
  };

  // ---- Dialog open/close ----
  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setKwInputValue('');
    setShowCreateLabel(false);
    setNewLabel({ name: '', color: '#1aa565' });
    setDialogOpen(true);
  };

  const openEdit = (rule) => {
    setEditing(rule);
    setForm({
      name: rule.name || '',
      keywords: Array.isArray(rule.keywords) ? [...rule.keywords] : [],
      record_type: rule.record_type || 'any',
      category: rule.category || '',
      label_ids: Array.isArray(rule.label_ids) ? [...rule.label_ids] : [],
      notify_discord: !!rule.notify_discord,
    });
    setKwInputValue('');
    setShowCreateLabel(false);
    setNewLabel({ name: '', color: '#1aa565' });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  // ---- Keyword chip input ----
  // Trim + de-dupe (case-insensitive) the chip list the Autocomplete produces.
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

  // Commit whatever's still typed in the Keywords box into the chip list. Returns the
  // resulting keywords array (setState is async, so callers that need the value
  // immediately — e.g. handleSave — should use the return value, not form.keywords).
  const commitPendingKeyword = () => {
    const pending = kwInputValue.trim();
    if (!pending) return form.keywords;
    const already = form.keywords.some((k) => k.toLowerCase() === pending.toLowerCase());
    const next = already ? form.keywords : [...form.keywords, pending];
    setForm((f) => ({ ...f, keywords: next }));
    setKwInputValue('');
    return next;
  };

  // ---- Inline label creation ----
  const submitCreateLabel = async () => {
    const name = newLabel.name.trim();
    if (!name) return;
    setCreatingLabel(true);
    setError('');
    try {
      const created = await createLabel({ name, color: newLabel.color });
      setLabels((prev) => [...prev, created]);
      setForm((f) => ({ ...f, label_ids: [...f.label_ids, created.id] }));
      setNewLabel({ name: '', color: '#1aa565' });
      setShowCreateLabel(false);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to create label');
    } finally {
      setCreatingLabel(false);
    }
  };

  // ---- Save (create/update) ----
  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) return;
    // Commit any keyword still sitting in the input (typed but Enter never pressed) —
    // otherwise it's silently dropped instead of saved.
    const keywords = commitPendingKeyword();
    if (!keywords.length) { setError('Add at least one keyword'); return; }
    setSaving(true);
    setError('');
    // Capture the actions before closeDialog() resets the form.
    const ctx = {
      keywords: [...keywords],
      record_type: form.record_type || 'any',
      category: form.category || '',
      label_ids: [...(form.label_ids || [])],
      notify_discord: !!form.notify_discord,
    };
    try {
      const payload = {
        name,
        keywords: ctx.keywords,
        record_type: ctx.record_type,
        category: ctx.category || null,
        label_ids: ctx.label_ids,
        notify_discord: ctx.notify_discord,
      };
      if (editing) {
        await updateAutoRule(editing.id, payload);
        setSuccess('Rule updated');
      } else {
        await createAutoRule(payload);
        setSuccess('Rule created');
      }
      // Offer to apply the saved rule to existing matching records (Wallet-style).
      let matched = { count: 0, records: [] };
      try {
        matched = await previewRuleMatches({ keywords: ctx.keywords, record_type: ctx.record_type });
      } catch { /* preview is best-effort */ }
      closeDialog();
      fetchData();
      if ((matched.count || 0) > 0) {
        setMatchRecords(matched.records || []);
        setMatchTotal(matched.count || 0);
        setMatchSelected(new Set());
        setMatchContext({ category: ctx.category, label_ids: ctx.label_ids, keywords: ctx.keywords, record_type: ctx.record_type });
        setMatchOpen(true);
      }
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  // Open the matcher for an already-saved rule (from its table row) — select & apply to records.
  const openMatcherForRule = async (rule) => {
    setMatchLoading(true);
    setError('');
    try {
      const res = await previewRuleMatches({
        keywords: rule.keywords || [],
        record_type: rule.record_type || 'any',
      });
      setMatchRecords(res.records || []);
      setMatchTotal(res.count || 0);
      setMatchSelected(new Set());
      setMatchContext({ category: rule.category || '', label_ids: rule.label_ids || [], keywords: rule.keywords || [], record_type: rule.record_type || 'any' });
      setMatchOpen(true);
    } catch {
      setError('Failed to find matching records');
    } finally {
      setMatchLoading(false);
    }
  };

  // Manually find existing records matching the current form's keywords (no save required).
  const handleFindMatches = async () => {
    const kws = commitPendingKeyword().filter(Boolean);
    if (!kws.length) { setError('Add at least one keyword first'); return; }
    setMatchLoading(true);
    setError('');
    try {
      const res = await previewRuleMatches({ keywords: kws, record_type: form.record_type || 'any' });
      setMatchRecords(res.records || []);
      setMatchTotal(res.count || 0);
      setMatchSelected(new Set());
      setMatchContext({ category: form.category || '', label_ids: [...(form.label_ids || [])], keywords: kws, record_type: form.record_type || 'any' });
      setMatchOpen(true);
    } catch {
      setError('Failed to find matching records');
    } finally {
      setMatchLoading(false);
    }
  };

  const toggleMatch = (id) =>
    setMatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAllMatches = (checked) =>
    setMatchSelected(checked ? new Set(matchRecords.map((r) => r.id)) : new Set());

  const handleApplySelected = async () => {
    const ids = Array.from(matchSelected);
    if (!ids.length) return;
    setMatchApplying(true);
    setError('');
    try {
      const res = await applyRuleToSelected({
        transaction_ids: ids,
        category: matchContext.category || null,
        label_ids: matchContext.label_ids || [],
      });
      setSuccess(`Applied to ${res.updated} existing record(s)`);
      setMatchOpen(false);
    } catch {
      setError('Failed to apply to selected records');
    } finally {
      setMatchApplying(false);
    }
  };

  // Apply to EVERY record matching the rule's keywords, not just the (possibly
  // truncated) preview page — the server re-runs the match query itself.
  const handleApplyAllMatching = async () => {
    if (!window.confirm(`Apply to all ${matchTotal} matching record(s)? This is not limited to the ${matchRecords.length} shown above.`)) return;
    setApplyingAll(true);
    setError('');
    try {
      const res = await applyRuleToAllMatching({
        keywords: matchContext.keywords || [],
        record_type: matchContext.record_type || 'any',
        category: matchContext.category || null,
        label_ids: matchContext.label_ids || [],
      });
      setSuccess(`Applied to ${res.updated} of ${matchTotal} matching record(s)`);
      setMatchOpen(false);
    } catch {
      setError('Failed to apply to all matching records');
    } finally {
      setApplyingAll(false);
    }
  };

  const handleDelete = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.name}"?`)) return;
    setError('');
    try {
      await deleteAutoRule(rule.id);
      setSuccess('Rule deleted');
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to delete rule');
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError('');
    try {
      const res = await applyAutoRules(false);
      setSuccess(`Updated ${res?.updated ?? 0} transactions`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to apply rules');
    } finally {
      setApplying(false);
    }
  };

  const renderLabelChips = (ids) => {
    if (!ids || ids.length === 0) return <Typography variant="body2" color="text.secondary">—</Typography>;
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {ids.map((id) => {
          const l = labelById[id];
          return (
            <Chip
              key={id}
              size="small"
              label={l?.name || id}
              sx={{ bgcolor: l?.color || 'grey.500', color: '#fff', height: 22 }}
            />
          );
        })}
      </Box>
    );
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 1 }}>
        <Box>
          <Typography variant="h6">Automatic Rules</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 680 }}>
            The rule will automatically assign the selected category and labels to your bank
            transactions. All your future transactions update automatically.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd} sx={{ flexShrink: 0 }}>
          Add
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 240 }}>
          Turn on "Notify on Discord" for any rule below to post a message the moment a new
          transaction matches its keywords.
        </Typography>
        <Chip
          size="small"
          color={discordWebhookSet ? 'success' : 'default'}
          variant="outlined"
          label={discordWebhookSet ? 'Discord webhook configured' : 'Discord webhook not configured'}
        />
        <Typography variant="caption" color="text.secondary">
          Configure it in Settings → External Accounts
        </Typography>
      </Paper>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Your Rules</Typography>

          {rules.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              No rules yet. Click "Add" to create your first automatic rule.
            </Typography>
          ) : (
            <TableContainer sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Rule name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Keywords</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Record type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Labels</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Apply</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Edit</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>Delete</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          {rule.name}
                          {rule.notify_discord && (
                            <Tooltip title="Notifies on Discord when matched">
                              <Chip size="small" label="Discord" color="primary" variant="outlined" sx={{ height: 20 }} />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {(rule.keywords || []).length === 0 ? (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        ) : (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {(rule.keywords || []).map((kw) => (
                              <Chip key={kw} label={kw} size="small" variant="outlined" color="primary" />
                            ))}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>{recordTypeLabel(rule.record_type)}</TableCell>
                      <TableCell>
                        {rule.category ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CategoryIcon name={rule.category} size={24} meta={catMeta(rule.category)} />
                            <span>{rule.category}</span>
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>{renderLabelChips(rule.label_ids)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Apply to existing records">
                          <span>
                            <IconButton
                              size="small"
                              color="primary"
                              disabled={matchLoading || !(rule.keywords || []).length}
                              onClick={() => openMatcherForRule(rule)}
                            >
                              <PlaylistAddCheck fontSize="small" />
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

          <Divider sx={{ mb: 2 }} />

          <Button
            variant="outlined"
            startIcon={applying ? <CircularProgress size={16} color="inherit" /> : <Refresh />}
            onClick={handleApply}
            disabled={applying}
          >
            Re-apply rules to existing transactions
          </Button>
        </>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Rule' : 'Add Rule'}</DialogTitle>
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

            {/* SET TRIGGER */}
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
              Set trigger
            </Typography>
            <Divider sx={{ mb: 2, mt: 0.5 }} />

            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={form.keywords}
              onChange={(e, newValue) => setKeywords(newValue)}
              inputValue={kwInputValue}
              onInputChange={(e, newInput, reason) => {
                // reason 'reset' fires after a chip commits/removes — don't re-populate
                // the box with the just-committed text.
                if (reason !== 'reset') setKwInputValue(newInput);
              }}
              onBlur={commitPendingKeyword}
              renderTags={(value, getTagProps) =>
                value.map((kw, index) => (
                  <Chip
                    label={kw}
                    color="primary"
                    variant="outlined"
                    {...getTagProps({ index })}
                    key={kw}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Keywords"
                  placeholder={form.keywords.length ? 'Add another…' : 'Type a keyword and press Enter'}
                  helperText="Type a keyword and press Enter — add one or more"
                />
              )}
              sx={{ mb: 2 }}
            />

            <FormControl fullWidth sx={{ mb: 3 }}>
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

            {/* ASSIGN ACTIONS */}
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 600 }}>
              Assign actions
            </Typography>
            <Divider sx={{ mb: 2, mt: 0.5 }} />

            {form.record_type === 'transfer' && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                This is a Transfer Rule — matching transactions are marked as a transfer
                (category set to "Transfer") regardless of what's chosen below.
              </Typography>
            )}

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Category</InputLabel>
              <Select
                value={form.category}
                label="Category"
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                renderValue={(val) => {
                  if (!val) return <em>None</em>;
                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CategoryIcon name={val} size={22} meta={catMeta(val)} />
                      <span>{val}</span>
                    </Box>
                  );
                }}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {categoryItems.map(({ cat, depth }) => (
                  <MenuItem key={cat.id} value={cat.name} sx={{ pl: 2 + depth * 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CategoryIcon name={cat.name} size={22} meta={{ icon: cat.icon, color: cat.color, kind: cat.kind }} />
                      <span>{cat.name}</span>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: showCreateLabel ? 1 : 2 }}>
              <FormControl fullWidth>
                <InputLabel>Labels</InputLabel>
                <Select
                  multiple
                  value={form.label_ids}
                  label="Labels"
                  onChange={(e) => setForm({ ...form, label_ids: e.target.value })}
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((id) => {
                        const l = labelById[id];
                        return (
                          <Chip key={id} size="small" label={l?.name || id} sx={{ bgcolor: l?.color || 'grey.500', color: '#fff', height: 22 }} />
                        );
                      })}
                    </Box>
                  )}
                >
                  {labels.length === 0 ? (
                    <MenuItem value="" disabled>No labels yet — create one with +</MenuItem>
                  ) : (
                    labels.map((l) => (
                      <MenuItem key={l.id} value={l.id}>
                        <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: l.color || 'grey.500', mr: 1 }} />
                        {l.name}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
              <Tooltip title="Create label">
                <IconButton onClick={() => setShowCreateLabel((v) => !v)} sx={{ mt: 0.5 }}><Add /></IconButton>
              </Tooltip>
            </Box>

            {showCreateLabel && (
              <Box sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  size="small"
                  label="Label name"
                  value={newLabel.name}
                  onChange={(e) => setNewLabel({ ...newLabel, name: e.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label="Color"
                  type="color"
                  value={newLabel.color}
                  onChange={(e) => setNewLabel({ ...newLabel, color: e.target.value })}
                  sx={{ width: 80 }}
                />
                <Button size="small" variant="contained" onClick={submitCreateLabel} disabled={!newLabel.name.trim() || creatingLabel}>
                  {creatingLabel ? '…' : 'Add'}
                </Button>
              </Box>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={!!form.notify_discord}
                  onChange={(e) => setForm({ ...form, notify_discord: e.target.checked })}
                />
              }
              label="Notify on Discord when this rule matches"
              sx={{ mt: 1 }}
            />
            {form.notify_discord && !discordWebhookSet && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                No Discord webhook is configured yet — add one in Settings → External Accounts or this rule won't be able to send anything.
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Button
            onClick={handleFindMatches}
            disabled={!form.keywords.length || matchLoading}
            startIcon={matchLoading ? <CircularProgress size={16} /> : <Refresh />}
          >
            Find matching records
          </Button>
          <Box>
            <Button onClick={closeDialog}>Cancel</Button>
            <Button variant="contained" onClick={handleSave} disabled={!form.name.trim() || saving} sx={{ ml: 1 }}>
              {saving ? 'Saving…' : editing ? 'Update Rule' : 'Create Rule'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Found existing records — apply this rule to past transactions */}
      <Dialog open={matchOpen} onClose={() => setMatchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Found existing records</DialogTitle>
        <DialogContent dividers>
          {matchRecords.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>No matching records found.</Typography>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Checkbox
                    size="small"
                    checked={matchSelected.size === matchRecords.length && matchRecords.length > 0}
                    indeterminate={matchSelected.size > 0 && matchSelected.size < matchRecords.length}
                    onChange={(e) => toggleAllMatches(e.target.checked)}
                  />
                  <Typography variant="subtitle2">
                    Found {matchTotal} record{matchTotal === 1 ? '' : 's'}
                    {matchTotal > matchRecords.length ? ` (showing ${matchRecords.length})` : ''} · {matchSelected.size} selected
                  </Typography>
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Selected records will be set to{' '}
                <strong>{matchContext.category || '(no category change)'}</strong>
                {matchContext.label_ids?.length ? ` + ${matchContext.label_ids.length} label(s)` : ''}.
              </Typography>
              {matchTotal > matchRecords.length && (
                <Alert
                  severity="info"
                  sx={{ mb: 1.5 }}
                  action={
                    <Button
                      size="small"
                      color="inherit"
                      onClick={handleApplyAllMatching}
                      disabled={applyingAll}
                      startIcon={applyingAll ? <CircularProgress size={14} /> : null}
                    >
                      {applyingAll ? 'Applying…' : `Apply to all ${matchTotal}`}
                    </Button>
                  }
                >
                  Only the first {matchRecords.length} of {matchTotal} matches are listed below — use "Apply to all {matchTotal}" to cover every match, not just what's shown.
                </Alert>
              )}
              <Box sx={{ maxHeight: 380, overflowY: 'auto' }}>
                {matchRecords.map((r) => (
                  <Box
                    key={r.id}
                    onClick={() => toggleMatch(r.id)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1, py: 1, px: 0.5, cursor: 'pointer',
                      borderBottom: '1px solid', borderColor: 'divider',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Checkbox size="small" checked={matchSelected.has(r.id)} onChange={() => toggleMatch(r.id)} onClick={(e) => e.stopPropagation()} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" noWrap>{r.description || '—'}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {r.transaction_date ? formatDate(r.transaction_date) : ''}
                        {r.bank_name ? ` · ${r.bank_name}` : ''}
                        {r.category ? ` · ${r.category}` : ''}
                      </Typography>
                    </Box>
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      sx={{ whiteSpace: 'nowrap', color: r.transaction_type === 'credit' ? 'success.main' : 'error.main' }}
                    >
                      {formatCurrency(r.amount, { currency: r.currency_code || 'INR' })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setMatchOpen(false)} disabled={matchApplying}>Skip</Button>
          <Button
            variant="contained"
            onClick={handleApplySelected}
            disabled={matchApplying || matchSelected.size === 0}
            startIcon={matchApplying ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {matchApplying ? 'Applying…' : `Apply to ${matchSelected.size} selected record${matchSelected.size === 1 ? '' : 's'}`}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
