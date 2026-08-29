import React, { useEffect, useState } from 'react';
import {
  Container, Typography, Paper, Box, Button, Chip, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, CircularProgress, Checkbox, Tooltip, IconButton,
} from '@mui/material';
import { Refresh, RestoreFromTrash, DeleteForever } from '@mui/icons-material';
import { getRecycleBin, restoreTransactions, purgeTransactions } from '../services/api';
import { formatCurrency, formatDateTime, formatDate } from '../utils/format';

const daysLeft = (purgeAt) => {
  const ms = new Date(purgeAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

export default function RecycleBin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      setItems(await getRecycleBin());
    } catch (e) {
      setErr(e?.response?.data?.detail ? String(e.response.data.detail) : 'Failed to load recycle bin');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    setSelected(selected.length === items.length ? [] : items.map((t) => t.id));
  };

  const doRestore = async (ids) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await restoreTransactions(ids);
      setMsg(`Restored ${res.restored} transaction(s).`);
      setSelected([]);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail ? String(e.response.data.detail) : 'Failed to restore');
    } finally {
      setBusy(false);
    }
  };

  const doPurge = async (ids) => {
    if (!window.confirm(`Permanently delete ${ids.length} transaction(s)? This can't be undone.`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await purgeTransactions(ids);
      setMsg(`Permanently deleted ${res.purged} transaction(s).`);
      setSelected([]);
      await load();
    } catch (e) {
      setErr(e?.response?.data?.detail ? String(e.response.data.detail) : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h4">Recycle Bin</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip label={`${items.length} deleted`} size="small" />
          <Tooltip title="Refresh"><span><IconButton onClick={load}><Refresh /></IconButton></span></Tooltip>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 0.5 }}>
        Deleted transactions sit here for 30 days before being permanently removed. Restore them any time before then.
      </Typography>

      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErr('')}>{err}</Alert>}

      {selected.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button variant="contained" size="small" startIcon={<RestoreFromTrash />} onClick={() => doRestore(selected)} disabled={busy}>
            Restore {selected.length}
          </Button>
          <Button variant="outlined" color="error" size="small" startIcon={<DeleteForever />} onClick={() => doPurge(selected)} disabled={busy}>
            Delete Forever
          </Button>
        </Box>
      )}

      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
        ) : items.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">Recycle bin is empty.</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox checked={selected.length === items.length} indeterminate={selected.length > 0 && selected.length < items.length} onChange={toggleAll} />
                </TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Deleted</TableCell>
                <TableCell>Purges in</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id} selected={selected.includes(t.id)}>
                  <TableCell padding="checkbox">
                    <Checkbox checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                  </TableCell>
                  <TableCell>{formatDate(t.transaction_date)}</TableCell>
                  <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</TableCell>
                  <TableCell>{t.bank_name || '—'}</TableCell>
                  <TableCell>{t.category || '—'}</TableCell>
                  <TableCell align="right" sx={{ color: t.transaction_type === 'credit' ? 'success.main' : 'text.primary' }}>
                    {t.transaction_type === 'credit' ? '+' : '-'}{formatCurrency(Math.abs(t.amount), { currency: t.currency_code })}
                  </TableCell>
                  <TableCell>{formatDateTime(t.deleted_at)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={`${daysLeft(t.purge_at)}d left`} color={daysLeft(t.purge_at) <= 3 ? 'warning' : 'default'} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Restore">
                      <span><IconButton size="small" onClick={() => doRestore([t.id])} disabled={busy}><RestoreFromTrash fontSize="small" /></IconButton></span>
                    </Tooltip>
                    <Tooltip title="Delete forever">
                      <span><IconButton size="small" color="error" onClick={() => doPurge([t.id])} disabled={busy}><DeleteForever fontSize="small" /></IconButton></span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Container>
  );
}
