import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, Chip, MenuItem,
  Tabs, Tab, List, ListItem, ListItemText, ListItemIcon, CircularProgress, Divider,
} from '@mui/material';
import {
  Add, Delete, Edit, PhotoCamera, DirectionsCar, InsertDriveFile,
  UploadFile, OpenInNew, LocalGasStation, Info,
} from '@mui/icons-material';
import {
  listVehicles, createVehicle, updateVehicle, deleteVehicle,
  createVehiclePolicy, updateVehiclePolicy, getExpiringPolicies, scanVehicleDocument,
  listVehiclePuc, createVehiclePuc, updateVehiclePuc, deleteVehiclePuc,
  listVehicleDocuments, uploadVehicleDocument, deleteVehicleDocument, getVehicleSpendSummary,
} from '../services/api';

const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const blankVehicle = { registration_number: '', nickname: '', vehicle_type: 'car', make: '', model: '', fuel_type: '', purchase_date: '' };
const blankPolicy = { provider: '', policy_number: '', policy_type: 'comprehensive', premium_amount: '', start_date: '', expiry_date: '' };
const blankPuc = { certificate_number: '', issued_date: '', expiry_date: '' };
const DOCUMENT_TYPES = [
  { value: 'rc', label: 'RC (Registration Certificate)' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'puc', label: 'PUC Certificate' },
  { value: 'service_record', label: 'Service Record / Invoice' },
  { value: 'other', label: 'Other' },
];

