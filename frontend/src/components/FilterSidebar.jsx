import React from 'react';
import {
  Box, Paper, Typography, TextField, InputAdornment, IconButton, Button,
  FormControl, InputLabel, Select, MenuItem, Autocomplete,
  Slider, Chip, Tooltip, Divider,
} from '@mui/material';
import { Search, RestartAlt, Tune } from '@mui/icons-material';

export const DEFAULT_FILTERS = {
  search: '',
  accountIds: [],
  categoryNames: [],
  labelIds: [],
  currencyCodes: [],
  recordTypes: [],
  amountMin: null,
  amountMax: null,
  includeTransfers: true,
  recordStates: [],
  paymentTypes: [],
  confirmationStatus: 'all',
};

const RECORD_TYPE_OPTS = [
  { value: 'debit', label: 'Expense' },
  { value: 'credit', label: 'Income' },
];
const RECORD_STATE_OPTS = [
  { value: 'cleared', label: 'Cleared' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'manual', label: 'Manual' },
];
const PAYMENT_TYPE_OPTS = [
  { value: 'pdf', label: 'Statement (PDF)' },
  { value: 'manual', label: 'Manual' },
  { value: 'ingest', label: 'API / Ingest' },
];
const TRANSFER_OPTS = [
  { value: true, label: 'Include transfers' },
  { value: false, label: 'Exclude transfers' },
];
const CONFIRMATION_STATUS_OPTS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending only' },
  { value: 'confirmed', label: 'Confirmed only' },
];

