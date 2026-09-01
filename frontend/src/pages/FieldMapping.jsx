import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Grid,
  TextField,
  Card,
  CardContent,
  Divider,
  Alert,
  Chip,
  CircularProgress
} from '@mui/material';
import api, { getPDFs, downloadPDF, getPDFFields } from '../services/api';

const FieldMappingPage = () => {
  const [banks, setBanks] = useState([]);
  const [selectedBank, setSelectedBank] = useState('');
  const [mapping, setMapping] = useState(null);
  const [availableFields, setAvailableFields] = useState([]);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [bankPdfs, setBankPdfs] = useState([]);
  const [selectedPdfId, setSelectedPdfId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [detectedColumns, setDetectedColumns] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    loadBanks();
    loadAvailableFields();
  }, []);

  useEffect(() => {
    if (selectedBank) {
      loadFieldMapping();
      loadBankPdfs();
    }
  }, [selectedBank]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const loadBanks = async () => {
    try {
      const response = await api.get('/api/banks/');
      // API returns array directly, not wrapped in {banks: [...]}
      setBanks(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Error loading banks:', error);
      setBanks([]);
    }
  };

  const loadAvailableFields = async () => {
    try {
      const response = await api.get('/api/transactions/fields');
      setAvailableFields(response.data.standard_fields || []);
    } catch (error) {
      console.error('Error loading fields:', error);
    }
  };

  const loadFieldMapping = async () => {
    try {
      const response = await api.get(`/api/field-mapping/${selectedBank}`);
      setMapping(response.data.field_mapping || {
        date_field: '',
        description_field: '',
        amount_field: '',
        balance_field: '',
        debit_field: '',
        credit_field: ''
      });
    } catch (error) {
      console.error('Error loading field mapping:', error);
      // Initialize with empty mapping if not found
      setMapping({
        date_field: '',
        description_field: '',
        amount_field: '',
        balance_field: '',
        debit_field: '',
        credit_field: ''
      });
    }
  };

  const loadBankPdfs = async () => {
    try {
      const response = await getPDFs({ bank_id: selectedBank, limit: 500 });
      const items = response.items || [];
      setBankPdfs(items);
      if (items.length > 0) {
        const firstId = items[0].id;
        setSelectedPdfId(firstId);
        loadPdfPreview(firstId);
      } else {
        setSelectedPdfId('');
        setDetectedColumns([]);
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
          setPreviewUrl('');
        }
      }
    } catch (error) {
      console.error('Error loading bank PDFs:', error);
      setBankPdfs([]);
    }
  };

  const loadPdfPreview = async (pdfId) => {
    if (!pdfId) return;
    setPreviewLoading(true);
    try {
      const [blob, fields] = await Promise.all([
        downloadPDF(pdfId),
        getPDFFields(pdfId)
      ]);

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      const url = typeof URL !== 'undefined' && URL.createObjectURL
        ? URL.createObjectURL(blob)
        : '';
      setPreviewUrl(url);
      setDetectedColumns(fields.detected_columns || []);
    } catch (error) {
      console.error('Error loading PDF preview:', error);
      setDetectedColumns([]);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl('');
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleMappingChange = (field, value) => {
    setMapping({
      ...mapping,
      [field]: value
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    try {
      await api.post(`/api/field-mapping/${selectedBank}`, mapping);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving field mapping:', error);
      alert('Failed to save field mapping');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5 }} gutterBottom>
        PDF Field Mapping
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <FormControl fullWidth>
          <InputLabel>Select Bank</InputLabel>
          <Select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value)}
            label="Select Bank"
          >
            <MenuItem value="">-- Select a bank --</MenuItem>
            {banks.map((bank) => (
              <MenuItem key={bank.id} value={bank.id}>
                {bank.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Paper>

      {mapping && (
        <Paper sx={{ p: 3 }}>
          {success && (
            <Alert severity="success" sx={{ mb: 3 }}>
              Field mapping saved successfully!
            </Alert>
          )}

          <Typography variant="h6" gutterBottom>
            Map PDF Fields to Application Fields
          </Typography>

          <Typography variant="body2" color="text.secondary" paragraph>
            Configure how fields from PDF statements are mapped to application fields.
          </Typography>

          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid item xs={12} md={7}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    PDF Preview
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Select PDF</InputLabel>
                    <Select
                      value={selectedPdfId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedPdfId(id);
                        loadPdfPreview(id);
                      }}
                      label="Select PDF"
                    >
                      {bankPdfs.length === 0 && (
                        <MenuItem value="">No PDFs available</MenuItem>
                      )}
                      {bankPdfs.map((pdf) => (
                        <MenuItem key={pdf.id} value={pdf.id}>
                          {pdf.file_name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {previewLoading && (
                    <Box display="flex" alignItems="center" justifyContent="center" minHeight={240}>
                      <CircularProgress size={28} />
                    </Box>
                  )}

                  {!previewLoading && previewUrl && (
                    <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, overflow: 'hidden', height: 360 }}>
                      <iframe
                        title="PDF preview"
                        src={previewUrl}
                        style={{ width: '100%', height: '100%', border: 0 }}
                      />
                    </Box>
                  )}

                  {!previewLoading && !previewUrl && (
                    <Typography variant="body2" color="text.secondary">
                      Select a PDF to preview and inspect its columns.
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={5}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    Detected PDF Columns
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                  {detectedColumns.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No columns detected yet. Select a PDF to analyze.
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {detectedColumns.map((column) => (
                        <Chip key={column} label={column} size="small" />
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    Core Field Mappings
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Date Field</InputLabel>
                    <Select
                      value={mapping.date_field || ''}
                      onChange={(e) => handleMappingChange('date_field', e.target.value)}
                      label="Date Field"
                    >
                      {availableFields.map((field) => (
                        <MenuItem key={field.name} value={field.name}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Description Field</InputLabel>
                    <Select
                      value={mapping.description_field || ''}
                      onChange={(e) => handleMappingChange('description_field', e.target.value)}
                      label="Description Field"
                    >
                      {availableFields.map((field) => (
                        <MenuItem key={field.name} value={field.name}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Amount Field</InputLabel>
                    <Select
                      value={mapping.amount_field || ''}
                      onChange={(e) => handleMappingChange('amount_field', e.target.value)}
                      label="Amount Field"
                    >
                      {availableFields.map((field) => (
                        <MenuItem key={field.name} value={field.name}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Balance Field</InputLabel>
                    <Select
                      value={mapping.balance_field || ''}
                      onChange={(e) => handleMappingChange('balance_field', e.target.value)}
                      label="Balance Field"
                    >
                      <MenuItem value="">None</MenuItem>
                      {availableFields.map((field) => (
                        <MenuItem key={field.name} value={field.name}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" gutterBottom>
                    Format Settings
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  <TextField
                    label="Date Format"
                    value={mapping.date_format || ''}
                    onChange={(e) => handleMappingChange('date_format', e.target.value)}
                    fullWidth
                    sx={{ mb: 2 }}
                    helperText="e.g., %d/%m/%Y or %Y-%m-%d"
                  />

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Amount Format</InputLabel>
                    <Select
                      value={mapping.amount_format || 'standard'}
                      onChange={(e) => handleMappingChange('amount_format', e.target.value)}
                      label="Amount Format"
                    >
                      <MenuItem value="standard">Standard (123.45)</MenuItem>
                      <MenuItem value="indian">Indian (1,23,45.67)</MenuItem>
                      <MenuItem value="with_currency">With Currency (₹ 123.45)</MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Transaction Type Field</InputLabel>
                    <Select
                      value={mapping.type_field || ''}
                      onChange={(e) => handleMappingChange('type_field', e.target.value)}
                      label="Transaction Type Field"
                    >
                      <MenuItem value="">Auto-detect</MenuItem>
                      {availableFields.map((field) => (
                        <MenuItem key={field.name} value={field.name}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl fullWidth>
                    <InputLabel>Reference Field</InputLabel>
                    <Select
                      value={mapping.reference_field || ''}
                      onChange={(e) => handleMappingChange('reference_field', e.target.value)}
                      label="Reference Field"
                    >
                      <MenuItem value="">None</MenuItem>
                      {availableFields.map((field) => (
                        <MenuItem key={field.name} value={field.name}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            <Button variant="outlined" onClick={() => setSelectedBank('')}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Mapping'}
            </Button>
          </Box>
        </Paper>
      )}
    </Box>
  );
};

export default FieldMappingPage;
