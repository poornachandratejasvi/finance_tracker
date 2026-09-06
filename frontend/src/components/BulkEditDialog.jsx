import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip
} from '@mui/material';
import api, { bulkLabelTransactions } from '../services/api';

const BulkEditDialog = ({ open, onClose, selectedTransactions, categories = [], labels = [], onSuccess }) => {
  const [category, setCategory] = useState('');
  const [labelIds, setLabelIds] = useState([]);
  const [duplicateFlag, setDuplicateFlag] = useState(''); // '' | 'true' | 'false'
  const [notes, setNotes] = useState('');
  const [customFields, setCustomFields] = useState({});
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset transient selections whenever the dialog is reopened for a new batch.
  useEffect(() => {
    if (open) {
      setCategory('');
      setLabelIds([]);
      setDuplicateFlag('');
      setNotes('');
      setCustomFields({});
      setNewFieldName('');
      setNewFieldValue('');
    }
  }, [open]);

  const handleAddCustomField = () => {
    if (newFieldName && newFieldValue) {
      setCustomFields({
        ...customFields,
        [newFieldName]: newFieldValue
      });
      setNewFieldName('');
      setNewFieldValue('');
    }
  };

  const handleRemoveCustomField = (fieldName) => {
    const updated = { ...customFields };
    delete updated[fieldName];
    setCustomFields(updated);
  };

  const hasChanges = Boolean(
    category || notes || labelIds.length || duplicateFlag !== '' || Object.keys(customFields).length > 0
  );

  const handleBulkEdit = async () => {
    setSaving(true);
    try {
      const updates = {};

      if (category) updates.category = category;
      if (notes) updates.notes = notes;
      if (duplicateFlag !== '') updates.is_duplicate = duplicateFlag === 'true';
      if (Object.keys(customFields).length > 0) updates.custom_fields = customFields;

      const transactionIds = selectedTransactions.map(t => t.id);

      if (Object.keys(updates).length > 0) {
        await api.post('/api/transactions/bulk-edit', {
          transaction_ids: transactionIds,
          updates
        });
      }

      // Labels are additive (there's no bulk "replace the label set" endpoint,
      // same as the single-transaction Manage Labels dialog) -- one bulk-label
      // call per selected label, applied to every selected transaction.
      if (labelIds.length) {
        await Promise.all(
          labelIds.map((labelId) =>
            bulkLabelTransactions({ transaction_ids: transactionIds, label_id: labelId })
          )
        );
      }

      onSuccess && onSuccess();
      onClose();
    } catch (error) {
      console.error('Error bulk editing transactions:', error);
      alert('Failed to update transactions');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Bulk Edit {selectedTransactions.length} Transactions
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Category</InputLabel>
            <Select
              displayEmpty
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              label="Category"
              renderValue={(val) => val || 'Leave empty to keep existing'}
            >
              <MenuItem value=""><em>Leave empty to keep existing</em></MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.name}>{c.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Add Labels</InputLabel>
            <Select
              multiple
              value={labelIds}
              onChange={(e) => setLabelIds(e.target.value)}
              label="Add Labels"
              renderValue={(selected) => selected.map((id) => labels.find((l) => l.id === id)?.name || id).join(', ')}
            >
              {labels.map((label) => (
                <MenuItem key={label.id} value={label.id}>{label.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Duplicate Flag</InputLabel>
            <Select
              displayEmpty
              value={duplicateFlag}
              onChange={(e) => setDuplicateFlag(e.target.value)}
              label="Duplicate Flag"
            >
              <MenuItem value=""><em>Leave unchanged</em></MenuItem>
              <MenuItem value="true">Mark as duplicate</MenuItem>
              <MenuItem value="false">Unmark as duplicate</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            multiline
            rows={3}
            placeholder="Leave empty to keep existing"
          />

          <Typography variant="subtitle2" sx={{ mt: 2 }}>
            Custom Fields
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {Object.entries(customFields).map(([key, value]) => (
              <Chip
                key={key}
                label={`${key}: ${value}`}
                onDelete={() => handleRemoveCustomField(key)}
                color="primary"
                variant="outlined"
              />
            ))}
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              label="Field Name"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Field Value"
              value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <Button onClick={handleAddCustomField} variant="outlined">
              Add
            </Button>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleBulkEdit}
          variant="contained"
          disabled={!hasChanges || saving}
        >
          {saving ? 'Updating…' : 'Update All'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BulkEditDialog;