// A reusable Wallet-style left filter panel. Controlled via { value, onChange }.
// `show` selects which sections render so Records and Analytics can share it.
export default function FilterSidebar({
  value,
  onChange,
  banks = [],
  categories = [],
  labels = [],
  currencies = [],
  amountBound = 500000,
  show = ['search', 'accounts', 'categories', 'labels', 'recordTypes', 'amount'],
  title = 'Filters',
  width = 260,
}) {
  const v = { ...DEFAULT_FILTERS, ...(value || {}) };
  const set = (patch) => onChange({ ...v, ...patch });
  const has = (k) => show.includes(k);
  const isDefault = JSON.stringify({ ...v, amountMin: v.amountMin, amountMax: v.amountMax }) === JSON.stringify(DEFAULT_FILTERS);

  // Categories grouped by parent (sub-categories under their parent's name), so the
  // searchable dropdown shows structure instead of a flat alphabetical wall.
  const categoryOptions = React.useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const parentLabel = (c) => {
      if (!c.parent_id) return c.name; // a top-level category is its own group
      const parent = byId.get(c.parent_id);
      return parent ? parent.name : c.name;
    };
    return categories
      .map((c) => ({ value: c.name, label: c.name, group: parentLabel(c) }))
      .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  }, [categories]);

  // De-duplicate labels by name (case-insensitive) — imports/seeding can leave several
  // identically-named, unused label rows that only clutter the picker.
  const labelOptions = React.useMemo(() => {
    const seen = new Map(); // lowercased name -> chosen label row
    labels.forEach((l) => {
      const key = (l.name || '').trim().toLowerCase();
      if (!key) return;
      if (!seen.has(key)) seen.set(key, l);
    });
    return Array.from(seen.values())
      .map((l) => ({ value: l.id, label: l.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [labels]);

  // Wallet-style searchable multi-select: type to filter, chips for what's picked.
  // `options` = [{ value, label, group? }]; grouping (e.g. category parent) is optional.
  const multi = (label, options, selected, onSel, placeholder) => {
    const byValue = new Map(options.map((o) => [o.value, o]));
    const selectedOptions = selected.map((v) => byValue.get(v)).filter(Boolean);
    const hasGroups = options.some((o) => o.group);
    return (
      <Autocomplete
        multiple
        size="small"
        options={options}
        value={selectedOptions}
        onChange={(e, newVal) => onSel(newVal.map((o) => o.value))}
        isOptionEqualToValue={(o, val) => o.value === val.value}
        getOptionLabel={(o) => o.label}
        groupBy={hasGroups ? (o) => o.group : undefined}
        disableCloseOnSelect
        renderTags={(tagValue, getTagProps) =>
          tagValue.map((o, index) => (
            <Chip label={o.label} size="small" {...getTagProps({ index })} key={o.value} />
          ))
        }
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            placeholder={selected.length ? '' : (placeholder || `Search ${label.toLowerCase()}…`)}
          />
        )}
        ListboxProps={{ style: { maxHeight: 320 } }}
      />
    );
  };

  const sliderMax = Math.max(amountBound || 0, 1000);
  const rangeVal = [v.amountMin ?? 0, v.amountMax ?? sliderMax];

  return (
    <Paper variant="outlined" sx={{ width, minWidth: width, p: 2, borderRadius: 2, alignSelf: 'flex-start', position: 'sticky', top: 16 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Typography variant="h6" fontWeight={700} display="flex" alignItems="center" gap={0.5}>
          <Tune fontSize="small" /> {title}
        </Typography>
        <Tooltip title="Reset filters">
          <span>
            <IconButton size="small" disabled={isDefault} onClick={() => onChange({ ...DEFAULT_FILTERS })}>
              <RestartAlt fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box display="flex" flexDirection="column" gap={2}>
        {has('search') && (
          <TextField
            size="small" fullWidth placeholder="Search" value={v.search}
            onChange={(e) => set({ search: e.target.value })}
            InputProps={{ startAdornment: (<InputAdornment position="start"><Search fontSize="small" /></InputAdornment>) }}
          />
        )}

        {has('accounts') && multi(
          'Accounts',
          banks.map((b) => ({ value: b.id, label: b.name })),
          v.accountIds,
          (sel) => set({ accountIds: sel }),
          'Search accounts…'
        )}

        {has('categories') && multi(
          'Categories',
          categoryOptions,
          v.categoryNames,
          (sel) => set({ categoryNames: sel }),
          'Search categories…'
        )}

        {has('labels') && multi(
          'Labels',
          labelOptions,
          v.labelIds,
          (sel) => set({ labelIds: sel }),
          'Search labels…'
        )}

        {has('currencies') && multi(
          'Currencies',
          currencies.map((c) => ({ value: c.code, label: `${c.code} ${c.symbol || ''}`.trim() })),
          v.currencyCodes,
          (sel) => set({ currencyCodes: sel }),
          'Search currencies…'
        )}

        {has('recordTypes') && multi(
          'Record types',
          RECORD_TYPE_OPTS,
          v.recordTypes,
          (sel) => set({ recordTypes: sel })
        )}

        {has('amount') && (
          <Box>
            <Typography variant="caption" color="text.secondary">Amount range (INR)</Typography>
            <Slider
              size="small"
              value={rangeVal}
              min={0}
              max={sliderMax}
              onChange={(_, nv) => set({ amountMin: nv[0] || null, amountMax: nv[1] >= sliderMax ? null : nv[1] })}
              valueLabelDisplay="auto"
              valueLabelFormat={(x) => `₹${Number(x).toLocaleString('en-IN')}`}
            />
            <Box display="flex" gap={1}>
              <TextField
                size="small" type="number" label="Min" value={v.amountMin ?? ''}
                onChange={(e) => set({ amountMin: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <TextField
                size="small" type="number" label="Max" value={v.amountMax ?? ''}
                onChange={(e) => set({ amountMax: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Box>
          </Box>
        )}

        {has('transfers') && (
          <FormControl size="small" fullWidth>
            <InputLabel>Transfers</InputLabel>
            <Select
              value={v.includeTransfers}
              label="Transfers"
              onChange={(e) => set({ includeTransfers: e.target.value })}
            >
              {TRANSFER_OPTS.map((o) => (
                <MenuItem key={String(o.value)} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {has('recordStates') && multi(
          'Record states',
          RECORD_STATE_OPTS,
          v.recordStates,
          (sel) => set({ recordStates: sel })
        )}

        {has('paymentTypes') && multi(
          'Payment types',
          PAYMENT_TYPE_OPTS,
          v.paymentTypes,
          (sel) => set({ paymentTypes: sel })
        )}

        {has('confirmationStatus') && (
          <FormControl size="small" fullWidth>
            <InputLabel>Confirmation status</InputLabel>
            <Select
              value={v.confirmationStatus}
              label="Confirmation status"
              onChange={(e) => set({ confirmationStatus: e.target.value })}
            >
              {CONFIRMATION_STATUS_OPTS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <Divider />
        <Button variant="outlined" color="inherit" startIcon={<RestartAlt />} disabled={isDefault} onClick={() => onChange({ ...DEFAULT_FILTERS })} fullWidth>
          Reset Filter
        </Button>
      </Box>
    </Paper>
  );
}
