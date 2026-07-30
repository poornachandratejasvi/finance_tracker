import React, { useState, useEffect, useCallback } from 'react';
import {
  Container, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Box, Button, Chip, Alert, CircularProgress, Grid, Card, CardContent,
  FormControl, InputLabel, Select, MenuItem, IconButton, Tooltip, TablePagination, Checkbox,
  TextField, TableSortLabel
} from '@mui/material';
import { Download, Refresh, CheckCircle, Error, Lock, Delete } from '@mui/icons-material';
import { getPDFs, getPDFStats, reprocessPDF, reprocessAllPDFs, downloadPDF, getBanks, startSync, remapPDFBank, deletePDFsBySender } from '../services/api';
import api from '../services/api';
import PDFPasswordDialog from '../components/PDFPasswordDialog';

function PDFManagement() {
  const [pdfs, setPdfs] = useState([]);
  const [stats, setStats] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [bankFilter, setBankFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [fromEmailFilter, setFromEmailFilter] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [passwordDialog, setPasswordDialog] = useState({ open: false, pdf: null });
  const [selectedPdfIds, setSelectedPdfIds] = useState([]);
  const [bulkBankId, setBulkBankId] = useState('');
  const [sortBy, setSortBy] = useState('id');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (field) => {
    setPage(0);
    setSortDir((prevDir) => (sortBy === field ? (prevDir === 'asc' ? 'desc' : 'asc') : 'desc'));
    setSortBy(field);
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        skip: page * rowsPerPage,
        limit: rowsPerPage,
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      if (bankFilter.length) params.bank_id = bankFilter.join(',');
      if (statusFilter.length) params.is_processed = statusFilter.join(',');
      if (fromEmailFilter.trim()) params.from_email = fromEmailFilter.trim();

      const [pdfsData, statsData, banksData] = await Promise.all([
        getPDFs(params),
        getPDFStats(),
        getBanks()
      ]);

      setPdfs(pdfsData.items || []);
      setTotal(pdfsData.total || 0);
      setStats(statsData.stats || []);
      setBanks(banksData || []);
    } catch (err) {
      setError('Failed to load PDF data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, bankFilter, statusFilter, fromEmailFilter, sortBy, sortDir]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setSelectedPdfIds((prev) => prev.filter((id) => pdfs.some((pdf) => pdf.id === id)));
  }, [pdfs]);

  const handleReprocess = async (pdfId, fileName) => {
    if (!window.confirm(`Reprocess ${fileName}? This will delete existing transactions and re-extract them.`)) {
      return;
    }

    try {
      setLoading(true);
      const result = await reprocessPDF(pdfId);
      setSuccess(`Reprocessed ${result.file_name}: ${result.transactions_deleted} deleted, ${result.transactions_added} added`);
      fetchData();
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to reprocess PDF';
      setError(detail);
      const pdf = pdfs.find((item) => item.id === pdfId);
      if (pdf?.is_password_protected && /password|protected/i.test(detail)) {
        setPasswordDialog({ open: true, pdf });
      }
    } finally {
      setLoading(false);
    }
  };

  // Bulk endpoints only accept a single optional bank_id; the Status/From-Email filters
  // shown in the table are NOT applied to bulk actions. Make the real scope explicit.
  const bulkScope = () => (bankFilter.length === 1 ? 'the selected bank' : 'ALL banks');
  const filtersActive = () => (statusFilter.length > 0 || fromEmailFilter.trim() !== '');
  const filterNote = () => (filtersActive()
    ? `\n\nNote: the Status / From-Email filters shown are NOT applied — this runs on ${bulkScope()}.`
    : '');

  const handleBulkReprocess = async () => {
    const bankId = bankFilter.length === 1 ? bankFilter[0] : null;
    if (!window.confirm(`Reprocess all PDFs for ${bulkScope()}?${filterNote()}`)) {
      return;
    }

    try {
      setLoading(true);
      const result = await reprocessAllPDFs(bankId);
      setSuccess(`Reprocessed ${result.processed} PDFs`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to bulk reprocess PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleReassignBanks = async () => {
    const bankId = bankFilter.length === 1 ? bankFilter[0] : null;
    if (!window.confirm(`Reassign bank names for PDFs using detected bank info (${bulkScope()})?${filterNote()}`)) {
      return;
    }

    try {
      setLoading(true);
      const params = bankId ? `?bank_id=${bankId}` : '';
      const response = await api.post(`/api/pdfs/reassign-banks${params}`);
      setSuccess(`Reassigned ${response.data.updated} PDFs (checked ${response.data.checked})`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reassign bank names');
    } finally {
      setLoading(false);
    }
  };

  const handleDecryptAll = async () => {
    const bankId = bankFilter.length === 1 ? bankFilter[0] : null;
    if (!window.confirm(`Create decrypted copies for all protected PDFs (${bulkScope()})?${filterNote()}`)) {
      return;
    }

    try {
      setLoading(true);
      const params = bankId ? `?bank_id=${bankId}` : '';
      const response = await api.post(`/api/pdfs/decrypt-all${params}`);
      setSuccess(`Decrypted ${response.data.decrypted} PDFs (skipped ${response.data.skipped})`);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to decrypt PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAndReimport = async () => {
    const bankId = bankFilter.length === 1 ? bankFilter[0] : null;
    // Destructive + filters aren't applied → block if a Status/From-Email filter is set,
    // so the user never deletes far more than the filtered table implies.
    if (filtersActive()) {
      setError('Clear the Status / From-Email filters before "Delete & Re-import" — they are not applied to this action and it would delete more than the table shows.');
      return;
    }
    const scope = bankId ? 'the selected bank' : 'ALL banks (every PDF and transaction)';
    if (!window.confirm(`Delete all PDFs and re-import from Gmail for ${scope}? This removes PDF records and transactions and cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      await api.post('/api/pdfs/reset', {
        bank_id: bankId || null,
        delete_transactions: true,
        delete_emails: true
      });
      await startSync({ gmail_account_id: null, sync_type: 'full' });
      setSuccess('Deleted PDFs. Full Gmail sync started to re-import.');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete and re-import PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedPdfIds(pdfs.map((pdf) => pdf.id));
    } else {
      setSelectedPdfIds([]);
    }
  };

  const handleSelectOne = (pdfId) => {
    setSelectedPdfIds((prev) => (
      prev.includes(pdfId) ? prev.filter((id) => id !== pdfId) : [...prev, pdfId]
    ));
  };

  const handleBulkRemap = async () => {
    if (!bulkBankId || selectedPdfIds.length === 0) {
      setError('Select at least one PDF and a target bank');
      return;
    }
    if (!window.confirm(`Remap ${selectedPdfIds.length} PDFs to the selected bank?`)) {
      return;
    }

    try {
      setLoading(true);
      const result = await remapPDFBank(selectedPdfIds, bulkBankId);
      setSuccess(`Remapped ${result.updated} PDFs (skipped ${result.skipped})`);
      setSelectedPdfIds([]);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to remap PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBySender = async () => {
    const email = fromEmailFilter.trim();
    if (!email) {
      setError('Enter a sender email in the filter box first, then click Delete by Sender');
      return;
    }
    if (!window.confirm(`Delete ALL PDFs (and transactions) from sender matching "${email}"? This cannot be undone.`)) {
      return;
    }
    try {
      setLoading(true);
      const bankId = bankFilter.length === 1 ? bankFilter[0] : null;
      const result = await deletePDFsBySender(email, bankId, true);
      setSuccess(`Deleted ${result.deleted_pdfs} PDFs and ${result.deleted_transactions} transactions from "${email}"`);
      setFromEmailFilter('');
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete PDFs by sender');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (pdfId, fileName) => {
    try {
      const blob = await downloadPDF(pdfId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError('Failed to download PDF');
    }
  };

  const handleUnlock = (pdf) => {
    setPasswordDialog({ open: true, pdf });
  };

  const handlePasswordSuccess = (result) => {
    setSuccess(result.message || 'Password saved successfully');
    setPasswordDialog({ open: false, pdf: null });
    fetchData();
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const pageSelectedCount = pdfs.filter((pdf) => selectedPdfIds.includes(pdf.id)).length;
  const allSelected = pdfs.length > 0 && pageSelectedCount === pdfs.length;
  const someSelected = pageSelectedCount > 0 && pageSelectedCount < pdfs.length;

  if (loading && pdfs.length === 0) {
    return (
      <Container>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">PDF Management</Typography>
        <Box display="flex" gap={2}>
          <Button variant="outlined" onClick={handleBulkReprocess} disabled={loading}>
            Bulk Reprocess
          </Button>
            <Button variant="outlined" onClick={handleDecryptAll} disabled={loading}>
              Bulk Decrypt
            </Button>
          <Button variant="outlined" onClick={handleReassignBanks} disabled={loading}>
            Reassign Banks
          </Button>
            <Button variant="outlined" color="error" onClick={handleDeleteAndReimport} disabled={loading}>
              Delete & Re-import
            </Button>
          <Button variant="contained" startIcon={<Refresh />} onClick={fetchData} disabled={loading}>
            Refresh
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}

      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {stats.map((stat) => (
          <Grid item xs={12} sm={6} md={4} key={stat.bank_id}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="primary" gutterBottom>{stat.bank_name}</Typography>
                <Box display="flex" justifyContent="space-between" mt={2}>
                  <Box>
                    <Typography variant="body2" color="textSecondary">Total PDFs</Typography>
                    <Typography variant="h5">{stat.total_pdfs}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2" color="textSecondary">Processed</Typography>
                    <Typography variant="h5" color="success.main">{stat.processed_pdfs}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2" color="textSecondary">Pending</Typography>
                    <Typography variant="h5" color="error.main">{stat.unprocessed_pdfs}</Typography>
                  </Box>
                </Box>
                {stat.period_start && (
                  <Typography variant="body2" color="textSecondary" mt={1}>
                    Period: {formatDate(stat.period_start)} - {formatDate(stat.period_end)}
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth>
              <InputLabel>Bank</InputLabel>
              <Select
                multiple
                value={bankFilter}
                onChange={(e) => setBankFilter(Array.isArray(e.target.value) && e.target.value.includes('__all__') ? [] : e.target.value)}
                label="Bank"
                renderValue={(selected) => (selected.length ? selected.map(id => banks.find(b => b.id === id)?.name || id).join(', ') : 'All Banks')}
              >
                <MenuItem value="__all__">All Banks</MenuItem>
                {banks.map((bank) => (
                  <MenuItem key={bank.id} value={bank.id}>{bank.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                multiple
                value={statusFilter}
                onChange={(e) => setStatusFilter(Array.isArray(e.target.value) && e.target.value.includes('__all__') ? [] : e.target.value)}
                label="Status"
                renderValue={(selected) => (selected.length ? selected.join(', ') : 'All')}
              >
                <MenuItem value="__all__">All</MenuItem>
                <MenuItem value="true">Processed</MenuItem>
                <MenuItem value="false">Not Processed</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={8} md={4}>
            <TextField
              fullWidth
              label="Filter by From Email"
              placeholder="e.g. alerts@hdfcbank.net"
              value={fromEmailFilter}
              onChange={(e) => setFromEmailFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchData(); }}
            />
          </Grid>
          <Grid item xs={12} sm={4} md={2}>
            <Button
              fullWidth
              variant="outlined"
              color="error"
              startIcon={<Delete />}
              onClick={handleDeleteBySender}
              disabled={loading || !fromEmailFilter.trim()}
              sx={{ height: '56px' }}
            >
              Delete by Sender
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={4}>
            <FormControl fullWidth>
              <InputLabel>Remap to Bank</InputLabel>
              <Select
                value={bulkBankId}
                onChange={(e) => setBulkBankId(e.target.value)}
                label="Remap to Bank"
              >
                {banks.map((bank) => (
                  <MenuItem key={bank.id} value={bank.id}>{bank.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Box display="flex" gap={2} alignItems="center">
              <Button
                variant="contained"
                onClick={handleBulkRemap}
                disabled={loading || !bulkBankId || selectedPdfIds.length === 0}
              >
                Remap Selected
              </Button>
              <Typography variant="body2" color="textSecondary">
                Selected: {selectedPdfIds.length}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* PDF Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </TableCell>
              {[
                { field: 'id', label: 'ID' },
                { field: 'bank_name', label: 'Bank' },
                { field: 'from_email', label: 'From Email' },
                { field: 'file_name', label: 'File Name' },
                { field: 'statement_period_start', label: 'Period' },
                { field: 'transaction_count', label: 'Transactions' },
                { field: 'is_processed', label: 'Status' },
                { field: 'created_at', label: 'Created' },
              ].map(({ field, label }) => (
                <TableCell key={field} sortDirection={sortBy === field ? sortDir : false}>
                  <TableSortLabel
                    active={sortBy === field}
                    direction={sortBy === field ? sortDir : 'asc'}
                    onClick={() => handleSort(field)}
                  >
                    {label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pdfs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} align="center">No PDFs found</TableCell>
              </TableRow>
            ) : (
              pdfs.map((pdf) => (
                <TableRow key={pdf.id} hover>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedPdfIds.includes(pdf.id)}
                      onChange={() => handleSelectOne(pdf.id)}
                    />
                  </TableCell>
                  <TableCell>{pdf.id}</TableCell>
                  <TableCell>{pdf.bank_name || 'Unknown'}</TableCell>
                  <TableCell>
                    {pdf.from_email ? (
                      <Tooltip title={pdf.from_email}>
                        <Chip
                          label={pdf.from_email.replace(/^.*?([^<\s]+@[^>\s]+).*$/, '$1')}
                          size="small"
                          variant="outlined"
                          onClick={() => setFromEmailFilter(pdf.from_email.replace(/^.*?([^<\s]+@[^>\s]+).*$/, '$1'))}
                          sx={{ cursor: 'pointer', maxWidth: 180 }}
                        />
                      </Tooltip>
                    ) : <Typography variant="caption" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell>
                    {pdf.file_name}
                    {pdf.is_password_protected && (
                      <Chip label="Protected" size="small" color="warning" sx={{ ml: 1 }} />
                    )}
                    {pdf.error_message && (
                      <Tooltip title={pdf.error_message}>
                        <Chip label="Error" size="small" color="error" sx={{ ml: 1 }} icon={<Error />} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {pdf.statement_period_start && pdf.statement_period_end ? (
                      `${formatDate(pdf.statement_period_start)} - ${formatDate(pdf.statement_period_end)}`
                    ) : (
                      'N/A'
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={pdf.transaction_count} color={pdf.transaction_count > 0 ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell>
                    {pdf.is_processed ? (
                      <Chip icon={<CheckCircle />} label="Processed" color="success" size="small" />
                    ) : pdf.error_message ? (
                      <Tooltip title={pdf.error_message}>
                        <Chip icon={<Error />} label="Failed" color="error" size="small" />
                      </Tooltip>
                    ) : (
                      <Chip icon={<Error />} label="Not Processed" color="warning" size="small" />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(pdf.created_at)}</TableCell>
                  <TableCell>
                    <Tooltip title="Download PDF">
                      <IconButton size="small" color="primary" onClick={() => handleDownload(pdf.id, pdf.file_name)}>
                        <Download />
                      </IconButton>
                    </Tooltip>
                    {pdf.is_password_protected && !pdf.is_processed && (
                      <Tooltip title="Unlock PDF">
                        <IconButton size="small" color="warning" onClick={() => handleUnlock(pdf)}>
                          <Lock />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Reprocess">
                      <IconButton size="small" color="secondary" onClick={() => handleReprocess(pdf.id, pdf.file_name)}>
                        <Refresh />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </TableContainer>

      <PDFPasswordDialog
        open={passwordDialog.open}
        onClose={() => setPasswordDialog({ open: false, pdf: null })}
        pdf={passwordDialog.pdf}
        onSuccess={handlePasswordSuccess}
      />
    </Container>
  );
}

export default PDFManagement;
