import React, { useEffect, useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Grid,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  CircularProgress,
  Chip,
  Switch,
  FormControlLabel,
  TextField,
  Grow,
  Divider,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { getBanks, previewImportFile, commitImport, suggestValueMap, createBank, getCurrencies } from '../services/api';

const FIELD_DEFS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'type', label: 'Type (debit/credit)', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'notes', label: 'Notes', required: false },
  // Only relevant for a CSV covering multiple accounts/currencies (an export
  // from another app) -- mapping either of these unlocks the "map values"
  // step below, which routes each row to the real account/currency instead
  // of everything going to the one selected "Account" above.
  { key: 'bank', label: 'Bank / Account / Card', required: false },
  { key: 'currency', label: 'Currency', required: false },
];

export default function Imports() {
  const [banks, setBanks] = useState([]);
  const [bankId, setBankId] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  // Value-mapping ("map values") state -- only used when mapping.bank /
  // mapping.currency is set. Keyed by the raw CSV string found in that
  // column, not by row index (a 2000-row file might only have 3 distinct
  // account names in it).
  const [currencies, setCurrencies] = useState([]);
  const [bankValueMap, setBankValueMap] = useState({});
  const [bankSuggestions, setBankSuggestions] = useState({});
  const [currencyValueMap, setCurrencyValueMap] = useState({});
  const [currencySuggestions, setCurrencySuggestions] = useState({});
  const [newBankFor, setNewBankFor] = useState(null);
  const [newBankName, setNewBankName] = useState('');
  const [creatingBank, setCreatingBank] = useState(false);

  useEffect(() => {
    getBanks()
      .then((list) => {
        setBanks(list);
        if (list.length > 0) setBankId(list[0].id);
      })
      .catch(() => {});
    getCurrencies().then(setCurrencies).catch(() => {});
  }, []);

  const distinctValuesForColumn = (colName) => {
    if (!preview || !colName) return [];
    const idx = preview.columns.indexOf(colName);
    if (idx < 0) return [];
    const seen = new Set();
    preview.rows.forEach((row) => {
      const v = (row[idx] || '').trim();
      if (v) seen.add(v);
    });
    return Array.from(seen);
  };

  // Re-run whenever the bank/currency column mapping changes -- fetches a
  // best-guess match per distinct value so most rows need zero manual work,
  // while anything below the confidence bar is left for the user to pick.
  useEffect(() => {
    if (!preview || !mapping.bank) {
      setBankSuggestions({});
      return;
    }
    const values = distinctValuesForColumn(mapping.bank);
    if (values.length === 0) return;
    suggestValueMap(values, 'bank')
      .then((suggestions) => {
        const byValue = Object.fromEntries(suggestions.map((s) => [s.value, s]));
        setBankSuggestions(byValue);
        setBankValueMap((prev) => {
          const next = { ...prev };
          suggestions.forEach((s) => {
            if (s.auto_matched && s.suggested_id && next[s.value] == null) next[s.value] = s.suggested_id;
          });
          return next;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping.bank, preview]);

  useEffect(() => {
    if (!preview || !mapping.currency) {
      setCurrencySuggestions({});
      return;
    }
    const values = distinctValuesForColumn(mapping.currency);
    if (values.length === 0) return;
    suggestValueMap(values, 'currency')
      .then((suggestions) => {
        const byValue = Object.fromEntries(suggestions.map((s) => [s.value, s]));
        setCurrencySuggestions(byValue);
        setCurrencyValueMap((prev) => {
          const next = { ...prev };
          suggestions.forEach((s) => {
            if (s.auto_matched && s.suggested_code && next[s.value] == null) next[s.value] = s.suggested_code;
          });
          return next;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping.currency, preview]);

  const handleCreateBank = async () => {
    if (!newBankName.trim()) return;
    setCreatingBank(true);
    try {
      const created = await createBank({ name: newBankName.trim(), bank_type: 'other' });
      setBanks((prev) => [...prev, created]);
      setBankValueMap((m) => ({ ...m, [newBankFor]: created.id }));
      setNewBankFor(null);
      setNewBankName('');
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Could not create that bank.');
    } finally {
      setCreatingBank(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setErr('');
    setResult(null);
    setPreview(null);
    setFileName(file.name);
    setLoading(true);
    try {
      const data = await previewImportFile(file);
      setPreview(data);
      setMapping(data.suggested_mapping || {});
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't read that file.");
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const onCancel = () => {
    setPreview(null);
    setMapping({});
    setFileName('');
    setResult(null);
    setErr('');
    setBankValueMap({});
    setBankSuggestions({});
    setCurrencyValueMap({});
    setCurrencySuggestions({});
    setNewBankFor(null);
  };

  const onImport = async () => {
    if (!preview || !bankId) return;
    setImporting(true);
    setErr('');
    setResult(null);
    try {
      const payload = {
        bank_id: bankId,
        columns: preview.columns,
        rows: preview.rows,
        mapping: {
          date: mapping.date,
          description: mapping.description,
          amount: mapping.amount,
          type: mapping.type || undefined,
          category: mapping.category || undefined,
          notes: mapping.notes || undefined,
          bank: mapping.bank || undefined,
          currency: mapping.currency || undefined,
        },
        value_map: (mapping.bank || mapping.currency)
          ? {
              bank: mapping.bank ? Object.fromEntries(Object.entries(bankValueMap).filter(([, v]) => v)) : undefined,
              currency: mapping.currency
                ? Object.fromEntries(Object.entries(currencyValueMap).filter(([, v]) => v))
                : undefined,
            }
          : undefined,
        skip_duplicates: skipDuplicates,
      };
      const data = await commitImport(payload);
      setResult(data);
      if (data.created > 0) {
        setPreview(null);
        setMapping({});
        setFileName('');
        setBankValueMap({});
        setBankSuggestions({});
        setCurrencyValueMap({});
        setCurrencySuggestions({});
        setNewBankFor(null);
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || "Couldn't import. Please check your column mapping.");
    } finally {
      setImporting(false);
    }
  };

  const canImport = !!(preview && mapping.date && mapping.description && mapping.amount && bankId);

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5 }} gutterBottom>
        Imports
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>Account</InputLabel>
          <Select value={bankId} label="Account" onChange={(e) => setBankId(e.target.value)}>
            {banks.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Box
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          sx={{
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'divider',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            bgcolor: dragOver ? 'action.hover' : 'transparent',
          }}
        >
          <Button variant="contained" component="label" startIcon={<UploadFileIcon />}>
            Choose file
            <input type="file" hidden accept=".csv,.xlsx,.ofx,.qfx" onChange={(e) => handleFile(e.target.files?.[0])} />
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            or drag and drop it here
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            .csv, .xlsx, .ofx, or .qfx, up to 2000 rows
          </Typography>
          {fileName && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {fileName}
            </Typography>
          )}
        </Box>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </Paper>

      {err && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setErr('')}>
          {err}
        </Alert>
      )}
      {result && (
        <Alert severity={result.errors.length > 0 ? 'warning' : 'success'} sx={{ mb: 3 }} onClose={() => setResult(null)}>
          Imported {result.created} transaction{result.created === 1 ? '' : 's'}
          {result.skipped_duplicates > 0
            ? `, skipped ${result.skipped_duplicates} duplicate${result.skipped_duplicates === 1 ? '' : 's'}`
            : ''}
          {result.errors.length > 0 ? `, ${result.errors.length} row(s) had errors` : ''}.
        </Alert>
      )}

      {preview && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Map columns
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            Found {preview.total_rows} row{preview.total_rows === 1 ? '' : 's'}. Match each spreadsheet column to a
            field, then import.
          </Typography>

          <Grid container spacing={2} sx={{ mb: 3 }}>
            {FIELD_DEFS.map((f) => (
              <Grid item xs={12} sm={6} md={4} key={f.key}>
                <FormControl fullWidth size="small">
                  <InputLabel>
                    {f.label}
                    {f.required ? ' *' : ''}
                  </InputLabel>
                  <Select
                    value={mapping[f.key] || ''}
                    label={`${f.label}${f.required ? ' *' : ''}`}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))}
                  >
                    <MenuItem value="">{f.required ? '-- select --' : '(none)'}</MenuItem>
                    {preview.columns.map((c) => (
                      <MenuItem key={c} value={c}>
                        {c}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            ))}
          </Grid>

          {mapping.bank && (
            <Box sx={{ mb: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" gutterBottom>Map bank/account values</Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Point each distinct value found in "{mapping.bank}" at the real account it belongs to. Anything left
                unmapped falls back to the Account selected above.
              </Typography>
              {distinctValuesForColumn(mapping.bank).map((value, i) => {
                const suggestion = bankSuggestions[value];
                return (
                  <Grow in key={value} timeout={300} style={{ transitionDelay: `${Math.min(i, 10) * 40}ms` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.25 }}>
                      <Chip
                        label={value}
                        size="small"
                        icon={suggestion?.auto_matched ? <CheckCircleIcon sx={{ fontSize: 16 }} /> : <HelpOutlineIcon sx={{ fontSize: 16 }} />}
                        color={suggestion?.auto_matched ? 'success' : 'default'}
                        variant={suggestion?.auto_matched ? 'filled' : 'outlined'}
                        sx={{ minWidth: 160, justifyContent: 'flex-start' }}
                      />
                      <FormControl size="small" sx={{ minWidth: 260 }}>
                        <Select
                          value={bankValueMap[value] || ''}
                          displayEmpty
                          onChange={(e) => {
                            if (e.target.value === '__new__') {
                              setNewBankFor(value);
                              setNewBankName(value);
                              return;
                            }
                            setBankValueMap((m) => ({ ...m, [value]: e.target.value }));
                          }}
                        >
                          <MenuItem value="">
                            Use default ({banks.find((b) => b.id === bankId)?.name || 'selected account'})
                          </MenuItem>
                          {banks.map((b) => (
                            <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                          ))}
                          <MenuItem value="__new__">+ Create new bank…</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                  </Grow>
                );
              })}
              {newBankFor && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                  <TextField
                    size="small" label="New bank name" value={newBankName}
                    onChange={(e) => setNewBankName(e.target.value)} autoFocus
                  />
                  <Button size="small" variant="contained" onClick={handleCreateBank} disabled={creatingBank}>
                    {creatingBank ? <CircularProgress size={16} color="inherit" /> : 'Create'}
                  </Button>
                  <Button size="small" onClick={() => setNewBankFor(null)}>Cancel</Button>
                </Box>
              )}
            </Box>
          )}

          {mapping.currency && (
            <Box sx={{ mb: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" gutterBottom>Map currency values</Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Point each distinct value found in "{mapping.currency}" at one of your configured currencies. Anything
                left unmapped inherits the account's own currency.
              </Typography>
              {distinctValuesForColumn(mapping.currency).map((value, i) => {
                const suggestion = currencySuggestions[value];
                return (
                  <Grow in key={value} timeout={300} style={{ transitionDelay: `${Math.min(i, 10) * 40}ms` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.25 }}>
                      <Chip
                        label={value}
                        size="small"
                        icon={suggestion?.auto_matched ? <CheckCircleIcon sx={{ fontSize: 16 }} /> : <HelpOutlineIcon sx={{ fontSize: 16 }} />}
                        color={suggestion?.auto_matched ? 'success' : 'default'}
                        variant={suggestion?.auto_matched ? 'filled' : 'outlined'}
                        sx={{ minWidth: 160, justifyContent: 'flex-start' }}
                      />
                      <FormControl size="small" sx={{ minWidth: 260 }}>
                        <Select
                          value={currencyValueMap[value] || ''}
                          displayEmpty
                          onChange={(e) => setCurrencyValueMap((m) => ({ ...m, [value]: e.target.value }))}
                        >
                          <MenuItem value="">Inherit from account</MenuItem>
                          {currencies.map((c) => (
                            <MenuItem key={c.id} value={c.code}>{c.code} — {c.name || c.code}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  </Grow>
                );
              })}
            </Box>
          )}

          <FormControlLabel
            control={<Switch checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />}
            label="Skip rows that match an existing transaction"
            sx={{ mb: 2 }}
          />

          <Typography variant="subtitle2" gutterBottom>
            Preview (first 5 rows)
          </Typography>
          <Box sx={{ overflowX: 'auto', mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {preview.columns.map((c) => {
                    const mappedField = FIELD_DEFS.find((f) => mapping[f.key] === c);
                    return (
                      <TableCell key={c}>
                        {c}
                        {mappedField && <Chip size="small" sx={{ ml: 1 }} label={mappedField.label} />}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.rows.slice(0, 5).map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => (
                      <TableCell key={j}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
            <Button onClick={onCancel}>Cancel</Button>
            <Button
              variant="contained"
              onClick={onImport}
              disabled={!canImport || importing}
              startIcon={importing ? <CircularProgress size={16} color="inherit" /> : null}
            >
              Import
            </Button>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