function expiryColor(days) {
  if (days == null) return 'default';
  if (days < 0) return 'error';
  if (days <= 15) return 'error';
  if (days <= 45) return 'warning';
  return 'success';
}

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [vOpen, setVOpen] = useState(false);
  const [vEditing, setVEditing] = useState(null);
  const [vForm, setVForm] = useState(blankVehicle);
  const [pOpen, setPOpen] = useState(false);
  const [pVehicleId, setPVehicleId] = useState(null);
  const [pEditing, setPEditing] = useState(null);
  const [pForm, setPForm] = useState(blankPolicy);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [scanning, setScanning] = useState(false);

  // Vehicle details dialog: PUC, documents, spend summary.
  const [detailsVehicle, setDetailsVehicle] = useState(null);
  const [detailsTab, setDetailsTab] = useState(0);
  const [pucList, setPucList] = useState([]);
  const [pucOpen, setPucOpen] = useState(false);
  const [pucEditing, setPucEditing] = useState(null);
  const [pucForm, setPucForm] = useState(blankPuc);
  const [documents, setDocuments] = useState([]);
  const [uploadType, setUploadType] = useState('other');
  const [uploading, setUploading] = useState(false);
  const [spendSummary, setSpendSummary] = useState(null);

  const openDetails = async (vehicle) => {
    setDetailsVehicle(vehicle);
    setDetailsTab(0);
    try {
      const [pucs, docs, spend] = await Promise.all([
        listVehiclePuc(vehicle.id), listVehicleDocuments(vehicle.id), getVehicleSpendSummary(vehicle.id, 12),
      ]);
      setPucList(pucs); setDocuments(docs); setSpendSummary(spend);
    } catch (e) { setErr('Failed to load vehicle details'); }
  };

  const reloadDetails = async () => {
    if (!detailsVehicle) return;
    const [pucs, docs, spend] = await Promise.all([
      listVehiclePuc(detailsVehicle.id), listVehicleDocuments(detailsVehicle.id), getVehicleSpendSummary(detailsVehicle.id, 12),
    ]);
    setPucList(pucs); setDocuments(docs); setSpendSummary(spend);
  };

  const openNewPuc = () => { setPucEditing(null); setPucForm(blankPuc); setPucOpen(true); };
  const openEditPuc = (p) => {
    setPucEditing(p.id);
    setPucForm({ certificate_number: p.certificate_number || '', issued_date: p.issued_date || '', expiry_date: p.expiry_date || '' });
    setPucOpen(true);
  };
  const savePuc = async () => {
    setErr('');
    try {
      if (pucEditing) await updateVehiclePuc(pucEditing, pucForm);
      else await createVehiclePuc(detailsVehicle.id, pucForm);
      setPucOpen(false); reloadDetails(); load();
    } catch (e) { setErr(e.response?.data?.detail || 'Failed to save PUC certificate'); }
  };
  const removePuc = async (id) => {
    if (!window.confirm('Delete this PUC certificate?')) return;
    try { await deleteVehiclePuc(id); reloadDetails(); load(); } catch (e) { setErr('Failed to delete PUC certificate'); }
  };

  const handleUploadDocument = async (file) => {
    if (!file || !detailsVehicle) return;
    setUploading(true); setErr('');
    try {
      await uploadVehicleDocument(detailsVehicle.id, uploadType, file.name, file);
      setMsg('Document uploaded — archiving in the background.');
      reloadDetails();
    } catch (e) {
      setErr('Failed to upload document.');
    } finally {
      setUploading(false);
    }
  };
  const removeDocument = async (docId) => {
    if (!window.confirm('Remove this document reference? (the archived copy is kept in Paperless)')) return;
    try { await deleteVehicleDocument(detailsVehicle.id, docId); reloadDetails(); } catch (e) { setErr('Failed to remove document'); }
  };

  const load = async () => {
    try {
      const [vs, exp] = await Promise.all([listVehicles(), getExpiringPolicies(45)]);
      setVehicles(vs); setExpiring(exp);
    } catch (e) { setErr('Failed to load vehicles'); }
  };
  useEffect(() => { load(); }, []);

  const openNewVehicle = () => { setVEditing(null); setVForm(blankVehicle); setVOpen(true); };
  const openEditVehicle = (v) => {
    setVEditing(v.id);
    setVForm({
      registration_number: v.registration_number, nickname: v.nickname || '', vehicle_type: v.vehicle_type || 'car',
      make: v.make || '', model: v.model || '', fuel_type: v.fuel_type || '', purchase_date: v.purchase_date || '',
    });
    setVOpen(true);
  };

  const saveVehicle = async () => {
    setErr(''); setMsg('');
    if (!vForm.registration_number.trim()) { setErr('Registration number is required.'); return; }
    try {
      if (vEditing) await updateVehicle(vEditing, vForm);
      else await createVehicle(vForm);
      setVOpen(false); setMsg('Vehicle saved.'); load();
    } catch (e) { setErr(e.response?.data?.detail || 'Failed to save vehicle'); }
  };

  const removeVehicle = async (id) => {
    if (!window.confirm('Delete this vehicle and all its policies?')) return;
    try { await deleteVehicle(id); load(); } catch (e) { setErr('Failed to delete vehicle'); }
  };

  const openPolicy = (vehicle) => {
    setPVehicleId(vehicle.id);
    const cur = vehicle.current_policy;
    setPEditing(cur ? cur.id : null);
    setPForm(cur ? {
      provider: cur.provider || '', policy_number: cur.policy_number || '', policy_type: cur.policy_type || 'comprehensive',
      premium_amount: cur.premium_amount ?? '', start_date: cur.start_date || '', expiry_date: cur.expiry_date || '',
    } : blankPolicy);
    setPOpen(true);
  };

  const savePolicy = async () => {
    setErr(''); setMsg('');
    const payload = { ...pForm, premium_amount: pForm.premium_amount === '' ? null : parseFloat(pForm.premium_amount) };
    try {
      if (pEditing) await updateVehiclePolicy(pEditing, payload);
      else await createVehiclePolicy(pVehicleId, payload);
      setPOpen(false); setMsg('Policy saved.'); load();
    } catch (e) { setErr(e.response?.data?.detail || 'Failed to save policy'); }
  };

  const scanDoc = async (docType, file, applyTo) => {
    if (!file) return;
    setScanning(true); setErr('');
    try {
      const result = await scanVehicleDocument(docType, file);
      if (!result.success) { setErr(result.message || 'Could not read that document.'); return; }
      applyTo(result);
    } catch (e) {
      setErr('Failed to scan document.');
    } finally {
      setScanning(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Vehicles</Typography>
          <Typography variant="body1" color="text.secondary">Registrations, insurance, and what's expiring soon.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={openNewVehicle} sx={{ flexShrink: 0 }}>Add Vehicle</Button>
      </Box>

      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

      {expiring.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {expiring.length} polic{expiring.length === 1 ? 'y' : 'ies'} expiring soon:{' '}
          {expiring.map((p) => `${p.vehicle_nickname || p.vehicle_registration_number} (${p.days_until_expiry < 0 ? 'expired' : `${p.days_until_expiry}d`})`).join(', ')}
        </Alert>
      )}

      {vehicles.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderRadius: 4 }}>
          <DirectionsCar sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary">No vehicles added yet.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {vehicles.map((v) => (
            <Grid item xs={12} md={6} lg={4} key={v.id}>
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4, height: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Typography fontWeight={700}>{v.nickname || v.registration_number}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {v.registration_number} · {[v.make, v.model].filter(Boolean).join(' ') || v.vehicle_type}
                    </Typography>
                  </Box>
                  <Box>
                    <IconButton size="small" onClick={() => openEditVehicle(v)}><Edit fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => removeVehicle(v.id)}><Delete fontSize="small" /></IconButton>
                  </Box>
                </Box>
                <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                  {v.current_policy ? (
                    <>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="body2">{v.current_policy.provider || 'Insurance'}</Typography>
                        <Chip
                          size="small"
                          label={v.current_policy.days_until_expiry < 0 ? 'Expired' : `${v.current_policy.days_until_expiry}d left`}
                          color={expiryColor(v.current_policy.days_until_expiry)}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {v.current_policy.policy_type} · {inr(v.current_policy.premium_amount)} · expires {v.current_policy.expiry_date || '—'}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No insurance policy recorded.</Typography>
                  )}
                  {v.current_puc && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                      <Typography variant="caption" color="text.secondary">PUC expires {v.current_puc.expiry_date || '—'}</Typography>
                      <Chip
                        size="small"
                        label={v.current_puc.days_until_expiry < 0 ? 'Expired' : `${v.current_puc.days_until_expiry}d left`}
                        color={expiryColor(v.current_puc.days_until_expiry)}
                      />
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Button size="small" onClick={() => openPolicy(v)}>
                      {v.current_policy ? 'Edit Policy' : 'Add Policy'}
                    </Button>
                    <Button size="small" startIcon={<Info fontSize="small" />} onClick={() => openDetails(v)}>
                      Details {v.document_count > 0 ? `(${v.document_count})` : ''}
                    </Button>
                  </Box>
                </Box>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Vehicle dialog */}
      <Dialog open={vOpen} onClose={() => setVOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{vEditing ? 'Edit Vehicle' : 'Add Vehicle'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Button component="label" variant="outlined" startIcon={<PhotoCamera />} disabled={scanning}>
            {scanning ? 'Reading…' : 'Scan RC Photo (auto-fill)'}
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => scanDoc('rc', e.target.files[0], (r) => setVForm((f) => ({
                ...f,
                registration_number: r.registration_number || f.registration_number,
                make: r.make || f.make, model: r.model || f.model, fuel_type: r.fuel_type || f.fuel_type,
              })))} />
          </Button>
          <TextField label="Registration Number" value={vForm.registration_number}
            onChange={(e) => setVForm({ ...vForm, registration_number: e.target.value })} required />
          <TextField label="Nickname (optional)" value={vForm.nickname}
            onChange={(e) => setVForm({ ...vForm, nickname: e.target.value })} />
          <TextField select label="Type" value={vForm.vehicle_type}
            onChange={(e) => setVForm({ ...vForm, vehicle_type: e.target.value })}>
            {['car', 'bike', 'scooter', 'commercial', 'other'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <TextField label="Make" value={vForm.make} onChange={(e) => setVForm({ ...vForm, make: e.target.value })} />
          <TextField label="Model" value={vForm.model} onChange={(e) => setVForm({ ...vForm, model: e.target.value })} />
          <TextField select label="Fuel Type" value={vForm.fuel_type}
            onChange={(e) => setVForm({ ...vForm, fuel_type: e.target.value })}>
            {['', 'petrol', 'diesel', 'electric', 'cng', 'hybrid'].map((t) => <MenuItem key={t} value={t}>{t || '—'}</MenuItem>)}
          </TextField>
          <TextField label="Purchase Date" type="date" InputLabelProps={{ shrink: true }} value={vForm.purchase_date}
            onChange={(e) => setVForm({ ...vForm, purchase_date: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveVehicle}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Policy dialog */}
      <Dialog open={pOpen} onClose={() => setPOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{pEditing ? 'Edit Policy' : 'Add Policy'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Button component="label" variant="outlined" startIcon={<PhotoCamera />} disabled={scanning}>
            {scanning ? 'Reading…' : 'Scan Insurance Document (auto-fill)'}
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => scanDoc('insurance', e.target.files[0], (r) => setPForm((f) => ({
                ...f,
                provider: r.provider || f.provider, policy_number: r.policy_number || f.policy_number,
                policy_type: r.policy_type || f.policy_type, premium_amount: r.premium_amount ?? f.premium_amount,
                start_date: r.start_date || f.start_date, expiry_date: r.expiry_date || f.expiry_date,
              })))} />
          </Button>
          <TextField label="Provider" value={pForm.provider} onChange={(e) => setPForm({ ...pForm, provider: e.target.value })} />
          <TextField label="Policy Number" value={pForm.policy_number} onChange={(e) => setPForm({ ...pForm, policy_number: e.target.value })} />
          <TextField select label="Policy Type" value={pForm.policy_type}
            onChange={(e) => setPForm({ ...pForm, policy_type: e.target.value })}>
            <MenuItem value="third_party">Third Party</MenuItem>
            <MenuItem value="comprehensive">Comprehensive</MenuItem>
          </TextField>
          <TextField label="Premium Amount" type="number" value={pForm.premium_amount}
            onChange={(e) => setPForm({ ...pForm, premium_amount: e.target.value })} />
          <TextField label="Start Date" type="date" InputLabelProps={{ shrink: true }} value={pForm.start_date}
            onChange={(e) => setPForm({ ...pForm, start_date: e.target.value })} />
          <TextField label="Expiry Date" type="date" InputLabelProps={{ shrink: true }} value={pForm.expiry_date}
            onChange={(e) => setPForm({ ...pForm, expiry_date: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={savePolicy}>Save</Button>
        </DialogActions>
      </Dialog>

      {/* Vehicle details dialog: PUC, documents, spend summary */}
      <Dialog open={Boolean(detailsVehicle)} onClose={() => setDetailsVehicle(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detailsVehicle?.nickname || detailsVehicle?.registration_number}</DialogTitle>
        <Tabs value={detailsTab} onChange={(e, v) => setDetailsTab(v)} sx={{ px: 3 }}>
          <Tab label="Spend" />
          <Tab label="PUC" />
          <Tab label="Documents" />
        </Tabs>
        <DialogContent sx={{ pt: 2 }}>
          {detailsTab === 0 && (
            spendSummary ? (
              <Box>
                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: '1 1 140px' }}>
                    <Typography variant="caption" color="text.secondary">Total spent (12mo)</Typography>
                    <Typography variant="h5" fontWeight={800}>{inr(spendSummary.total_spent)}</Typography>
                  </Box>
                  <Box sx={{ flex: '1 1 140px' }}>
                    <Typography variant="caption" color="text.secondary">Insurance (lifetime)</Typography>
                    <Typography variant="h5" fontWeight={800}>{inr(spendSummary.insurance_lifetime_total)}</Typography>
                  </Box>
                  <Box sx={{ flex: '1 1 140px' }}>
                    <Typography variant="caption" color="text.secondary">Transactions</Typography>
                    <Typography variant="h5" fontWeight={800}>{spendSummary.transaction_count}</Typography>
                  </Box>
                </Box>
                <Divider sx={{ mb: 1.5 }} />
                <Typography variant="subtitle2" sx={{ mb: 1 }}>By category</Typography>
                {spendSummary.by_category.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No transactions tagged to this vehicle yet — assign one from the Transactions page.
                  </Typography>
                ) : (
                  <List dense>
                    {spendSummary.by_category.map((c) => (
                      <ListItem key={c.category} disableGutters>
                        <ListItemIcon sx={{ minWidth: 32 }}><LocalGasStation fontSize="small" /></ListItemIcon>
                        <ListItemText primary={c.category} />
                        <Typography variant="body2" fontWeight={600}>{inr(c.amount)}</Typography>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Box>
            ) : <CircularProgress size={20} />
          )}

          {detailsTab === 1 && (
            <Box>
              <Button size="small" startIcon={<Add />} onClick={openNewPuc} sx={{ mb: 1 }}>Add PUC Certificate</Button>
              {pucList.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No PUC certificates recorded.</Typography>
              ) : (
                <List dense>
                  {pucList.map((p) => (
                    <ListItem key={p.id} disableGutters
                      secondaryAction={
                        <Box>
                          <IconButton size="small" onClick={() => openEditPuc(p)}><Edit fontSize="small" /></IconButton>
                          <IconButton size="small" onClick={() => removePuc(p.id)}><Delete fontSize="small" /></IconButton>
                        </Box>
                      }
                    >
                      <ListItemText
                        primary={p.certificate_number || 'PUC Certificate'}
                        secondary={`Expires ${p.expiry_date || '—'}`}
                      />
                      <Chip size="small" sx={{ mr: 5 }}
                        label={p.days_until_expiry < 0 ? 'Expired' : `${p.days_until_expiry}d left`}
                        color={expiryColor(p.days_until_expiry)}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}

          {detailsTab === 2 && (
            <Box>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField select size="small" label="Type" value={uploadType} onChange={(e) => setUploadType(e.target.value)} sx={{ minWidth: 200 }}>
                  {DOCUMENT_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                </TextField>
                <Button component="label" size="small" variant="outlined" startIcon={uploading ? <CircularProgress size={14} /> : <UploadFile />} disabled={uploading}>
                  Upload
                  <input type="file" accept="image/*,.pdf" hidden onChange={(e) => handleUploadDocument(e.target.files[0])} />
                </Button>
              </Box>
              {documents.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No documents archived yet.</Typography>
              ) : (
                <List dense>
                  {documents.map((d) => (
                    <ListItem key={d.id} disableGutters
                      secondaryAction={
                        <Box>
                          {d.url && (
                            <IconButton size="small" component="a" href={d.url} target="_blank" rel="noopener noreferrer">
                              <OpenInNew fontSize="small" />
                            </IconButton>
                          )}
                          <IconButton size="small" onClick={() => removeDocument(d.id)}><Delete fontSize="small" /></IconButton>
                        </Box>
                      }
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}><InsertDriveFile fontSize="small" /></ListItemIcon>
                      <ListItemText
                        primary={d.title || d.document_type}
                        secondary={d.processing ? 'Archiving…' : DOCUMENT_TYPES.find((t) => t.value === d.document_type)?.label}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsVehicle(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* PUC dialog */}
      <Dialog open={pucOpen} onClose={() => setPucOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{pucEditing ? 'Edit PUC Certificate' : 'Add PUC Certificate'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField label="Certificate Number" value={pucForm.certificate_number}
            onChange={(e) => setPucForm({ ...pucForm, certificate_number: e.target.value })} />
          <TextField label="Issued Date" type="date" InputLabelProps={{ shrink: true }} value={pucForm.issued_date}
            onChange={(e) => setPucForm({ ...pucForm, issued_date: e.target.value })} />
          <TextField label="Expiry Date" type="date" InputLabelProps={{ shrink: true }} value={pucForm.expiry_date}
            onChange={(e) => setPucForm({ ...pucForm, expiry_date: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPucOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={savePuc}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
