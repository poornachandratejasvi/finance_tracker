import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress, Alert, Tooltip,
  List, ListItem, ListItemText, ListItemIcon, Divider,
} from '@mui/material';
import {
  Add, Edit, Delete, HealthAndSafety, InsertDriveFile, UploadFile, OpenInNew, Info,
} from '@mui/icons-material';
import {
  listInsurancePolicies, createInsurancePolicy, updateInsurancePolicy, deleteInsurancePolicy,
  listInsuranceDocuments, uploadInsuranceDocument, deleteInsuranceDocument,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const POLICY_TYPES = ['health', 'life', 'home', 'other'];
const PREMIUM_FREQUENCIES = ['monthly', 'quarterly', 'yearly'];
const DOCUMENT_TYPES = [
  { value: 'policy_doc', label: 'Policy document' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'claim', label: 'Claim' },
  { value: 'other', label: 'Other' },
];
const blank = {
  policy_type: 'health', provider: '', policy_number: '', insured_name: '',
  premium_amount: '', premium_frequency: 'yearly', coverage_amount: '', issued_date: '', expiry_date: '', notes: '',
};

const expiryColor = (days) => {
  if (days == null) return 'default';
  if (days < 0) return 'error';
  if (days <= 30) return 'warning';
  return 'success';
};

export default function Insurance() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const [detailsPolicy, setDetailsPolicy] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploadType, setUploadType] = useState('policy_doc');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setPolicies(await listInsurancePolicies()); } catch { setError('Failed to load insurance policies'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (p) => {
    setEditing(p);
    setForm({
      policy_type: p.policy_type, provider: p.provider || '', policy_number: p.policy_number || '',
      insured_name: p.insured_name || '', premium_amount: p.premium_amount ?? '', premium_frequency: p.premium_frequency,
      coverage_amount: p.coverage_amount ?? '', issued_date: p.issued_date || '', expiry_date: p.expiry_date || '', notes: p.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        premium_amount: form.premium_amount === '' ? null : parseFloat(form.premium_amount),
        coverage_amount: form.coverage_amount === '' ? null : parseFloat(form.coverage_amount),
      };
      if (editing) await updateInsurancePolicy(editing.id, payload);
      else await createInsurancePolicy(payload);
      setOpen(false);
      load();
    } catch { setError('Failed to save policy'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this insurance policy?')) return;
    try { await deleteInsurancePolicy(id); load(); } catch { setError('Failed to delete'); }
  };

  const openDetails = async (p) => {
    setDetailsPolicy(p);
    try { setDocuments(await listInsuranceDocuments(p.id)); } catch { setDocuments([]); }
  };

  const handleUpload = async (file) => {
    if (!file || !detailsPolicy) return;
    setUploading(true);
    try {
      await uploadInsuranceDocument(detailsPolicy.id, uploadType, file.name, file);
      setDocuments(await listInsuranceDocuments(detailsPolicy.id));
      load();
    } catch { setError('Failed to upload document'); }
    finally { setUploading(false); }
  };

  const removeDocument = async (docId) => {
    try {
      await deleteInsuranceDocument(detailsPolicy.id, docId);
      setDocuments(await listInsuranceDocuments(detailsPolicy.id));
      load();
    } catch { setError('Failed to remove document'); }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Insurance</Typography>
          <Typography variant="body1" color="text.secondary">Health, life, home, and other policies — expiry reminders and document storage.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ flexShrink: 0 }}>Add Policy</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : policies.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <HealthAndSafety sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No insurance policies tracked yet.</Typography>
        </Paper>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {policies.map((p) => (
            <Paper key={p.id} variant="outlined" sx={{ p: 2.5, opacity: p.is_active ? 1 : 0.6 }}>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                <Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="h6" fontWeight={700}>{p.provider || p.policy_type}</Typography>
                    <Chip size="small" label={p.policy_type} sx={{ textTransform: 'capitalize' }} />
                    {!p.is_active && <Chip size="small" label="Inactive" variant="outlined" />}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {p.insured_name ? `Covers: ${p.insured_name}` : null}
                    {p.policy_number ? ` · Policy #${p.policy_number}` : null}
                  </Typography>
                  <Box display="flex" gap={2} mt={1}>
                    {p.premium_amount != null && (
                      <Typography variant="body2">Premium: {formatCurrency(p.premium_amount)} / {p.premium_frequency}</Typography>
                    )}
                    {p.coverage_amount != null && <Typography variant="body2">Coverage: {formatCurrency(p.coverage_amount)}</Typography>}
                  </Box>
                  {p.expiry_date && (
                    <Chip
                      size="small" sx={{ mt: 1 }}
                      color={expiryColor(p.days_until_expiry)}
                      label={p.days_until_expiry < 0 ? `Expired ${p.expiry_date}` : `Expires ${p.expiry_date}`}
                    />
                  )}
                </Box>
                <Box display="flex" gap={0.5}>
                  <Tooltip title="Documents">
                    <IconButton size="small" onClick={() => openDetails(p)}>
                      <Info fontSize="small" />
                      {p.document_count > 0 && <Typography variant="caption" sx={{ ml: 0.25 }}>{p.document_count}</Typography>}
                    </IconButton>
                  </Tooltip>
                  <IconButton size="small" onClick={() => openEdit(p)}><Edit fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => remove(p.id)}><Delete fontSize="small" /></IconButton>
                </Box>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Policy' : 'Add Insurance Policy'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField select label="Type" value={form.policy_type} onChange={(e) => setForm({ ...form, policy_type: e.target.value })} fullWidth>
            {POLICY_TYPES.map((t) => <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>)}
          </TextField>
          <TextField label="Provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} fullWidth />
          <TextField label="Policy Number" value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} fullWidth />
          <TextField label="Insured (who/what is covered)" value={form.insured_name} onChange={(e) => setForm({ ...form, insured_name: e.target.value })} fullWidth />
          <Box display="flex" gap={1}>
            <TextField label="Premium Amount" type="number" value={form.premium_amount} onChange={(e) => setForm({ ...form, premium_amount: e.target.value })} fullWidth />
            <TextField select label="Frequency" value={form.premium_frequency} onChange={(e) => setForm({ ...form, premium_frequency: e.target.value })} sx={{ minWidth: 140 }}>
              {PREMIUM_FREQUENCIES.map((f) => <MenuItem key={f} value={f} sx={{ textTransform: 'capitalize' }}>{f}</MenuItem>)}
            </TextField>
          </Box>
          <TextField label="Coverage Amount" type="number" value={form.coverage_amount} onChange={(e) => setForm({ ...form, coverage_amount: e.target.value })} fullWidth />
          <Box display="flex" gap={1}>
            <TextField label="Issued Date" type="date" value={form.issued_date} onChange={(e) => setForm({ ...form, issued_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField label="Expiry Date" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          </Box>
          <TextField label="Notes" multiline rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}>{saving ? <CircularProgress size={20} /> : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      {/* Documents dialog */}
      <Dialog open={!!detailsPolicy} onClose={() => setDetailsPolicy(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detailsPolicy?.provider || detailsPolicy?.policy_type} — Documents</DialogTitle>
        <DialogContent>
          <Box display="flex" gap={1} alignItems="center" sx={{ mb: 2 }}>
            <TextField select size="small" label="Type" value={uploadType} onChange={(e) => setUploadType(e.target.value)} sx={{ minWidth: 160 }}>
              {DOCUMENT_TYPES.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
            </TextField>
            <Button component="label" variant="outlined" startIcon={<UploadFile />} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
              <input type="file" hidden accept="image/*,.pdf" onChange={(e) => handleUpload(e.target.files?.[0])} />
            </Button>
          </Box>
          {documents.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>No documents uploaded yet.</Typography>
          ) : (
            <List dense>
              {documents.map((d) => (
                <React.Fragment key={d.id}>
                  <ListItem
                    secondaryAction={
                      <Box display="flex" gap={0.5}>
                        {d.url && (
                          <IconButton size="small" component="a" href={d.url} target="_blank" rel="noreferrer"><OpenInNew fontSize="small" /></IconButton>
                        )}
                        <IconButton size="small" color="error" onClick={() => removeDocument(d.id)}><Delete fontSize="small" /></IconButton>
                      </Box>
                    }
                  >
                    <ListItemIcon><InsertDriveFile /></ListItemIcon>
                    <ListItemText primary={d.title} secondary={d.processing ? 'Archiving…' : d.document_type} />
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDetailsPolicy(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
