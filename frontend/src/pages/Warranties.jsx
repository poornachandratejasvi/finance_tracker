import React, { useEffect, useState } from 'react';
import {
  Container, Paper, Box, Typography, Button, IconButton, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, CircularProgress, Alert, Tooltip,
  List, ListItem, ListItemText, ListItemIcon, Divider,
} from '@mui/material';
import {
  Add, Edit, Delete, VerifiedUser, InsertDriveFile, UploadFile, OpenInNew, Info,
} from '@mui/icons-material';
import {
  listWarranties, createWarranty, updateWarranty, deleteWarranty,
  listWarrantyDocuments, uploadWarrantyDocument, deleteWarrantyDocument,
} from '../services/api';
import { formatCurrency } from '../utils/format';

const CATEGORIES = ['electronics', 'appliance', 'furniture', 'other'];
const DOCUMENT_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'warranty_card', label: 'Warranty card' },
  { value: 'amc_contract', label: 'AMC contract' },
  { value: 'other', label: 'Other' },
];
const blank = {
  item_name: '', category: 'electronics', vendor: '', purchase_date: '', purchase_amount: '',
  warranty_expiry: '', amc_expiry: '', amc_provider: '', notes: '',
};

const expiryColor = (days) => {
  if (days == null) return 'default';
  if (days < 0) return 'error';
  if (days <= 30) return 'warning';
  return 'success';
};

export default function Warranties() {
  const [warranties, setWarranties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  const [detailsWarranty, setDetailsWarranty] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploadType, setUploadType] = useState('invoice');
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setWarranties(await listWarranties()); } catch { setError('Failed to load warranties'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (w) => {
    setEditing(w);
    setForm({
      item_name: w.item_name, category: w.category, vendor: w.vendor || '',
      purchase_date: w.purchase_date || '', purchase_amount: w.purchase_amount ?? '',
      warranty_expiry: w.warranty_expiry || '', amc_expiry: w.amc_expiry || '', amc_provider: w.amc_provider || '', notes: w.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.item_name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, purchase_amount: form.purchase_amount === '' ? null : parseFloat(form.purchase_amount) };
      if (editing) await updateWarranty(editing.id, payload);
      else await createWarranty(payload);
      setOpen(false);
      load();
    } catch { setError('Failed to save warranty'); }
    finally { setSaving(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this warranty?')) return;
    try { await deleteWarranty(id); load(); } catch { setError('Failed to delete'); }
  };

  const openDetails = async (w) => {
    setDetailsWarranty(w);
    try { setDocuments(await listWarrantyDocuments(w.id)); } catch { setDocuments([]); }
  };

  const handleUpload = async (file) => {
    if (!file || !detailsWarranty) return;
    setUploading(true);
    try {
      await uploadWarrantyDocument(detailsWarranty.id, uploadType, file.name, file);
      setDocuments(await listWarrantyDocuments(detailsWarranty.id));
      load();
    } catch { setError('Failed to upload document'); }
    finally { setUploading(false); }
  };

  const removeDocument = async (docId) => {
    try {
      await deleteWarrantyDocument(detailsWarranty.id, docId);
      setDocuments(await listWarrantyDocuments(detailsWarranty.id));
      load();
    } catch { setError('Failed to remove document'); }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Warranties</Typography>
          <Typography variant="body1" color="text.secondary">Appliance/electronics warranty and AMC expiry tracking, with document storage.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNew} sx={{ flexShrink: 0 }}>Add Item</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : warranties.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <VerifiedUser sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No warranties tracked yet.</Typography>
        </Paper>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {warranties.map((w) => (
            <Paper key={w.id} variant="outlined" sx={{ p: 2.5 }}>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={1}>
                <Box>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="h6" fontWeight={700}>{w.item_name}</Typography>
                    <Chip size="small" label={w.category} sx={{ textTransform: 'capitalize' }} />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {w.vendor ? `From ${w.vendor}` : null}
                    {w.purchase_amount != null ? ` · ${formatCurrency(w.purchase_amount)}` : null}
                    {w.purchase_date ? ` · Purchased ${w.purchase_date}` : null}
                  </Typography>
                  <Box display="flex" gap={1} mt={1} flexWrap="wrap">
                    {w.warranty_expiry && (
                      <Chip
                        size="small" color={expiryColor(w.warranty_days_until_expiry)}
                        label={w.warranty_days_until_expiry < 0 ? `Warranty expired ${w.warranty_expiry}` : `Warranty until ${w.warranty_expiry}`}
                      />
                    )}
                    {w.amc_expiry && (
                      <Chip
                        size="small" color={expiryColor(w.amc_days_until_expiry)} variant="outlined"
                        label={w.amc_days_until_expiry < 0 ? `AMC expired ${w.amc_expiry}` : `AMC until ${w.amc_expiry}`}
                      />
                    )}
                  </Box>
                </Box>
                <Box display="flex" gap={0.5}>
                  <Tooltip title="Documents">
                    <IconButton size="small" onClick={() => openDetails(w)}>
                      <Info fontSize="small" />
                      {w.document_count > 0 && <Typography variant="caption" sx={{ ml: 0.25 }}>{w.document_count}</Typography>}
                    </IconButton>
                  </Tooltip>
                  <IconButton size="small" onClick={() => openEdit(w)}><Edit fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => remove(w.id)}><Delete fontSize="small" /></IconButton>
                </Box>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Warranty' : 'Add Warranty/AMC'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Item Name" value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} fullWidth autoFocus />
          <TextField select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} fullWidth>
            {CATEGORIES.map((c) => <MenuItem key={c} value={c} sx={{ textTransform: 'capitalize' }}>{c}</MenuItem>)}
          </TextField>
          <TextField label="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} fullWidth />
          <Box display="flex" gap={1}>
            <TextField label="Purchase Date" type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField label="Purchase Amount" type="number" value={form.purchase_amount} onChange={(e) => setForm({ ...form, purchase_amount: e.target.value })} fullWidth />
          </Box>
          <TextField label="Warranty Expiry" type="date" value={form.warranty_expiry} onChange={(e) => setForm({ ...form, warranty_expiry: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
          <Box display="flex" gap={1}>
            <TextField label="AMC Expiry" type="date" value={form.amc_expiry} onChange={(e) => setForm({ ...form, amc_expiry: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField label="AMC Provider" value={form.amc_provider} onChange={(e) => setForm({ ...form, amc_provider: e.target.value })} fullWidth />
          </Box>
          <TextField label="Notes" multiline rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.item_name.trim()}>{saving ? <CircularProgress size={20} /> : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      {/* Documents dialog */}
      <Dialog open={!!detailsWarranty} onClose={() => setDetailsWarranty(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detailsWarranty?.item_name} — Documents</DialogTitle>
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
          <Button onClick={() => setDetailsWarranty(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
