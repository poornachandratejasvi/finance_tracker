import React from 'react';
import { Box, Paper, Typography, IconButton, Tooltip } from '@mui/material';
import { Close, ArrowUpward, ArrowDownward } from '@mui/icons-material';

// Shared chrome for every dashboard widget -- title bar + reorder/remove
// controls, editing controls only shown while the grid is in "edit" mode so
// the normal view stays clean.
export default function WidgetCard({ title, editing, onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown, size = 'medium', children }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: size === 'large' ? 340 : size === 'small' ? 180 : 260,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 700 }}>{title}</Typography>
        {editing && (
          <Box sx={{ display: 'flex', gap: 0.25 }}>
            <Tooltip title="Move left/up">
              <span>
                <IconButton size="small" onClick={onMoveUp} disabled={!canMoveUp}>
                  <ArrowUpward fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move right/down">
              <span>
                <IconButton size="small" onClick={onMoveDown} disabled={!canMoveDown}>
                  <ArrowDownward fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Remove widget">
              <IconButton size="small" color="error" onClick={onRemove}>
                <Close fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Paper>
  );
}
