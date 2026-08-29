import React from 'react';
import { Dialog, DialogTitle, DialogContent, List, ListItemButton, ListItemIcon, ListItemText, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';
import { WIDGET_CATALOG } from './widgetCatalog';

export default function AddWidgetDialog({ open, onClose, onAdd, existingTypes = [] }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Add a widget
        <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List disablePadding>
          {Object.entries(WIDGET_CATALOG).map(([type, meta]) => {
            const Icon = meta.icon;
            const alreadyAdded = !meta.repeatable && existingTypes.includes(type);
            return (
              <ListItemButton key={type} onClick={() => onAdd(type)} sx={{ opacity: alreadyAdded ? 0.6 : 1 }}>
                <ListItemIcon><Icon /></ListItemIcon>
                <ListItemText primary={meta.label} secondary={meta.description} />
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>
    </Dialog>
  );
}
