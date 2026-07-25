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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../../services/api';
import { ICON_KEYS, getCategoryIconComponent, invalidateCategories } from '../../utils/categories';
import CategoryIcon from '../CategoryIcon';

const KIND_OPTIONS = ['expense', 'income', 'transfer'];

const emptyForm = {
  name: '',
  icon: 'Category',
  color: '#1aa565',
  kind: 'expense',
  sort_order: 0,
  parent_id: '',
};

const kindColor = (kind) => {
  if (kind === 'income') return 'success';
  if (kind === 'transfer') return 'info';
  return 'default';
};

export default function CategoriesPanel() {
  const [categories, setCategories] = useState([]);
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
      const data = await getCategories();
      setCategories(data || []);
    } catch (err) {
      setError('Failed to load categories');
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

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || '',
      icon: c.icon || 'Category',
      color: c.color || '#1aa565',
      kind: c.kind || 'expense',
      sort_order: c.sort_order ?? 0,
      parent_id: c.parent_id ?? '',
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
        icon: form.icon,
        color: form.color,
        kind: form.kind,
        sort_order: parseInt(form.sort_order, 10) || 0,
        parent_id: form.parent_id === '' ? null : form.parent_id,
      };
      if (editing) {
        await updateCategory(editing.id, payload);
        setSuccess('Category updated');
      } else {
        await createCategory(payload);
        setSuccess('Category created');
      }
      invalidateCategories();
      closeDialog();
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete category "${c.name}"? This cannot be undone.`)) return;
    setError('');
    try {
      await deleteCategory(c.id);
      invalidateCategories();
      setSuccess('Category deleted');
      fetchData();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to delete category');
    }
  };

  const topLevel = categories.filter((c) => c.parent_id == null);
  const childrenOf = (id) => categories.filter((c) => c.parent_id === id);

  const renderRow = (c, isChild = false) => (
    <ListItem key={c.id} divider sx={isChild ? { pl: 7 } : undefined}>
      <Box sx={{ mr: 2 }}>
        <CategoryIcon name={c.name} meta={{ icon: c.icon, color: c.color, kind: c.kind }} />
      </Box>
      <ListItemText
        primary={c.name}
        secondary={`Sort order: ${c.sort_order ?? 0}`}
      />
      <Chip
        label={c.kind || 'expense'}
        size="small"
        color={kindColor(c.kind)}
        sx={{ mr: 8, textTransform: 'capitalize' }}
      />
      <ListItemSecondaryAction>
        <IconButton edge="end" size="small" onClick={() => openEdit(c)}>
          <Edit fontSize="small" />
        </IconButton>
        <IconButton edge="end" size="small" onClick={() => handleDelete(c)}>
          <Delete fontSize="small" />
        </IconButton>
      </ListItemSecondaryAction>
    </ListItem>
  );

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Categories</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openAdd}>
          Add Category
        </Button>
      </Box>
      <Divider sx={{ mb: 2 }} />

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      <Alert severity="info" sx={{ mb: 2 }}>
        Categories drive how transactions are grouped and displayed across the app. Changes are reflected everywhere.
      </Alert>

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
      ) : (
        <List>
          {categories.length === 0 ? (
            <ListItem>
              <ListItemText primary="No categories yet" secondary="Create a category to get started" />
            </ListItem>
          ) : (
            topLevel.map((parent) => (
              <React.Fragment key={parent.id}>
                {renderRow(parent, false)}
                {childrenOf(parent.id).map((child) => renderRow(child, true))}
              </React.Fragment>
            ))
          )}
        </List>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Category' : 'Add Category'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              sx={{ mb: 2 }}
              required
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Parent category</InputLabel>
              <Select
                value={form.parent_id}
                label="Parent category"
                onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              >
                <MenuItem value="">— None (top level) —</MenuItem>
                {topLevel
                  .filter((c) => !editing || c.id !== editing.id)
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
              </Select>
            </FormControl>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>Icon</Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                mb: 2,
                maxHeight: 180,
                overflow: 'auto',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
              }}
            >
              {ICON_KEYS.map((key) => {
                const IconComp = getCategoryIconComponent(key);
                const selected = form.icon === key;
                return (
                  <Tooltip title={key} key={key}>
                    <IconButton
                      onClick={() => setForm({ ...form, icon: key })}
                      sx={{
                        border: selected ? '2px solid' : '1px solid transparent',
                        borderColor: selected ? 'primary.main' : 'transparent',
                        bgcolor: selected ? 'action.selected' : 'transparent',
                        borderRadius: 1,
                      }}
                    >
                      <IconComp />
                    </IconButton>
                  </Tooltip>
                );
              })}
            </Box>

            <TextField
              fullWidth
              label="Color"
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              sx={{ mb: 2 }}
            />

            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Kind</InputLabel>
              <Select
                value={form.kind}
                label="Kind"
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                {KIND_OPTIONS.map((k) => (
                  <MenuItem key={k} value={k} sx={{ textTransform: 'capitalize' }}>{k}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="Sort order"
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!form.name.trim() || saving}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
