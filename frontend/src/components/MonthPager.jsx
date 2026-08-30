import React, { useState } from 'react';
import {
  Box, Button, Popover, Tabs, Tab, IconButton, Typography, TextField, Chip,
} from '@mui/material';
import { ChevronLeft, ChevronRight, ArrowDropDown } from '@mui/icons-material';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfMonth = (y, m) => new Date(y, m, 1);
const endOfMonth = (y, m) => new Date(y, m + 1, 0);
const startOfWeek = (d) => { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); return x; };
const endOfWeek = (d) => { const x = startOfWeek(d); x.setDate(x.getDate() + 6); return x; };

// A period is { start_date, end_date, label } (ISO date strings), mirroring the
// mobile app's PeriodPager shape so the two stay conceptually the same thing.
export function currentMonthPeriod() {
  const now = new Date();
  return monthPeriod(now.getFullYear(), now.getMonth());
}

function monthPeriod(year, month) {
  const now = new Date();
  const isCurrent = year === now.getFullYear() && month === now.getMonth();
  return {
    start_date: toIso(startOfMonth(year, month)),
    end_date: toIso(endOfMonth(year, month)),
    label: isCurrent ? 'This month' : `${MONTH_ABBR[month]} ${year}`,
    _year: year,
    _month: month,
  };
}

const PRESETS_ROW1 = [
  { key: 'this_week', label: 'This week' },
  { key: 'this_month', label: 'This month' },
  { key: 'this_year', label: 'This year' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
];
const PRESETS_ROW2 = [
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '12m', label: '12 months' },
  { key: 'all', label: 'All' },
];

function resolvePreset(key) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case 'this_week':
      return { start_date: toIso(startOfWeek(today)), end_date: toIso(endOfWeek(today)), label: 'This week' };
    case 'this_month':
      return monthPeriod(today.getFullYear(), today.getMonth());
    case 'this_year':
      return { start_date: `${today.getFullYear()}-01-01`, end_date: `${today.getFullYear()}-12-31`, label: 'This year' };
    case 'today':
      return { start_date: toIso(today), end_date: toIso(today), label: 'Today' };
    case '7d': {
      const s = new Date(today); s.setDate(s.getDate() - 6);
      return { start_date: toIso(s), end_date: toIso(today), label: 'Last 7 days' };
    }
    case '30d': {
      const s = new Date(today); s.setDate(s.getDate() - 29);
      return { start_date: toIso(s), end_date: toIso(today), label: 'Last 30 days' };
    }
    case '90d': {
      const s = new Date(today); s.setDate(s.getDate() - 89);
      return { start_date: toIso(s), end_date: toIso(today), label: 'Last 90 days' };
    }
    case '12m': {
      const s = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1);
      return { start_date: toIso(s), end_date: toIso(today), label: 'Last 12 months' };
    }
    case 'all':
      return { start_date: null, end_date: null, label: 'All time' };
    default:
      return monthPeriod(today.getFullYear(), today.getMonth());
  }
}

