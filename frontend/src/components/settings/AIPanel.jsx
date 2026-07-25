import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Button, Alert, Chip, Divider, Stack,
  TextField, MenuItem, FormControl, InputLabel, Select, FormControlLabel,
  Switch, Checkbox, CircularProgress, IconButton,
} from '@mui/material';
import {
  AutoAwesome, Science, Save, VpnKey, CheckCircle, Refresh,
  KeyboardArrowUp, KeyboardArrowDown,
} from '@mui/icons-material';
import { getAIConfig, updateAIConfig, testAI, getAIModels, getAIUsage, resetAIUsage } from '../../services/api';

const fmtTokens = (n) => Number(n || 0).toLocaleString();

// Providers, in the order they appear as enable checkboxes.
const PROVIDERS = [
  { id: 'claude', label: 'Claude (Anthropic)' },
  { id: 'gemini', label: 'Gemini (Google)' },
  { id: 'ollama', label: 'Ollama (local)' },
];
const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
const providerLabel = (id) => PROVIDERS.find((p) => p.id === id)?.label || id;

// All six AI-powered features, with human-readable labels.
const FEATURES = [
  { key: 'categorize', label: 'Auto-categorize transactions' },
  { key: 'insights', label: 'Spending insights' },
  { key: 'predict', label: 'Predict upcoming activity' },
  { key: 'query', label: 'Natural-language query' },
  { key: 'anomalies', label: 'Anomaly detection' },
  { key: 'summary', label: 'AI summary' },
];
const EMPTY_FEATURES = FEATURES.reduce((acc, f) => ({ ...acc, [f.key]: false }), {});

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8';
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_OLLAMA_MODEL = 'llama3';
const DEFAULT_OLLAMA_BASE_URL = 'http://host.docker.internal:11434';

// Extract a readable message from an axios error.
const apiError = (e, fallback) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail) return JSON.stringify(detail);
  return e?.message || fallback;
};

// Merge the currently selected model with any loaded list so the Select always
// has the current value as an option (and never loses a free-typed / saved model).
const buildModelOptions = (loaded, current) => {
  const out = [];
  if (current) out.push(current);
  (loaded || []).forEach((m) => {
    if (m && !out.includes(m)) out.push(m);
  });
  return out;
};

