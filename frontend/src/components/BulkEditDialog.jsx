import React, { useState } from 'react';
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
import api from '../services/api';

const BulkEditDialog = ({ open, onClose, selectedTransactions, onSuccess }) => {
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [customFields, setCustomFields] = useState({});
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

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

  const handleBulkEdit = async () => {
    try {
      const updates = {};
      
      if (category) updates.category = category;
      if (notes) updates.notes = notes;
      if (Object.keys(customFields).length > 0) updates.custom_fields = customFields;

      await api.post('/api/transactions/bulk-edit', {
        transaction_ids: selectedTransactions.map(t => t.id),
        updates
      });

      onSuccess && onSuccess();
      onClose();
    } catch (error) {
      console.error('Error bulk editing transactions:', error);
      alert('Failed to update transactions');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Bulk Edit {selectedTransactions.length} Transactions
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          <TextField
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            fullWidth
            placeholder="Leave empty to keep existing"
          />

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
          disabled={!category && !notes && Object.keys(customFields).length === 0}
        >
          Update All
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BulkEditDialog;
