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
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { getBanks, previewImportFile, commitImport } from '../services/api';

const FIELD_DEFS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'type', label: 'Type (debit/credit)', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'notes', label: 'Notes', required: false },
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

  useEffect(() => {
    getBanks()
      .then((list) => {
        setBanks(list);
        if (list.length > 0) setBankId(list[0].id);
      })
      .catch(() => {});
  }, []);

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
        },
        skip_duplicates: skipDuplicates,
      };
      const data = await commitImport(payload);
      setResult(data);
      if (data.created > 0) {
        setPreview(null);
        setMapping({});
        setFileName('');
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
      <Typography variant="h4" gutterBottom>
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
