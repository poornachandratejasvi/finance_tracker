import React, { useState, useEffect } from 'react';
import {
  Paper,
  Box,
  Typography,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Add, Edit, Delete, Label as LabelIcon } from '@mui/icons-material';
import {
  getLabels,
  createLabel,
  updateLabel,
  deleteLabel,
} from '../../services/api';

const emptyForm = {
  name: '',
  color: '#1aa565',
  auto_keywords: '',
};

export default function LabelsPanel() {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getLabels();
      setLabels(data || []);
    } catch (err) {
      setError('Failed to load labels');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (label) => {
    setEditing(label);
    setForm({
      name: label.name || '',
      color: label.color || '#1aa565',
      auto_keywords: (label.auto_keywords || []).join(', '),
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        color: form.color,
        auto_keywords: form.auto_keywords
          ? form.auto_keywords.split(',').map((k) => k.trim()).filter(Boolean)
          : [],
      };
      if (editing) {
        await updateLabel(editing.id, payload);
        setSuccess('Label updated');
      } else {
        await createLabel(payload);
        setSuccess('Label created');
      }
      closeDialog();
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to save label');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (label) => {
    if (!window.confirm('Delete this label? It will be removed from all transactions.')) return;
    setError('');
    try {
      await deleteLabel(label.id);
      setSuccess('Label deleted');
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to delete label');
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Transaction Labels</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd}>
          Add Label
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        Labels help categorize transactions. Add keywords for auto-labeling based on transaction descriptions.
      </Alert>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <List>
          {labels.length === 0 ? (
            <ListItem>
              <ListItemText primary="No labels created" secondary="Create labels to organize your transactions" />
            </ListItem>
          ) : (
            labels.map((label) => (
              <ListItem key={label.id} divider>
                <Chip
                  icon={<LabelIcon />}
                  label={label.name}
                  sx={{ mr: 2, backgroundColor: label.color, color: 'white' }}
                />
                <ListItemText
                  secondary={
                    label.auto_keywords?.length > 0
                      ? `Auto-keywords: ${label.auto_keywords.join(', ')}`
                      : 'No auto-keywords'
                  }
                />
                <ListItemSecondaryAction>
                  <IconButton edge="end" size="small" onClick={() => openEdit(label)}>
                    <Edit fontSize="small" />
                  </IconButton>
                  <IconButton edge="end" size="small" onClick={() => handleDelete(label)}>
                    <Delete fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))
          )}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Label' : 'Create New Label'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Label Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Color"
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Auto-Keywords (comma separated)"
              value={form.auto_keywords}
              onChange={(e) => setForm({ ...form, auto_keywords: e.target.value })}
              helperText="Transactions matching these keywords will be auto-labeled (e.g., 'Amazon, Flipkart' for Shopping)"
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name.trim() || saving}>
            {saving ? 'Saving…' : editing ? 'Update Label' : 'Create Label'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
