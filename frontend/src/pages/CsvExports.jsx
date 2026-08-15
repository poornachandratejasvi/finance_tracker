import React, { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
} from '@mui/material';
import { getBanks, getPDFs, emailCSV, generateAllCSV, generateBulkCSV, cleanupCsvExports, cleanupPdfs } from '../services/api';

const CsvExports = () => {
  const [banks, setBanks] = useState([]);
  const [pdfs, setPdfs] = useState([]);
  const [selectedBank, setSelectedBank] = useState('');
  const [selectedPdf, setSelectedPdf] = useState('');
  const [selectedPdfIds, setSelectedPdfIds] = useState([]);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [bulkBank, setBulkBank] = useState('');
  const [cleanupAgeDays, setCleanupAgeDays] = useState(30);
  const [cleanupMaxFiles, setCleanupMaxFiles] = useState(100);
  const [cleanupMaxTotalMb, setCleanupMaxTotalMb] = useState(500);
  const [cleanupDecrypted, setCleanupDecrypted] = useState(false);
  const [cleanupPdfAgeDays, setCleanupPdfAgeDays] = useState(90);
  const [cleanupPdfTransactions, setCleanupPdfTransactions] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadBanks = async () => {
    try {
      const result = await getBanks();
      setBanks(result || []);
    } catch (err) {
      setError('Failed to load banks');
    }
  };

  const loadPdfs = async (bankId) => {
    try {
      const params = {};
      if (bankId) params.bank_id = bankId;
      const result = await getPDFs(params);
      setPdfs(result.items || []);
    } catch (err) {
      setError('Failed to load PDFs');
    }
  };

  useEffect(() => {
    loadBanks();
    loadPdfs('');
  }, []);

  useEffect(() => {
    loadPdfs(selectedBank);
  }, [selectedBank]);

  const handleSendEmail = async () => {
    if (!selectedPdf) {
      setError('Select a PDF to send');
      return;
    }

    try {
      setLoading(true);
      await emailCSV(selectedPdf, { to_email: recipientEmail || undefined, delete_after: true });
      setSuccess('CSV emailed successfully');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to email CSV');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAll = async () => {
    try {
      setLoading(true);
      const result = await generateAllCSV(bulkBank || null);
      setSuccess(`Generated CSVs for ${result.processed} PDFs`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate CSVs');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSelected = async () => {
    if (!selectedPdfIds.length) {
      setError('Select PDFs to generate CSVs');
      return;
    }

    try {
      setLoading(true);
      const result = await generateBulkCSV(selectedPdfIds);
      const successCount = (result.results || []).filter((r) => r.success).length;
      setSuccess(`Generated ${successCount} CSVs`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate selected CSVs');
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupCsv = async () => {
    try {
      setLoading(true);
      const result = await cleanupCsvExports({
        max_age_days: cleanupAgeDays,
        max_files: cleanupMaxFiles,
        max_total_mb: cleanupMaxTotalMb,
        delete_csvs: true,
        delete_decrypted_pdfs: cleanupDecrypted,
        dry_run: false
      });
      setSuccess(`Cleanup completed. Deleted ${result.deleted_csvs.length} CSVs.`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to cleanup CSVs');
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupPdfs = async () => {
    if (!window.confirm('Delete old PDFs and related transactions? This cannot be undone.')) {
      return;
    }
    try {
      setLoading(true);
      const result = await cleanupPdfs({
        max_age_days: cleanupPdfAgeDays,
        delete_transactions: cleanupPdfTransactions,
        dry_run: false
      });
      setSuccess(`Deleted ${result.deleted_pdf_ids.length} PDFs`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to cleanup PDFs');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h4" sx={{ mb: 3 }}>CSV Exports</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Email CSV</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Bank</InputLabel>
              <Select value={selectedBank} onChange={(e) => setSelectedBank(e.target.value)} label="Bank">
                <MenuItem value="">All Banks</MenuItem>
                {banks.map((bank) => (
                  <MenuItem key={bank.id} value={bank.id}>{bank.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>PDF</InputLabel>
              <Select value={selectedPdf} onChange={(e) => setSelectedPdf(e.target.value)} label="PDF">
                {pdfs.map((pdf) => (
                  <MenuItem key={pdf.id} value={pdf.id}>{pdf.file_name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              label="Recipient Email (optional)"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              helperText="Uses bank CSV email if empty"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="contained" onClick={handleSendEmail} disabled={loading}>
              Send CSV
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Generate CSVs for Selected PDFs</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth>
              <InputLabel>PDFs</InputLabel>
              <Select
                multiple
                value={selectedPdfIds}
                onChange={(e) => setSelectedPdfIds(e.target.value)}
                label="PDFs"
                renderValue={(selected) => selected.map((id) => pdfs.find((pdf) => pdf.id === id)?.file_name || id).join(', ')}
              >
                {pdfs.map((pdf) => (
                  <MenuItem key={pdf.id} value={pdf.id}>{pdf.file_name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="contained" onClick={handleGenerateSelected} disabled={loading}>
              Generate Selected
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Bulk CSV Generation</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Bank</InputLabel>
              <Select value={bulkBank} onChange={(e) => setBulkBank(e.target.value)} label="Bank">
                <MenuItem value="">All Banks</MenuItem>
                {banks.map((bank) => (
                  <MenuItem key={bank.id} value={bank.id}>{bank.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="outlined" onClick={handleGenerateAll} disabled={loading}>
              Generate CSVs
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 3, mt: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Cleanup</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              type="number"
              label="CSV Max Age (days)"
              value={cleanupAgeDays}
              onChange={(e) => setCleanupAgeDays(parseInt(e.target.value, 10) || 0)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              type="number"
              label="CSV Max Files"
              value={cleanupMaxFiles}
              onChange={(e) => setCleanupMaxFiles(parseInt(e.target.value, 10) || 0)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              type="number"
              label="CSV Max Size (MB)"
              value={cleanupMaxTotalMb}
              onChange={(e) => setCleanupMaxTotalMb(parseInt(e.target.value, 10) || 0)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Delete Decrypted PDFs</InputLabel>
              <Select
                value={cleanupDecrypted ? 'yes' : 'no'}
                onChange={(e) => setCleanupDecrypted(e.target.value === 'yes')}
                label="Delete Decrypted PDFs"
              >
                <MenuItem value="no">No</MenuItem>
                <MenuItem value="yes">Yes</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="outlined" onClick={handleCleanupCsv} disabled={loading}>
              Cleanup CSVs
            </Button>
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              type="number"
              label="PDF Max Age (days)"
              value={cleanupPdfAgeDays}
              onChange={(e) => setCleanupPdfAgeDays(parseInt(e.target.value, 10) || 0)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>Delete Transactions</InputLabel>
              <Select
                value={cleanupPdfTransactions ? 'yes' : 'no'}
                onChange={(e) => setCleanupPdfTransactions(e.target.value === 'yes')}
                label="Delete Transactions"
              >
                <MenuItem value="yes">Yes</MenuItem>
                <MenuItem value="no">No</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="outlined" color="warning" onClick={handleCleanupPdfs} disabled={loading}>
              Cleanup PDFs
            </Button>
          </Grid>
        </Grid>
      </Paper>
    </Container>
  );
};

export default CsvExports;
