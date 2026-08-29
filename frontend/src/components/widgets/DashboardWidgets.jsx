import React, { useCallback, useEffect, useState } from 'react';
import { Box, Grid, Typography, Button, IconButton, Tooltip } from '@mui/material';
import { Add, Edit, Check } from '@mui/icons-material';
import WidgetCard from './WidgetCard.jsx';
import AddWidgetDialog from './AddWidgetDialog.jsx';
import { WIDGET_CATALOG } from './widgetCatalog';
import {
  getDashboardWidgets, addDashboardWidget, deleteDashboardWidget, reorderDashboardWidgets,
} from '../../services/api';

const SIZE_GRID = { small: { xs: 12, sm: 6, md: 3 }, medium: { xs: 12, sm: 6, md: 4 }, large: { xs: 12, md: 8 } };

// A user-configurable section of dashboard cards: add/remove/reorder widgets
// from WIDGET_CATALOG, persisted server-side via /api/dashboard-widgets. Each
// widget renders itself against an existing endpoint (no new aggregation
// logic lives here) -- this component only owns layout + CRUD.
export default function DashboardWidgets() {
  const [widgets, setWidgets] = useState(null);
  const [editing, setEditing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    getDashboardWidgets().then(setWidgets).catch(() => setWidgets([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async (widgetType) => {
    const meta = WIDGET_CATALOG[widgetType];
    const created = await addDashboardWidget({ widget_type: widgetType, size: meta?.size || 'medium' });
    setWidgets((prev) => [...(prev || []), created]);
    setDialogOpen(false);
  };

  const handleRemove = async (id) => {
    await deleteDashboardWidget(id);
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  };

  const handleWidgetUpdated = (updated) => {
    setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  };

  const move = async (index, direction) => {
    const next = [...widgets];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setWidgets(next);
    reorderDashboardWidgets(next.map((w) => w.id)).catch(() => load());
  };

  if (widgets === null) return null; // avoid a flash of "no widgets" while loading

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="h6" fontWeight={700}>Your Widgets</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {editing && (
            <Button size="small" startIcon={<Add />} onClick={() => setDialogOpen(true)} variant="outlined">
              Add widget
            </Button>
          )}
          <Tooltip title={editing ? 'Done editing' : 'Edit widgets'}>
            <IconButton size="small" onClick={() => setEditing((e) => !e)} color={editing ? 'primary' : 'default'}>
              {editing ? <Check fontSize="small" /> : <Edit fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {widgets.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 4, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>No widgets added yet.</Typography>
          <Button startIcon={<Add />} variant="contained" onClick={() => setDialogOpen(true)}>Add your first widget</Button>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {widgets.map((w, i) => {
            const meta = WIDGET_CATALOG[w.widget_type];
            if (!meta) return null; // unknown type (e.g. removed from a newer catalog) -- skip silently
            const Content = meta.Content;
            return (
              <Grid item key={w.id} {...(SIZE_GRID[w.size] || SIZE_GRID.medium)}>
                <WidgetCard
                  title={meta.label}
                  editing={editing}
                  size={w.size}
                  onRemove={() => handleRemove(w.id)}
                  onMoveUp={() => move(i, -1)}
                  onMoveDown={() => move(i, 1)}
                  canMoveUp={i > 0}
                  canMoveDown={i < widgets.length - 1}
                >
                  <Content widget={w} onWidgetUpdated={handleWidgetUpdated} />
                </WidgetCard>
              </Grid>
            );
          })}
        </Grid>
      )}

      <AddWidgetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdd={handleAdd}
        existingTypes={widgets.map((w) => w.widget_type)}
      />
    </Box>
  );
}