export default function AIPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Ordered priority list of ENABLED providers.
  const [providers, setProviders] = useState([]);

  // Per-provider model + loaded model list (null = not yet loaded) + status.
  const [claudeModel, setClaudeModel] = useState(DEFAULT_CLAUDE_MODEL);
  const [claudeModels, setClaudeModels] = useState(null);
  const [claudeLoadingModels, setClaudeLoadingModels] = useState(false);
  const [claudeModelMsg, setClaudeModelMsg] = useState(null);

  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [geminiModels, setGeminiModels] = useState(null);
  const [geminiLoadingModels, setGeminiLoadingModels] = useState(false);
  const [geminiModelMsg, setGeminiModelMsg] = useState(null);

  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(DEFAULT_OLLAMA_BASE_URL);
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [ollamaModels, setOllamaModels] = useState(null);
  const [ollamaLoadingModels, setOllamaLoadingModels] = useState(false);
  const [ollamaModelMsg, setOllamaModelMsg] = useState(null);

  const [features, setFeatures] = useState(EMPTY_FEATURES);

  const [claudeKeySet, setClaudeKeySet] = useState(false);
  const [geminiKeySet, setGeminiKeySet] = useState(false);
  const [available, setAvailable] = useState({ claude: false, gemini: false, ollama: false });

  // Per-provider key editing: action is 'keep' | 'set' | 'clear'.
  const [claudeKey, setClaudeKey] = useState('');
  const [claudeAction, setClaudeAction] = useState('set');
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiAction, setGeminiAction] = useState('set');

  // Per-provider test result: { ok, message } | null, plus loading flags.
  const [claudeTest, setClaudeTest] = useState(null);
  const [claudeTesting, setClaudeTesting] = useState(false);
  const [geminiTest, setGeminiTest] = useState(null);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [ollamaTest, setOllamaTest] = useState(null);
  const [ollamaTesting, setOllamaTesting] = useState(false);

  // Token usage per provider:model
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      setUsage(await getAIUsage());
    } catch {
      setUsage({ usage: [], totals: {} });
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const handleResetUsage = useCallback(async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Reset the token usage counters to zero?')) return;
    try {
      await resetAIUsage();
      await loadUsage();
    } catch {
      /* non-fatal */
    }
  }, [loadUsage]);

  const applyConfig = useCallback((cfg) => {
    const ordered = Array.isArray(cfg.providers)
      ? cfg.providers.filter((p) => PROVIDER_IDS.includes(p))
      : [];
    setProviders(ordered);

    setClaudeModel(cfg.claude?.model || DEFAULT_CLAUDE_MODEL);
    setGeminiModel(cfg.gemini?.model || DEFAULT_GEMINI_MODEL);
    setOllamaModel(cfg.ollama?.model || DEFAULT_OLLAMA_MODEL);
    setOllamaBaseUrl(cfg.ollama?.base_url || DEFAULT_OLLAMA_BASE_URL);

    setFeatures(FEATURES.reduce((acc, f) => ({ ...acc, [f.key]: !!cfg.features?.[f.key] }), {}));

    setClaudeKeySet(!!cfg.claude_key_set);
    setGeminiKeySet(!!cfg.gemini_key_set);
    setAvailable({
      claude: !!cfg.available?.claude,
      gemini: !!cfg.available?.gemini,
      ollama: !!cfg.available?.ollama,
    });

    // Reset any in-progress edits / transient UI to match the freshly loaded state.
    setClaudeKey('');
    setGeminiKey('');
    setClaudeAction(cfg.claude_key_set ? 'keep' : 'set');
    setGeminiAction(cfg.gemini_key_set ? 'keep' : 'set');
    setClaudeModels(null);
    setGeminiModels(null);
    setOllamaModels(null);
    setClaudeModelMsg(null);
    setGeminiModelMsg(null);
    setOllamaModelMsg(null);
    setClaudeTest(null);
    setGeminiTest(null);
    setOllamaTest(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const cfg = await getAIConfig();
      applyConfig(cfg);
    } catch (e) {
      setError(apiError(e, 'Failed to load AI settings'));
    } finally {
      setLoading(false);
    }
  }, [applyConfig]);

  useEffect(() => {
    load();
    loadUsage();
  }, [load, loadUsage]);

  // ---- Provider enable / ordering ------------------------------------------
  const isEnabled = (id) => providers.includes(id);

  const toggleProvider = (id) => {
    setProviders((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const moveProvider = (index, dir) => {
    setProviders((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // ---- Model loading --------------------------------------------------------
  const handleLoadModels = async (which) => {
    const map = {
      claude: {
        setLoading: setClaudeLoadingModels,
        setModels: setClaudeModels,
        setMsg: setClaudeModelMsg,
        params: { api_key: claudeAction === 'set' && claudeKey ? claudeKey : undefined },
      },
      gemini: {
        setLoading: setGeminiLoadingModels,
        setModels: setGeminiModels,
        setMsg: setGeminiModelMsg,
        params: { api_key: geminiAction === 'set' && geminiKey ? geminiKey : undefined },
      },
      ollama: {
        setLoading: setOllamaLoadingModels,
        setModels: setOllamaModels,
        setMsg: setOllamaModelMsg,
        params: { base_url: ollamaBaseUrl || undefined },
      },
    };
    const { setLoading: setL, setModels, setMsg, params } = map[which];

    setL(true);
    setMsg(null);
    try {
      const res = await getAIModels(which, params);
      if (res?.ok && Array.isArray(res.models) && res.models.length) {
        setModels(res.models);
        setMsg({ ok: true, message: `Loaded ${res.models.length} model${res.models.length === 1 ? '' : 's'}.` });
      } else {
        // Defensive: keep the current model, just surface why loading failed.
        setMsg({ ok: false, message: res?.message || 'No models returned. Keeping the current model.' });
      }
    } catch (e) {
      setMsg({ ok: false, message: apiError(e, 'Failed to load models. Keeping the current model.') });
    } finally {
      setL(false);
    }
  };

  // ---- Test connection ------------------------------------------------------
  const handleTest = async (which) => {
    const map = {
      claude: {
        setTesting: setClaudeTesting,
        setResult: setClaudeTest,
        model: claudeModel,
        api_key: claudeAction === 'set' && claudeKey ? claudeKey : undefined,
      },
      gemini: {
        setTesting: setGeminiTesting,
        setResult: setGeminiTest,
        model: geminiModel,
        api_key: geminiAction === 'set' && geminiKey ? geminiKey : undefined,
      },
      ollama: {
        setTesting: setOllamaTesting,
        setResult: setOllamaTest,
        model: ollamaModel,
        api_key: undefined,
      },
    };
    const { setTesting, setResult, model, api_key } = map[which];

    setTesting(true);
    setResult(null);
    try {
      const payload = { provider: which, model };
      if (api_key) payload.api_key = api_key; // test a freshly typed key before saving
      const res = await testAI(payload);
      setResult({ ok: !!res?.ok, message: res?.message || (res?.ok ? 'Connection OK' : 'Test failed') });
    } catch (e) {
      setResult({ ok: false, message: apiError(e, 'Test failed') });
    } finally {
      setTesting(false);
    }
  };

  // ---- Save -----------------------------------------------------------------
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        providers,
        claude: { model: claudeModel },
        gemini: { model: geminiModel },
        ollama: { model: ollamaModel, base_url: ollamaBaseUrl },
        features,
      };
      // Only send a key when the user typed one; send '' to clear.
      if (claudeAction === 'set' && claudeKey) payload.claude_key = claudeKey;
      if (claudeAction === 'clear') payload.claude_key = '';
      if (geminiAction === 'set' && geminiKey) payload.gemini_key = geminiKey;
      if (geminiAction === 'clear') payload.gemini_key = '';

      const cfg = await updateAIConfig(payload);
      applyConfig(cfg);
      setSuccess('AI settings saved.');
    } catch (e) {
      setError(apiError(e, 'Failed to save AI settings'));
    } finally {
      setSaving(false);
    }
  };

  // ---- Reusable render helpers ---------------------------------------------
  // API-key management UI shared by Claude and Gemini.
  const renderKeyField = ({ keySet, action, setAction, keyValue, setKeyValue }) => {
    if (action === 'clear') {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Alert severity="warning" icon={false} sx={{ py: 0, flexGrow: 1 }}>
            Key will be removed when you save.
          </Alert>
          <Button size="small" onClick={() => setAction('keep')}>Undo</Button>
        </Box>
      );
    }
    if (action === 'keep' && keySet) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip icon={<VpnKey />} label="Key saved" color="success" variant="outlined" size="small" />
          <Button size="small" onClick={() => { setAction('set'); setKeyValue(''); }}>Replace</Button>
          <Button size="small" color="error" onClick={() => { setAction('clear'); setKeyValue(''); }}>Clear</Button>
        </Box>
      );
    }
    // action === 'set'
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <TextField
          type="password"
          size="small"
          label="API key"
          placeholder={keySet ? 'Enter a new key to replace' : 'Paste your API key'}
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
          autoComplete="off"
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        {keySet && (
          <Button size="small" onClick={() => { setAction('keep'); setKeyValue(''); }}>Cancel</Button>
        )}
      </Box>
    );
  };

  const renderTestResult = (result) =>
    result && (
      <Typography
        variant="body2"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: result.ok ? 'success.main' : 'error.main' }}
      >
        {result.ok && <CheckCircle fontSize="small" />}
        {result.message}
      </Typography>
    );

  // Model Select + Load models + Test, shared by all three providers.
  const renderModelRow = ({ which, model, setModel, models, loadingModels, modelMsg, testing, testResult }) => {
    const options = buildModelOptions(models, model);
    const labelId = `${which}-model-label`;
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 240, flexGrow: 1, maxWidth: 420 }}>
            <InputLabel id={labelId}>Model</InputLabel>
            <Select
              labelId={labelId}
              label="Model"
              value={options.includes(model) ? model : ''}
              displayEmpty
              onChange={(e) => setModel(e.target.value)}
            >
              {options.map((m) => (
                <MenuItem key={m} value={m}>{m}</MenuItem>
              ))}
              {!options.length && <MenuItem value="" disabled>Load models to choose</MenuItem>}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            size="small"
            startIcon={loadingModels ? <CircularProgress size={16} /> : <Refresh />}
            disabled={loadingModels}
            onClick={() => handleLoadModels(which)}
          >
            {loadingModels ? 'Loading…' : 'Load models'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={testing ? <CircularProgress size={16} /> : <Science />}
            disabled={testing}
            onClick={() => handleTest(which)}
          >
            {testing ? 'Testing…' : 'Test'}
          </Button>
        </Box>
        {modelMsg && (
          <Typography variant="caption" sx={{ color: modelMsg.ok ? 'success.main' : 'error.main' }}>
            {modelMsg.message}
          </Typography>
        )}
        {renderTestResult(testResult)}
      </>
    );
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <AutoAwesome color="primary" />
        <Typography variant="h6">AI</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Connect one or more AI providers to auto-categorize transactions, surface spending insights,
        answer questions and more.
      </Typography>
      <Divider sx={{ mb: 3 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Providers & priority */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Providers &amp; priority</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Enable the providers you want to use. AI calls try providers in this order and fall back to
          the next if one is unavailable.
        </Typography>

        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', mb: 2 }}>
          {PROVIDERS.map((p) => (
            <FormControlLabel
              key={p.id}
              control={
                <Checkbox
                  checked={isEnabled(p.id)}
                  // Allow unchecking a now-unavailable provider, but block enabling one.
                  disabled={!available[p.id] && !isEnabled(p.id)}
                  onChange={() => toggleProvider(p.id)}
                />
              }
              label={`${p.label}${!available[p.id] ? ' (unavailable)' : ''}`}
            />
          ))}
        </Stack>

        {providers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No providers enabled — AI features are turned off until you enable at least one.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {providers.map((id, idx) => (
              <Box
                key={id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 0.5,
                }}
              >
                <Chip label={idx + 1} color="primary" size="small" sx={{ fontWeight: 600 }} />
                <Typography variant="body2" sx={{ flexGrow: 1 }}>{providerLabel(id)}</Typography>
                <IconButton
                  size="small"
                  aria-label="Move up"
                  disabled={idx === 0}
                  onClick={() => moveProvider(idx, -1)}
                >
                  <KeyboardArrowUp fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Move down"
                  disabled={idx === providers.length - 1}
                  onClick={() => moveProvider(idx, 1)}
                >
                  <KeyboardArrowDown fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>

      {/* Claude */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Claude (Anthropic)</Typography>
        <Stack spacing={2}>
          {renderKeyField({
            keySet: claudeKeySet,
            action: claudeAction,
            setAction: setClaudeAction,
            keyValue: claudeKey,
            setKeyValue: setClaudeKey,
          })}
          {renderModelRow({
            which: 'claude',
            model: claudeModel,
            setModel: setClaudeModel,
            models: claudeModels,
            loadingModels: claudeLoadingModels,
            modelMsg: claudeModelMsg,
            testing: claudeTesting,
            testResult: claudeTest,
          })}
        </Stack>
      </Paper>

      {/* Gemini */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Gemini (Google)</Typography>
        <Stack spacing={2}>
          {renderKeyField({
            keySet: geminiKeySet,
            action: geminiAction,
            setAction: setGeminiAction,
            keyValue: geminiKey,
            setKeyValue: setGeminiKey,
          })}
          {renderModelRow({
            which: 'gemini',
            model: geminiModel,
            setModel: setGeminiModel,
            models: geminiModels,
            loadingModels: geminiLoadingModels,
            modelMsg: geminiModelMsg,
            testing: geminiTesting,
            testResult: geminiTest,
          })}
        </Stack>
      </Paper>

      {/* Ollama */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>Ollama (local)</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Runs locally with no API key. Works fully offline once you have pulled a model on the host
          (for example <code>ollama pull llama3</code>).
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Base URL"
            size="small"
            value={ollamaBaseUrl}
            onChange={(e) => setOllamaBaseUrl(e.target.value)}
            placeholder={DEFAULT_OLLAMA_BASE_URL}
            helperText={`Default ${DEFAULT_OLLAMA_BASE_URL}`}
            sx={{ maxWidth: 420 }}
            fullWidth
          />
          {renderModelRow({
            which: 'ollama',
            model: ollamaModel,
            setModel: setOllamaModel,
            models: ollamaModels,
            loadingModels: ollamaLoadingModels,
            modelMsg: ollamaModelMsg,
            testing: ollamaTesting,
            testResult: ollamaTest,
          })}
        </Stack>
      </Paper>

      {/* Feature toggles */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Features</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Choose which AI-powered features are enabled. These require at least one enabled provider.
        </Typography>
        <Stack>
          {FEATURES.map((f) => (
            <FormControlLabel
              key={f.key}
              control={
                <Switch
                  checked={!!features[f.key]}
                  onChange={(e) => setFeatures((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                />
              }
              label={f.label}
            />
          ))}
        </Stack>
      </Paper>

      {/* ---- Token usage per model ------------------------------------------ */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Token usage</Typography>
          <Box>
            <IconButton size="small" onClick={loadUsage} disabled={usageLoading} title="Refresh usage">
              <Refresh fontSize="small" />
            </IconButton>
            <Button size="small" color="inherit" onClick={handleResetUsage} sx={{ ml: 1 }}>
              Reset
            </Button>
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Tokens consumed per provider/model since the last reset (counted from each provider's response).
        </Typography>

        {usageLoading && !usage ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={22} />
          </Box>
        ) : !usage?.usage?.length ? (
          <Typography variant="body2" color="text.secondary">
            No AI calls recorded yet. Usage appears here after the first AI request.
          </Typography>
        ) : (
          <Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 0.8fr 0.8fr 0.9fr 0.6fr',
                gap: 1,
                py: 0.75,
                borderBottom: '2px solid',
                borderColor: 'divider',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              <Box>Model</Box>
              <Box sx={{ textAlign: 'right' }}>Input</Box>
              <Box sx={{ textAlign: 'right' }}>Output</Box>
              <Box sx={{ textAlign: 'right' }}>Total</Box>
              <Box sx={{ textAlign: 'right' }}>Calls</Box>
            </Box>
            {usage.usage.map((r) => (
              <Box
                key={`${r.provider}:${r.model}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1.6fr 0.8fr 0.8fr 0.9fr 0.6fr',
                  gap: 1,
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  fontSize: 13,
                  alignItems: 'center',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Chip size="small" label={providerLabel(r.provider)} sx={{ mr: 0.75, height: 20, fontSize: 11 }} />
                  <Typography component="span" variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {r.model || 'default'}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>{fmtTokens(r.input_tokens)}</Box>
                <Box sx={{ textAlign: 'right' }}>{fmtTokens(r.output_tokens)}</Box>
                <Box sx={{ textAlign: 'right', fontWeight: 600 }}>{fmtTokens(r.total_tokens)}</Box>
                <Box sx={{ textAlign: 'right' }}>{fmtTokens(r.calls)}</Box>
              </Box>
            ))}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 0.8fr 0.8fr 0.9fr 0.6fr',
                gap: 1,
                py: 0.75,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              <Box>Total</Box>
              <Box sx={{ textAlign: 'right' }}>{fmtTokens(usage.totals?.input_tokens)}</Box>
              <Box sx={{ textAlign: 'right' }}>{fmtTokens(usage.totals?.output_tokens)}</Box>
              <Box sx={{ textAlign: 'right' }}>{fmtTokens(usage.totals?.total_tokens)}</Box>
              <Box sx={{ textAlign: 'right' }}>{fmtTokens(usage.totals?.calls)}</Box>
            </Box>
          </Box>
        )}
      </Paper>

      <Alert severity="info" icon={false} sx={{ mb: 2 }}>
        API keys are stored encrypted on the server and are never shown again after saving. Leave a key
        field untouched to keep the existing key, or use <strong>Clear</strong> to remove it.
      </Alert>

      <Button
        variant="contained"
        startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <Save />}
        disabled={saving}
        onClick={handleSave}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </Box>
  );
}
