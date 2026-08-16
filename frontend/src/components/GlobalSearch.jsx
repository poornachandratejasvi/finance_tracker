import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconButton, Tooltip, Dialog, DialogContent, TextField, List, ListItemButton,
  ListItemText, Typography, Box, CircularProgress, InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CategoryIcon from '@mui/icons-material/Category';
import LabelIcon from '@mui/icons-material/Label';
import DescriptionIcon from '@mui/icons-material/Description';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import { globalSearch } from '../services/api';

const SECTIONS = [
  { key: 'transactions', label: 'Transactions', icon: <ReceiptLongIcon fontSize="small" /> },
  { key: 'banks', label: 'Accounts', icon: <AccountBalanceIcon fontSize="small" /> },
  { key: 'categories', label: 'Categories', icon: <CategoryIcon fontSize="small" /> },
  { key: 'labels', label: 'Labels', icon: <LabelIcon fontSize="small" /> },
  { key: 'templates', label: 'Templates', icon: <DescriptionIcon fontSize="small" /> },
  { key: 'reward_points', label: 'Reward Points', icon: <CardGiftcardIcon fontSize="small" /> },
];

function resultPath(item) {
  switch (item.type) {
    case 'transaction':
      return `/transactions?search=${encodeURIComponent(item.title)}`;
    case 'bank':
      return '/banks';
    case 'category':
      return `/transactions?category=${encodeURIComponent(item.title)}`;
    case 'label':
      return `/transactions?label_id=${item.id}`;
    case 'template':
      return '/settings';
    case 'reward_point':
      return '/reward-points';
    default:
      return '/dashboard';
  }
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (e) => {
      const isShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isShortcut) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      globalSearch(query.trim())
        .then(setResults)
        .catch(() => setResults(null))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const handleClose = () => {
    setOpen(false);
    setQuery('');
    setResults(null);
  };

  const handleSelect = (item) => {
    navigate(resultPath(item));
    handleClose();
  };

  const hasAnyResults = results && SECTIONS.some((s) => (results[s.key] || []).length > 0);

  return (
    <>
      <Tooltip title="Search (Ctrl/Cmd+K)">
        <IconButton color="inherit" onClick={() => setOpen(true)}>
          <SearchIcon />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open} onClose={handleClose} maxWidth="sm" fullWidth
        TransitionProps={{ onEntered: () => inputRef.current?.focus() }}
      >
        <DialogContent sx={{ p: 2 }}>
          <TextField
            inputRef={inputRef}
            fullWidth autoFocus placeholder="Search transactions, accounts, categories, labels…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
              ),
              endAdornment: loading ? (
                <InputAdornment position="end"><CircularProgress size={18} /></InputAdornment>
              ) : null,
            }}
          />

          {query.trim() && !loading && !hasAnyResults && (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              No results for "{query}".
            </Typography>
          )}

          {results && (
            <Box sx={{ mt: 1, maxHeight: 420, overflowY: 'auto' }}>
              {SECTIONS.map((section) => {
                const items = results[section.key] || [];
                if (items.length === 0) return null;
                return (
                  <Box key={section.key} sx={{ mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5 }}>
                      {section.icon}
                      <Typography variant="caption" fontWeight={700} color="text.secondary">
                        {section.label}
                      </Typography>
                    </Box>
                    <List dense disablePadding>
                      {items.map((item) => (
                        <ListItemButton key={`${item.type}-${item.id}`} onClick={() => handleSelect(item)}>
                          <ListItemText primary={item.title} secondary={item.subtitle} />
                        </ListItemButton>
                      ))}
                    </List>
                  </Box>
                );
              })}
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