// Top-center "< This month >" pager with a click-to-open popover offering
// Custom range / Weeks / Months / Years tabs, matching the reference app.
export default function MonthPager({ period, onChange }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [tab, setTab] = useState('months');
  const [pickerYear, setPickerYear] = useState(period?._year ?? new Date().getFullYear());
  const [decadeStart, setDecadeStart] = useState(Math.floor((period?._year ?? new Date().getFullYear()) / 10) * 10);
  const [customStart, setCustomStart] = useState(period?.start_date || '');
  const [customEnd, setCustomEnd] = useState(period?.end_date || '');

  const open = Boolean(anchorEl);

  const stepMonth = (delta) => {
    if (period?._year == null || period?._month == null) {
      onChange(currentMonthPeriod());
      return;
    }
    let y = period._year;
    let m = period._month + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    onChange(monthPeriod(y, m));
  };

  const handleOpen = (e) => {
    setAnchorEl(e.currentTarget);
    setPickerYear(period?._year ?? new Date().getFullYear());
    setDecadeStart(Math.floor((period?._year ?? new Date().getFullYear()) / 10) * 10);
    setCustomStart(period?.start_date || '');
    setCustomEnd(period?.end_date || '');
  };
  const handleClose = () => setAnchorEl(null);

  const pickMonth = (m) => { onChange(monthPeriod(pickerYear, m)); handleClose(); };
  const pickYear = (y) => { onChange({ start_date: `${y}-01-01`, end_date: `${y}-12-31`, label: String(y) }); handleClose(); };
  const applyCustom = () => {
    if (!customStart || !customEnd) return;
    onChange({ start_date: customStart, end_date: customEnd, label: `${customStart} – ${customEnd}` });
    handleClose();
  };
  const applyPreset = (key) => { onChange(resolvePreset(key)); handleClose(); };

  return (
    <Box display="flex" alignItems="center" justifyContent="center" gap={1} sx={{ mb: 2 }}>
      <IconButton onClick={() => stepMonth(-1)} size="small"><ChevronLeft /></IconButton>
      <Button
        variant="outlined"
        onClick={handleOpen}
        endIcon={<ArrowDropDown />}
        sx={{ minWidth: 180, borderRadius: 5, textTransform: 'none', fontWeight: 600 }}
      >
        {period?.label || 'This month'}
      </Button>
      <IconButton onClick={() => stepMonth(1)} size="small"><ChevronRight /></IconButton>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Box sx={{ width: 360, p: 2 }}>
          <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="fullWidth" sx={{ mb: 2, minHeight: 32 }}>
            <Tab value="custom" label="Custom range" sx={{ minHeight: 32, textTransform: 'none' }} />
            <Tab value="weeks" label="Weeks" sx={{ minHeight: 32, textTransform: 'none' }} />
            <Tab value="months" label="Months" sx={{ minHeight: 32, textTransform: 'none' }} />
            <Tab value="years" label="Years" sx={{ minHeight: 32, textTransform: 'none' }} />
          </Tabs>

          {tab === 'months' && (
            <Box>
              <Box display="flex" alignItems="center" justifyContent="center" gap={2} mb={1.5}>
                <IconButton size="small" onClick={() => setPickerYear((y) => y - 1)}><ChevronLeft fontSize="small" /></IconButton>
                <Typography fontWeight={700}>{pickerYear}</Typography>
                <IconButton size="small" onClick={() => setPickerYear((y) => y + 1)}><ChevronRight fontSize="small" /></IconButton>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                {MONTH_ABBR.map((label, idx) => {
                  const isActive = period?._year === pickerYear && period?._month === idx;
                  return (
                    <Button
                      key={label}
                      size="small"
                      variant={isActive ? 'contained' : 'text'}
                      color="primary"
                      onClick={() => pickMonth(idx)}
                      sx={{ borderRadius: 2, textTransform: 'none' }}
                    >
                      {label}
                    </Button>
                  );
                })}
              </Box>
            </Box>
          )}

          {tab === 'years' && (
            <Box>
              <Box display="flex" alignItems="center" justifyContent="center" gap={2} mb={1.5}>
                <IconButton size="small" onClick={() => setDecadeStart((y) => y - 10)}><ChevronLeft fontSize="small" /></IconButton>
                <Typography fontWeight={700}>{decadeStart} – {decadeStart + 9}</Typography>
                <IconButton size="small" onClick={() => setDecadeStart((y) => y + 10)}><ChevronRight fontSize="small" /></IconButton>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                {Array.from({ length: 10 }, (_, i) => decadeStart + i).map((y) => (
                  <Button
                    key={y}
                    size="small"
                    variant={period?._year === y ? 'contained' : 'text'}
                    color="primary"
                    onClick={() => pickYear(y)}
                    sx={{ borderRadius: 2, textTransform: 'none' }}
                  >
                    {y}
                  </Button>
                ))}
              </Box>
            </Box>
          )}

          {tab === 'weeks' && (
            <Box display="flex" flexDirection="column" gap={1}>
              {Array.from({ length: 8 }, (_, i) => i).map((i) => {
                const now = new Date();
                const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
                const s = startOfWeek(base);
                const e = endOfWeek(base);
                const label = i === 0 ? 'This week' : i === 1 ? 'Last week' : `${s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
                return (
                  <Button
                    key={i}
                    size="small"
                    variant="text"
                    sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                    onClick={() => { onChange({ start_date: toIso(s), end_date: toIso(e), label }); handleClose(); }}
                  >
                    {label}
                  </Button>
                );
              })}
            </Box>
          )}

          {tab === 'custom' && (
            <Box>
              <Box display="flex" gap={1} mb={2}>
                <TextField
                  size="small" type="date" label="Start" value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  InputLabelProps={{ shrink: true }} fullWidth
                />
                <TextField
                  size="small" type="date" label="End" value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  InputLabelProps={{ shrink: true }} fullWidth
                />
              </Box>
              <Button variant="contained" fullWidth onClick={applyCustom} disabled={!customStart || !customEnd} sx={{ mb: 2 }}>
                Apply
              </Button>
              <Box display="flex" flexWrap="wrap" gap={0.75} mb={0.75}>
                {PRESETS_ROW1.map((p) => (
                  <Chip key={p.key} label={p.label} size="small" onClick={() => applyPreset(p.key)} clickable />
                ))}
              </Box>
              <Box display="flex" flexWrap="wrap" gap={0.75}>
                {PRESETS_ROW2.map((p) => (
                  <Chip key={p.key} label={p.label} size="small" onClick={() => applyPreset(p.key)} clickable />
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Popover>
    </Box>
  );
}
