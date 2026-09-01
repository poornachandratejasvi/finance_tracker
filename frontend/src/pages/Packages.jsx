import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, TextField, IconButton, Alert,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, Chip,
  MenuItem, useTheme, CircularProgress, Tooltip,
} from '@mui/material';
import {
  Add, Delete, Edit, LocalShipping, Refresh, OpenInNew,
  Inventory2, DirectionsRun, CheckCircle,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import {
  listPackages, createPackage, updatePackage, deletePackage,
  refreshPackageNow, getPackageCarriers, syncShipmentsNow,
} from '../services/api';

const blank = {
  carrier: 'amazon', tracking_number: '', merchant: '', order_id: '',
  item_description: '', status: 'ordered', expected_delivery_date: '',
  tracking_url: '', notes: '',
};

const STATUS_META = {
  ordered: { label: 'Ordered', color: 'default' },
  shipped: { label: 'Shipped', color: 'info' },
  out_for_delivery: { label: 'Out for delivery', color: 'warning' },
  delivered: { label: 'Delivered', color: 'success' },
  unknown: { label: 'Unknown', color: 'default' },
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (_) { return iso; }
};

export default function Packages() {
  const theme = useTheme();
  const [packages, setPackages] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [refreshingId, setRefreshingId] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    try {
      const [pkgs, carrierList] = await Promise.all([listPackages(), getPackageCarriers()]);
      setPackages(pkgs);
      setCarriers(carrierList);
    } catch (e) { setErr('Failed to load packages'); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (p) => {
    setEditing(p.id);
    setForm({
      carrier: p.carrier, tracking_number: p.tracking_number || '', merchant: p.merchant || '',
      order_id: p.order_id || '', item_description: p.item_description || '', status: p.status,
      expected_delivery_date: p.expected_delivery_date ? p.expected_delivery_date.slice(0, 10) : '',
      tracking_url: p.tracking_url || '', notes: p.notes || '',
    });
    setOpen(true);
  };

  const save = async () => {
    setErr(''); setMsg('');
    if (!form.carrier) { setErr('Carrier is required.'); return; }
    const payload = {
      ...form,
      expected_delivery_date: form.expected_delivery_date || null,
    };
    try {
      if (editing) await updatePackage(editing, payload);
      else await createPackage(payload);
      setOpen(false); setMsg('Package saved.'); load();
    } catch (e) { setErr('Failed to save package'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this package?')) return;
    try { await deletePackage(id); load(); } catch (e) { setErr('Failed to delete package'); }
  };

  const refreshOne = async (id) => {
    setRefreshingId(id); setErr('');
    try { await refreshPackageNow(id); load(); }
    catch (e) { setErr(e?.response?.data?.detail || 'Failed to refresh tracking'); }
    finally { setRefreshingId(null); }
  };

  const syncNow = async () => {
    setSyncing(true); setErr(''); setMsg('');
    try {
      const res = await syncShipmentsNow();
      setMsg(`Checked mail for new shipments (${res.touched || 0} updated).`);
      load();
    } catch (e) { setErr('Failed to sync shipment emails'); }
    finally { setSyncing(false); }
  };

  const inTransit = packages.filter((p) => p.status === 'shipped').length;
  const outForDelivery = packages.filter((p) => p.status === 'out_for_delivery').length;
  const deliveredThisMonth = packages.filter((p) => {
    if (p.status !== 'delivered' || !p.actual_delivery_date) return false;
    const d = new Date(p.actual_delivery_date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const heroCard = (label, value, color, Icon) => (
    <Paper variant="outlined" sx={{
      p: 2.75, flex: '1 1 220px', minWidth: 220, borderRadius: 4,
      backgroundImage: `linear-gradient(135deg, ${alpha(color, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, ${alpha(color, 0)} 65%)`,
    }}>
      <Box display="flex" alignItems="center" gap={1.25} mb={1.5}>
        <Box sx={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: color, color: '#fff', flexShrink: 0 }}>
          <Icon sx={{ fontSize: 20 }} />
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, fontSize: 11.5 }}>{label}</Typography>
      </Box>
      <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums', color, lineHeight: 1.15 }}>{value}</Typography>
    </Paper>
  );

  const carrierMeta = (key) => carriers.find((c) => c.key === key) || {};

  return (
    <Container maxWidth={false} sx={{ mt: 3, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5, mb: 0.25 }}>Packages</Typography>
          <Typography variant="body1" color="text.secondary">Track deliveries from Amazon.in, Flipkart, and Indian couriers.</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined" startIcon={syncing ? <CircularProgress size={16} /> : <Refresh />}
            onClick={syncNow} disabled={syncing}
          >
            Check Mail
          </Button>
          <Button variant="contained" startIcon={<Add />} onClick={openNew}>Add Package</Button>
        </Box>
      </Box>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {packages.length > 0 && (
        <Box display="flex" gap={2} flexWrap="wrap" mb={3} mt={2}>
          {heroCard('In Transit', inTransit, theme.palette.info.main, LocalShipping)}
          {heroCard('Out for Delivery', outForDelivery, theme.palette.warning.main, DirectionsRun)}
          {heroCard('Delivered This Month', deliveredThisMonth, theme.palette.success.main, CheckCircle)}
        </Box>
      )}

      {packages.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Inventory2 sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">No packages tracked yet. Add one manually, or click "Check Mail" to scan for shipping emails.</Typography>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {packages.map((p) => {
            const meta = STATUS_META[p.status] || STATUS_META.unknown;
            const cMeta = carrierMeta(p.carrier);
            return (
              <Grid item xs={12} sm={6} md={4} key={p.id}>
                <Paper variant="outlined" sx={{ p: 2.5, height: '100%', borderRadius: 4 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                      <Chip label={cMeta.label || p.carrier} size="small" variant="outlined" />
                      <Chip label={meta.label} size="small" color={meta.color} />
                    </Box>
                    <Box>
                      {p.source === 'manual' && (
                        <>
                          <IconButton size="small" onClick={() => openEdit(p)}><Edit fontSize="small" /></IconButton>
                          <IconButton size="small" color="error" onClick={() => remove(p.id)}><Delete fontSize="small" /></IconButton>
                        </>
                      )}
                    </Box>
                  </Box>

                  <Typography variant="subtitle1" fontWeight={700} noWrap title={p.item_description || p.merchant || ''}>
                    {p.item_description || p.merchant || 'Package'}
                  </Typography>
                  {p.tracking_number && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                      Tracking: {p.tracking_number}
                    </Typography>
                  )}

                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {p.status === 'delivered' ? 'Delivered on' : 'Expected'}
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {fmtDate(p.status === 'delivered' ? p.actual_delivery_date : p.expected_delivery_date)}
                  </Typography>

                  {p.last_tracker_error && (
                    <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 1 }}>
                      Last check failed — showing last known status.
                    </Typography>
                  )}

                  <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                    {p.tracking_url && (
                      <Button size="small" startIcon={<OpenInNew fontSize="small" />} href={p.tracking_url} target="_blank" rel="noopener noreferrer">
                        Track
                      </Button>
                    )}
                    {cMeta.has_live_tracking && p.tracking_number && p.status !== 'delivered' && (
                      <Tooltip title="Check live tracking now">
                        <span>
                          <Button
                            size="small" startIcon={refreshingId === p.id ? <CircularProgress size={14} /> : <Refresh fontSize="small" />}
                            onClick={() => refreshOne(p.id)} disabled={refreshingId === p.id}
                          >
                            Refresh
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </Box>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Package' : 'Add Package'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            select label="Carrier" value={form.carrier} fullWidth
            onChange={(e) => setForm({ ...form, carrier: e.target.value })}
          >
            {(carriers.length ? carriers : [{ key: 'amazon', label: 'Amazon.in' }, { key: 'other', label: 'Other' }]).map((c) => (
              <MenuItem key={c.key} value={c.key}>{c.label}</MenuItem>
            ))}
          </TextField>
          <TextField label="Merchant" value={form.merchant} fullWidth onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
          <TextField label="Item description" value={form.item_description} fullWidth onChange={(e) => setForm({ ...form, item_description: e.target.value })} />
          <TextField label="Tracking number" value={form.tracking_number} fullWidth onChange={(e) => setForm({ ...form, tracking_number: e.target.value })} />
          <TextField label="Order ID" value={form.order_id} fullWidth onChange={(e) => setForm({ ...form, order_id: e.target.value })} />
          <TextField
            select label="Status" value={form.status} fullWidth
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            {Object.entries(STATUS_META).filter(([k]) => k !== 'unknown').map(([k, m]) => (
              <MenuItem key={k} value={k}>{m.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Expected delivery date" type="date" fullWidth InputLabelProps={{ shrink: true }}
            value={form.expected_delivery_date} onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
          />
          <TextField label="Tracking URL" value={form.tracking_url} fullWidth onChange={(e) => setForm({ ...form, tracking_url: e.target.value })} />
          <TextField label="Notes" value={form.notes} fullWidth multiline minRows={2} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
