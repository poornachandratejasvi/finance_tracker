import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, Chip, MenuItem,
} from '@mui/material';
import { Add, Delete, Edit, PhotoCamera, DirectionsCar } from '@mui/icons-material';
import {
  listVehicles, createVehicle, updateVehicle, deleteVehicle,
  createVehiclePolicy, updateVehiclePolicy, getExpiringPolicies, scanVehicleDocument,
} from '../services/api';

const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const blankVehicle = { registration_number: '', nickname: '', vehicle_type: 'car', make: '', model: '', fuel_type: '', purchase_date: '' };
const blankPolicy = { provider: '', policy_number: '', policy_type: 'comprehensive', premium_amount: '', start_date: '', expiry_date: '' };

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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>Vehicles</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openNewVehicle}>Add Vehicle</Button>
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
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <DirectionsCar sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography color="text.secondary">No vehicles added yet.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {vehicles.map((v) => (
            <Grid item xs={12} md={6} lg={4} key={v.id}>
              <Paper sx={{ p: 2.5 }}>
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
                  <Button size="small" sx={{ mt: 1 }} onClick={() => openPolicy(v)}>
                    {v.current_policy ? 'Edit Policy' : 'Add Policy'}
                  </Button>
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
    </Container>
  );
}
