import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, MenuItem, Chip, Divider, Tooltip,
  FormControlLabel, Checkbox, CircularProgress,
} from '@mui/material';
import { Delete, Add, ContentCopy, PhoneIphone, Download } from '@mui/icons-material';
import {
  listApiTokens, createApiToken, revokeApiToken,
  getIngestTargetFields, getIngestMapping, saveIngestMapping, getBanks, downloadShortcut,
  downloadSmsShortcut,
} from '../services/api';

const API_BASE = process.env.REACT_APP_API_URL || window.location.origin.replace(':3000', ':8000');

export default function ApiAccess() {
  const [tokens, setTokens] = useState([]);
  const [newTokenName, setNewTokenName] = useState('iOS Shortcut');
  const [freshToken, setFreshToken] = useState(null); // plaintext shown once
  const [targetFields, setTargetFields] = useState([]);
  const [banks, setBanks] = useState([]);
  const [rows, setRows] = useState([]); // [{source, target}]
  const [defaultBankId, setDefaultBankId] = useState('');
  const [dateFormat, setDateFormat] = useState('');
  const [defaultType, setDefaultType] = useState('debit');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // iOS Shortcut setup kit + downloadable shortcut file
  const [scBaseUrl, setScBaseUrl] = useState(API_BASE);
  const [scIncludeType, setScIncludeType] = useState(true);
  const [scIncludeCategory, setScIncludeCategory] = useState(true);
  const [scIncludeAccount, setScIncludeAccount] = useState(true);
  const [scIncludeDate, setScIncludeDate] = useState(false);
  const [scIncludeNotes, setScIncludeNotes] = useState(false);
  const [scIncludeFromAccount, setScIncludeFromAccount] = useState(false);
  const [scBusy, setScBusy] = useState(false);
  const [kit, setKit] = useState(null);     // {token, url} shown after "Create setup kit"
  const [kitBusy, setKitBusy] = useState(false);
  // SMS auto-detect (iOS Automation) setup kit + downloadable shortcut
  const [smsKit, setSmsKit] = useState(null);
  const [smsKitBusy, setSmsKitBusy] = useState(false);
  const [smsScBusy, setSmsScBusy] = useState(false);

  const load = async () => {
    try {
      const [tk, tf, mp, bk] = await Promise.all([
        listApiTokens().catch(() => []),
        getIngestTargetFields().catch(() => ({ target_fields: [] })),
        getIngestMapping().catch(() => null),
        getBanks().catch(() => []),
      ]);
      setTokens(tk || []);
      setTargetFields(tf?.target_fields || []);
      setBanks(bk || []);
      if (mp) {
        setRows(Object.entries(mp.field_map || {}).map(([source, target]) => ({ source, target })));
        setDefaultBankId(mp.default_bank_id || '');
        setDateFormat(mp.date_format || '');
        setDefaultType(mp.default_type || 'debit');
      }
    } catch (e) {
      setErr('Failed to load API access settings');
    }
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setErr(''); setMsg('');
    try {
      const res = await createApiToken(newTokenName || 'API Token');
      setFreshToken(res.token);
      setMsg('Token created — copy it now, it will not be shown again.');
      load();
    } catch (e) { setErr('Failed to create token'); }
  };
  const handleRevoke = async (id) => {
    if (!window.confirm('Revoke this token? Clients using it will stop working.')) return;
    try { await revokeApiToken(id); load(); } catch (e) { setErr('Failed to revoke token'); }
  };

  const handleCreateKit = async () => {
    setErr(''); setMsg(''); setKitBusy(true);
    try {
      const base = (scBaseUrl || API_BASE).trim().replace(/\/+$/, '');
      const res = await createApiToken('iOS Shortcut');
      setKit({ token: res.token, url: `${base}/api/ingest/transaction` });
      setMsg('Setup kit ready — copy the three values into your Shortcut. The token is shown only once.');
      load();
    } catch (e) {
      setErr('Failed to create the setup kit.');
    } finally {
      setKitBusy(false);
    }
  };

  const handleDownloadShortcut = async () => {
    setErr(''); setMsg(''); setScBusy(true);
    try {
      const base = (scBaseUrl || API_BASE).trim().replace(/\/+$/, '');
      const name = await downloadShortcut({
        base_url: base,
        include_type: scIncludeType,
        include_category: scIncludeCategory,
        include_account: scIncludeAccount,
        include_date: scIncludeDate,
        include_notes: scIncludeNotes,
        include_from_account: scIncludeFromAccount,
        token_name: 'iOS Shortcut',
      });
      setMsg(`Downloaded "${name}" (URL + fresh token baked in). Sign it on a Mac with \`shortcuts sign\` before importing on iOS 15+, or use the Setup Kit above on a stock iPhone.`);
      load(); // refresh the token list (a new token was created)
    } catch (e) {
      setErr('Failed to generate the shortcut. Check the Base URL and try again.');
    } finally {
      setScBusy(false);
    }
  };

  const handleCreateSmsKit = async () => {
    setErr(''); setMsg(''); setSmsKitBusy(true);
    try {
      const base = (scBaseUrl || API_BASE).trim().replace(/\/+$/, '');
      const res = await createApiToken('iOS SMS Auto-Detect');
      setSmsKit({ token: res.token, url: `${base}/api/ingest/sms` });
      setMsg('SMS setup kit ready — copy the values into a 2-action Shortcut. The token is shown only once.');
      load();
    } catch (e) {
      setErr('Failed to create the SMS setup kit.');
    } finally {
      setSmsKitBusy(false);
    }
  };

  const handleDownloadSmsShortcut = async () => {
    setErr(''); setMsg(''); setSmsScBusy(true);
    try {
      const base = (scBaseUrl || API_BASE).trim().replace(/\/+$/, '');
      const name = await downloadSmsShortcut({ base_url: base, token_name: 'iOS SMS Auto-Detect' });
      setMsg(`Downloaded "${name}" (URL + fresh token baked in). Sign it on a Mac with \`shortcuts sign\` before importing on iOS 15+, or use the Setup Kit above on a stock iPhone.`);
      load();
    } catch (e) {
      setErr('Failed to generate the SMS shortcut. Check the Base URL and try again.');
    } finally {
      setSmsScBusy(false);
    }
  };

  const addRow = () => setRows((r) => [...r, { source: '', target: targetFields[0] || '' }]);
  const updateRow = (i, key, val) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i));

  const handleSaveMapping = async () => {
    setErr(''); setMsg('');
    const field_map = {};
    rows.forEach((row) => { if (row.source && row.target) field_map[row.source] = row.target; });
    try {
      await saveIngestMapping({
        field_map,
        default_bank_id: defaultBankId || null,
        date_format: dateFormat || null,
        default_type: defaultType || 'debit',
      });
      setMsg('Mapping saved.');
    } catch (e) {
      setErr(e?.response?.data?.detail ? JSON.stringify(e.response.data.detail) : 'Failed to save mapping');
    }
  };

  const copy = async (text) => {
    // navigator.clipboard is only available in secure contexts (https) or on localhost.
    // Over http://<LAN-IP> (typical for iOS-Shortcut setup) it's absent/denied and the
    // async write rejects — so guard it and fall back to a hidden-textarea copy, and
    // never let the promise reject unhandled.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setMsg('Copied to clipboard.');
    } catch (_) {
      setMsg('Could not copy automatically — select the text and copy manually.');
    }
  };

  const exampleBody = JSON.stringify(
    rows.length
      ? rows.reduce((acc, r) => { if (r.source) acc[r.source] = ''; return acc; }, {})
      : { transaction_date: '2026-07-20', description: 'Coffee', amount: '250', transaction_type: 'debit' },
    null, 2,
  );

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h4" gutterBottom>API Access & Ingestion</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Create an API token and post transactions from an iOS Shortcut or webhook.
      </Typography>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {/* API Tokens */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>API Tokens</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
          <TextField size="small" label="Token name" value={newTokenName} onChange={(e) => setNewTokenName(e.target.value)} />
          <Button variant="contained" startIcon={<Add />} onClick={handleCreate}>Create Token</Button>
        </Box>
        {freshToken && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>Your new token (shown once):</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <code style={{ wordBreak: 'break-all' }}>{freshToken}</code>
              <IconButton size="small" onClick={() => copy(freshToken)}><ContentCopy fontSize="small" /></IconButton>
            </Box>
          </Alert>
        )}
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>Name</TableCell><TableCell>Prefix</TableCell><TableCell>Last used</TableCell><TableCell>Created</TableCell><TableCell align="right">Actions</TableCell></TableRow>
          </TableHead>
          <TableBody>
            {tokens.length === 0 ? (
              <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary">No tokens yet.</Typography></TableCell></TableRow>
            ) : tokens.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell><code>{t.token_prefix}…</code></TableCell>
                <TableCell>{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '—'}</TableCell>
                <TableCell>{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</TableCell>
                <TableCell align="right"><IconButton size="small" color="error" onClick={() => handleRevoke(t.id)}><Delete fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* iOS Shortcut integration */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <PhoneIphone color="primary" />
          <Typography variant="h6">iOS Shortcut integration</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          On iPhone/iPad, the built-in <b>Shortcuts</b> app <i>is</i> the plugin platform — no App
          Store add-on needed. The fastest reliable way is the <b>Setup Kit</b>: tap the button to
          mint a token, then paste three values into a tiny shortcut (≈3 min) that also lets you
          pick the expense/income type and which account it belongs to. This works on every iPhone.
        </Typography>

        <TextField
          size="small"
          label="Server URL (reachable from your phone)"
          value={scBaseUrl}
          onChange={(e) => setScBaseUrl(e.target.value)}
          helperText="e.g. http://192.168.1.50:8000 or your HTTPS domain — NOT localhost (that points at the phone)"
          fullWidth
          sx={{ mb: 2, maxWidth: 520 }}
        />

        <Button
          variant="contained"
          startIcon={kitBusy ? <CircularProgress size={18} color="inherit" /> : <PhoneIphone />}
          onClick={handleCreateKit}
          disabled={kitBusy || !scBaseUrl.trim()}
        >
          {kitBusy ? 'Creating…' : 'Create Setup Kit'}
        </Button>

        {kit && (
          <Box sx={{ mt: 2 }}>
            {[
              { label: '1. POST URL', value: kit.url },
              { label: '2. Header  X-API-Key', value: kit.token },
              {
                label: '3. Request body (JSON)',
                value: '{ "amount": 250, "description": "Swiggy dinner", "type": "Expense", "account": "'
                  + (banks[0]?.name || 'Your Bank Name') + '" }',
              },
            ].map((row) => (
              <Box key={row.label} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{row.label}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                  <code style={{ wordBreak: 'break-all', flex: 1, fontSize: 13 }}>{row.value}</code>
                  <IconButton size="small" onClick={() => copy(row.value)}><ContentCopy fontSize="small" /></IconButton>
                </Box>
              </Box>
            ))}
            <Alert severity="success" icon={false} sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Build it (Shortcuts app → new shortcut):</Typography>
              <Box component="ol" sx={{ pl: 3, my: 0, '& li': { mb: 0.25 } }}>
                <li><Typography variant="body2"><b>Ask for Input</b> (Number) → “Amount”.</Typography></li>
                <li><Typography variant="body2"><b>Ask for Input</b> (Text) → “Description”.</Typography></li>
                <li><Typography variant="body2">
                  <b>Choose from Menu</b> → items “Expense” and “Income” → rename the result variable to “Type”
                  (this is what decides spend vs. credit — the request body's <code>type</code> field below reads it).
                </Typography></li>
                <li><Typography variant="body2">
                  <b>Choose from Menu</b> → one item per account you want to pick from, using your account names
                  exactly as configured in Settings → Banks{banks.length > 0 && (
                    <> (you have: {banks.map((b) => `"${b.name}"`).join(', ')})</>
                  )} → rename the result variable to “Account”. (A close/partial match to the account name also
                  works, but exact is safest.)
                </Typography></li>
                <li><Typography variant="body2">
                  <b>Get Contents of URL</b> → paste URL (1), Method <b>POST</b>, add header <code>X-API-Key</code> =
                  value (2), Request Body <b>JSON</b> with <code>amount</code> = Amount variable,{' '}
                  <code>description</code> = Description variable, <code>type</code> = Type variable, and{' '}
                  <code>account</code> = Account variable.
                </Typography></li>
                <li><Typography variant="body2">Name it “Add Transaction”, add to Home Screen / Siri. Done.</Typography></li>
              </Box>
            </Alert>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Advanced — download a pre-built shortcut file</Typography>
        <Alert severity="warning" sx={{ mb: 1 }}>
          <Typography variant="body2">
            On a stock iPhone this download <b>will fail to import</b> ("Can't Import Shortcut" /
            "isn't signed") — since iOS 15, Apple only accepts raw shortcut files like this one after
            they're signed on a Mac (<code>shortcuts sign</code>). Unless you have a Mac to sign it
            with, use the <b>Setup Kit</b> above instead — it works on every iPhone with no signing.
          </Typography>
        </Alert>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            variant="outlined"
            startIcon={scBusy ? <CircularProgress size={18} /> : <Download />}
            onClick={handleDownloadShortcut}
            disabled={scBusy || !scBaseUrl.trim()}
          >
            {scBusy ? 'Generating…' : 'Download .shortcut file'}
          </Button>
          <FormControlLabel
            control={<Checkbox size="small" checked={scIncludeType} onChange={(e) => setScIncludeType(e.target.checked)} />}
            label="Ask Expense / Income / Transfer"
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={scIncludeCategory} onChange={(e) => setScIncludeCategory(e.target.checked)} />}
            label="Ask Category"
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={scIncludeAccount} onChange={(e) => setScIncludeAccount(e.target.checked)} />}
            label="Ask Account"
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={scIncludeDate} onChange={(e) => setScIncludeDate(e.target.checked)} />}
            label="Ask Date"
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={scIncludeNotes} onChange={(e) => setScIncludeNotes(e.target.checked)} />}
            label="Ask Notes"
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={scIncludeFromAccount} onChange={(e) => setScIncludeFromAccount(e.target.checked)} />}
            label="Ask From Account (for transfers)"
          />
        </Box>
      </Paper>

      {/* iOS SMS auto-detect (Automation) */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <PhoneIphone color="primary" />
          <Typography variant="h6">iOS SMS Auto-Detect</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Apple doesn't let any app (or Shortcut) read your SMS inbox directly — unlike the Android
          app's automatic detection. The closest iOS equivalent: a Shortcuts <b>Automation</b> that
          triggers on "When I receive a message" and forwards the message text here, where it's
          parsed the same way (finds a Rs./INR amount, checks for credit keywords) as the Android
          app does. Transactions land as <b>unconfirmed</b>, same as every other real-time-alert
          source — they get auto-confirmed once the real statement PDF arrives.
        </Typography>

        <Button
          variant="contained"
          startIcon={smsKitBusy ? <CircularProgress size={18} color="inherit" /> : <PhoneIphone />}
          onClick={handleCreateSmsKit}
          disabled={smsKitBusy || !scBaseUrl.trim()}
        >
          {smsKitBusy ? 'Creating…' : 'Create SMS Setup Kit'}
        </Button>

        {smsKit && (
          <Box sx={{ mt: 2 }}>
            {[
              { label: '1. POST URL', value: smsKit.url },
              { label: '2. Header  X-API-Key', value: smsKit.token },
            ].map((row) => (
              <Box key={row.label} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{row.label}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                  <code style={{ wordBreak: 'break-all', flex: 1, fontSize: 13 }}>{row.value}</code>
                  <IconButton size="small" onClick={() => copy(row.value)}><ContentCopy fontSize="small" /></IconButton>
                </Box>
              </Box>
            ))}
            <Alert severity="success" icon={false} sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Build it (Shortcuts app → new shortcut):</Typography>
              <Box component="ol" sx={{ pl: 3, my: 0, '& li': { mb: 0.25 } }}>
                <li><Typography variant="body2"><b>Get Contents of URL</b> → paste URL (1), Method <b>POST</b>, add header <code>X-API-Key</code> = value (2), Request Body <b>JSON</b> with a single key <code>text</code> whose value is the magic variable <b>Shortcut Input</b> (tap the field → Select Variable → Shortcut Input).</Typography></li>
                <li><Typography variant="body2">Name it "SMS Auto-Detect" and save (no need to add it to your Home Screen).</Typography></li>
                <li><Typography variant="body2">Settings app → <b>Shortcuts</b> → <b>Automation</b> tab → + → <b>Create Personal Automation</b> → <b>Message</b> → optionally filter by sender, or leave unfiltered to catch every bank SMS → Next → <b>Run Shortcut</b> → pick "SMS Auto-Detect" → turn <b>OFF</b> "Ask Before Running" → Done.</Typography></li>
              </Box>
            </Alert>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Advanced — download a pre-built shortcut file</Typography>
        <Alert severity="warning" sx={{ mb: 1 }}>
          <Typography variant="body2">
            Same signing caveat as above: on a stock iPhone this download <b>will fail to import</b>
            ("Can't Import Shortcut" / "isn't signed") unless you sign it on a Mac first
            (<code>shortcuts sign</code>). Use the <b>Setup Kit</b> above instead — it works on every
            iPhone with no signing.
          </Typography>
        </Alert>
        <Button
          variant="outlined"
          startIcon={smsScBusy ? <CircularProgress size={18} /> : <Download />}
          onClick={handleDownloadSmsShortcut}
          disabled={smsScBusy || !scBaseUrl.trim()}
        >
          {smsScBusy ? 'Generating…' : 'Download .shortcut file'}
        </Button>
      </Paper>

      {/* Ingest mapping */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Ingest Field Mapping</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Map the keys your Shortcut sends to transaction fields. Keys that already match a
          field name are mapped automatically; unmapped keys are stored as custom fields.
        </Typography>
        {rows.map((row, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
            <TextField size="small" label="Incoming JSON key" value={row.source} onChange={(e) => updateRow(i, 'source', e.target.value)} sx={{ flex: 1 }} />
            <Typography>→</Typography>
            <TextField size="small" select label="Transaction field" value={row.target} onChange={(e) => updateRow(i, 'target', e.target.value)} sx={{ flex: 1 }}>
              {targetFields.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <IconButton size="small" color="error" onClick={() => removeRow(i)}><Delete fontSize="small" /></IconButton>
          </Box>
        ))}
        <Button size="small" startIcon={<Add />} onClick={addRow} sx={{ mt: 1 }}>Add mapping</Button>

        <Divider sx={{ my: 2 }} />
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField size="small" select label="Attribute to bank" value={defaultBankId} onChange={(e) => setDefaultBankId(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">External (auto)</MenuItem>
            {banks.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Default type" value={defaultType} onChange={(e) => setDefaultType(e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="debit">debit</MenuItem>
            <MenuItem value="credit">credit</MenuItem>
          </TextField>
          <TextField size="small" label="Date format (optional, strptime)" placeholder="%d/%m/%Y" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} sx={{ minWidth: 220 }} />
        </Box>
        <Button variant="contained" onClick={handleSaveMapping} sx={{ mt: 2 }}>Save Mapping</Button>
      </Paper>

      {/* How to use */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>How to send data (iOS Shortcut / webhook)</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip label="POST" color="primary" size="small" />
          <code>{`${API_BASE}/api/ingest/transaction`}</code>
          <Tooltip title="Copy URL"><IconButton size="small" onClick={() => copy(`${API_BASE}/api/ingest/transaction`)}><ContentCopy fontSize="small" /></IconButton></Tooltip>
        </Box>
        <Typography variant="body2" sx={{ mb: 1 }}>Header: <code>X-API-Key: &lt;your token&gt;</code></Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>Minimal body — only amount + description are required (date defaults to now, type to expense):</Typography>
        <Box component="pre" sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, overflow: 'auto', fontSize: 13 }}>{`{ "amount": 250, "description": "Swiggy dinner" }`}</Box>
        <Typography variant="body2" sx={{ mt: 1, mb: 1 }}>Full body (all optional except amount + description):</Typography>
        <Box component="pre" sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, overflow: 'auto', fontSize: 13 }}>{exampleBody}</Box>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Friendly aliases: <code>amt/value/price → amount</code>, <code>merchant/payee/title → description</code>,
          <code> type</code> (expense/income), <code>account/bank</code> (by name), <code>labels</code> (names),
          <code> cat → category</code>. Your Automatic Rules auto-fill category + labels from keywords.
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2, fontWeight: 600 }}>Build the iOS Shortcut (6 steps)</Typography>
        <Box component="ol" sx={{ pl: 3, my: 1, '& li': { mb: 0.5 } }}>
          <li><Typography variant="body2">Shortcuts app → new shortcut → <b>Ask for Input</b> (Number) for the amount.</Typography></li>
          <li><Typography variant="body2"><b>Ask for Input</b> (Text) for the description.</Typography></li>
          <li><Typography variant="body2"><b>Dictionary</b> → keys <code>amount</code> and <code>description</code> set to those inputs.</Typography></li>
          <li><Typography variant="body2"><b>Get Contents of URL</b> → POST the URL above, header <code>X-API-Key</code>, Request Body = JSON = the Dictionary.</Typography></li>
          <li><Typography variant="body2"><b>Show Notification</b> "Saved ✓".</Typography></li>
          <li><Typography variant="body2">Name it "Add Transaction", add to Home Screen / Siri.</Typography></li>
        </Box>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Bulk: <code>POST /api/ingest/transactions</code> with a JSON array (or {`{ "transactions": [...] }`}). Verify a token: <code>GET /api/ingest/ping</code>.
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2, fontWeight: 600 }}>Share Sheet / quick-text version</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Turn a copied SMS or any bit of text into a transaction from any app's Share menu:
        </Typography>
        <Box component="ol" sx={{ pl: 3, my: 1, '& li': { mb: 0.5 } }}>
          <li><Typography variant="body2">In the shortcut's settings, enable <b>Show in Share Sheet</b> (accept <b>Text</b>).</Typography></li>
          <li><Typography variant="body2">First action: <b>Get Text from Input</b> (the shared text) → <b>Raw</b>.</Typography></li>
          <li><Typography variant="body2">
            Either send it as the description with a fixed amount, or use <b>Match Text</b> (regex) to pull
            the amount out, e.g. <code>[0-9][0-9,]*\.?[0-9]*</code>, then build the request body with{' '}
            <code>amount</code> = the matched number and <code>description</code> = <b>Raw</b>.
          </Typography></li>
          <li><Typography variant="body2"><b>Get Contents of URL</b> — same POST as the interactive shortcut above.</Typography></li>
        </Box>
        <Typography variant="body2" color="text.secondary">
          Now from any app: <b>Share → Add Transaction</b>.
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2, fontWeight: 600 }}>Troubleshooting</Typography>
        <Table size="small" sx={{ mt: 1 }}>
          <TableHead>
            <TableRow><TableCell>Symptom</TableCell><TableCell>Fix</TableCell></TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>401 Unauthorized</code></TableCell>
              <TableCell>Missing/incorrect <code>X-API-Key</code> header, or the token was revoked. Recreate it above.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>422 missing/invalid fields</code></TableCell>
              <TableCell><code>amount</code> and <code>description</code> are required — make sure the shortcut sends real values for both.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Can't reach the server from the phone</TableCell>
              <TableCell>Use the server's LAN IP or HTTPS domain, never <code>localhost</code> — phone and server must be on the same network, or the server must be publicly reachable.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Transaction lands in "External" account</TableCell>
              <TableCell>No account matched the <code>account</code> name sent. Use the exact account name from Settings → Banks, or omit it.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Wrong/blank category</TableCell>
              <TableCell>Add/adjust a keyword rule in Settings → Automatic Rules, or send <code>category</code> explicitly.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Amount sign is wrong</TableCell>
              <TableCell>Send <code>type: "income"</code> for money in — otherwise it's recorded as an expense.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>

      {/* External dashboards / monitoring */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>External Dashboards & Monitoring</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Two read-only endpoints for homelab dashboards (e.g. <a href="https://gethomepage.dev/widgets/services/customapi/" target="_blank" rel="noreferrer">gethomepage.dev</a>'s
          <code> customapi</code> widget) or monitoring tools (Prometheus/Grafana). Both accept the same
          token as above, sent as either <code>X-API-Key: &lt;token&gt;</code> or{' '}
          <code>Authorization: Bearer &lt;token&gt;</code> — use whichever header format your tool expects.
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Chip label="GET" color="primary" size="small" />
          <code>{`${API_BASE}/api/summary`}</code>
          <Tooltip title="Copy URL"><IconButton size="small" onClick={() => copy(`${API_BASE}/api/summary`)}><ContentCopy fontSize="small" /></IconButton></Tooltip>
        </Box>
        <Typography variant="body2" sx={{ mb: 1 }}>Compact flat JSON, ideal for a dashboard widget's field mapping:</Typography>
        <Box component="pre" sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1, overflow: 'auto', fontSize: 13 }}>{`{
  "total_balance": 693313.41,
  "monthly_spend": 81181.51,
  "net_worth": 693313.41,
  "savings_total": 742443.36,
  "credit_total": 49129.95,
  "month_income": 171877.4,
  "month_expense": 81181.51,
  "month_net": 90695.89,
  "pending_transactions": 57
}`}</Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 1 }}>
          <Chip label="GET" color="primary" size="small" />
          <code>{`${API_BASE}/api/metrics`}</code>
          <Tooltip title="Copy URL"><IconButton size="small" onClick={() => copy(`${API_BASE}/api/metrics`)}><ContentCopy fontSize="small" /></IconButton></Tooltip>
        </Box>
        <Typography variant="body2">Prometheus text-exposition format, for scraping into Grafana or Prometheus directly.</Typography>
      </Paper>

      {/* Full API reference */}
      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" gutterBottom>Full API Reference</Typography>
        <Typography variant="body2" color="text.secondary">
          This app auto-generates interactive API docs for every endpoint (all of Transactions,
          Banks, Categories, Analytics, etc. — not just ingestion) straight from the running
          backend, so they're always in sync with this exact deployment:{' '}
          <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">{`${API_BASE}/docs`}</a>{' '}
          (Swagger UI, try requests right in the browser) or{' '}
          <a href={`${API_BASE}/redoc`} target="_blank" rel="noreferrer">{`${API_BASE}/redoc`}</a>{' '}
          (read-only reference).
        </Typography>
      </Paper>
    </Container>
  );
}
