import React from 'react';
import {
  AppBar, Toolbar, Typography, Box, IconButton, Menu, MenuItem,
  Badge, Popover, List, ListItem, ListItemButton, ListItemText, ListItemIcon,
  Divider, Chip, CircularProgress, Tooltip, LinearProgress, Drawer,
  ListSubheader, useMediaQuery,
} from '@mui/material';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useActivity } from '../contexts/ActivityContext';
import AccountCircle from '@mui/icons-material/AccountCircle';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import NotificationsIcon from '@mui/icons-material/Notifications';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import SyncIcon from '@mui/icons-material/Sync';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InsightsIcon from '@mui/icons-material/Insights';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import FlagIcon from '@mui/icons-material/Flag';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DescriptionIcon from '@mui/icons-material/Description';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TableChartIcon from '@mui/icons-material/TableChart';
import WorkIcon from '@mui/icons-material/Work';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TuneIcon from '@mui/icons-material/Tune';
import KeyIcon from '@mui/icons-material/Key';
import SettingsIcon from '@mui/icons-material/Settings';

const DRAWER_WIDTH = 236;

const NAV_GROUPS = [
  { heading: 'Overview', items: [
    { label: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
    { label: 'Analytics', path: '/analytics', icon: <InsightsIcon /> },
    { label: 'Ask AI', path: '/assistant', icon: <AutoAwesomeIcon /> },
  ] },
  { heading: 'Money', items: [
    { label: 'Transactions', path: '/transactions', icon: <ReceiptLongIcon /> },
    { label: 'Budgets', path: '/budgets', icon: <AccountBalanceWalletIcon /> },
    { label: 'Goals', path: '/goals', icon: <FlagIcon /> },
  ] },
  { heading: 'Accounts & Data', items: [
    { label: 'Banks', path: '/banks', icon: <AccountBalanceIcon /> },
    { label: 'Statements', path: '/bank-statements', icon: <DescriptionIcon /> },
    { label: 'PDFs', path: '/pdfs', icon: <PictureAsPdfIcon /> },
    { label: 'CSV Exports', path: '/csv', icon: <TableChartIcon /> },
  ] },
  { heading: 'System', items: [
    { label: 'Jobs', path: '/jobs', icon: <WorkIcon /> },
    { label: 'Automation', path: '/automation', icon: <SmartToyIcon /> },
    { label: 'Field Mapping', path: '/field-mapping', icon: <TuneIcon /> },
    { label: 'API Access', path: '/api-access', icon: <KeyIcon /> },
    { label: 'Settings', path: '/settings', icon: <SettingsIcon /> },
  ] },
];

const statusColor = (s) => {
  if (s === 'processing' || s === 'running') return 'warning';
  if (s === 'success') return 'success';
  if (s === 'failed') return 'error';
  if (s === 'partial') return 'warning';
  return 'default';
};

const statusIcon = (s) => {
  if (s === 'processing' || s === 'running' || s === 'queued') return <CircularProgress size={14} />;
  if (s === 'success') return <CheckCircleIcon fontSize="small" color="success" />;
  if (s === 'failed') return <ErrorIcon fontSize="small" color="error" />;
  return <SyncIcon fontSize="small" />;
};

const fmtTs = (iso) => {
  if (!iso) return '';
  try {
    const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
    const d = new Date(hasTz ? iso : `${iso}Z`);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
};

const syncProgressPct = (s) => {
  const total = s.total_emails || 0;
  if (total <= 0) return null;
  return Math.min(100, Math.round((100 * (s.processed_emails || 0)) / total));
};

const Layout = ({ children }) => {
  const { user, logout } = useAuth();
  const { mode, toggleTheme } = useTheme();
  const { recentSyncs, activeSyncs = [], runningCount, refresh } = useActivity();
  const navigate = useNavigate();
  const location = useLocation();
  const muiTheme = useMuiTheme();
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'));

  const [anchorEl, setAnchorEl] = React.useState(null);
  const [activityAnchor, setActivityAnchor] = React.useState(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const handleMenu = (event) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const handleLogout = () => { logout(); navigate('/login'); handleClose(); };
  const handleActivityOpen = (e) => { refresh(); setActivityAnchor(e.currentTarget); };
  const handleActivityClose = () => setActivityAnchor(null);
  const go = (path) => { navigate(path); setMobileOpen(false); };

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const drawer = (
    <Box role="navigation" aria-label="Main navigation">
      <Toolbar sx={{ px: 2 }}>
        <AccountBalanceWalletIcon sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>Finance</Typography>
      </Toolbar>
      <Divider />
      {NAV_GROUPS.map((group) => (
        <List
          key={group.heading}
          dense
          subheader={<ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '30px', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>{group.heading}</ListSubheader>}
        >
          {group.items.map((item) => (
            <ListItem key={item.path} disablePadding>
              <ListItemButton selected={isActive(item.path)} onClick={() => go(item.path)} sx={{ borderRadius: 1, mx: 1 }}>
                <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      ))}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
            Finance Tracker
          </Typography>

          <Tooltip title="Background activity">
            <IconButton color="inherit" onClick={handleActivityOpen} sx={{ ml: 1 }}>
              <Badge badgeContent={runningCount > 0 ? runningCount : null} color="error" variant={runningCount > 0 ? 'standard' : 'dot'}
                invisible={runningCount === 0 && recentSyncs.length === 0}>
                {runningCount > 0 ? <CircularProgress size={20} color="inherit" thickness={5} /> : <NotificationsIcon />}
              </Badge>
            </IconButton>
          </Tooltip>

          <Popover
            open={Boolean(activityAnchor)}
            anchorEl={activityAnchor}
            onClose={handleActivityClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{ sx: { width: 380, maxHeight: 480, overflow: 'auto' } }}
          >
            <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle1" fontWeight={600}>Background Activity</Typography>
              <Box>
                <Tooltip title="Open Jobs page"><IconButton size="small" onClick={() => { handleActivityClose(); navigate('/jobs'); }}><WorkIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Refresh"><IconButton size="small" onClick={() => refresh()}><SyncIcon fontSize="small" /></IconButton></Tooltip>
              </Box>
            </Box>
            <Divider />
            {recentSyncs.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">No recent activity.</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {recentSyncs.map((s) => (
                  <ListItem key={s.sync_log_id} divider alignItems="flex-start"
                    sx={{ py: 1, bgcolor: s.status === 'processing' ? 'action.hover' : 'inherit' }}>
                    <ListItemIcon sx={{ minWidth: 30, mt: 0.5 }}>{statusIcon(s.status)}</ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Chip label={s.sync_type || 'sync'} size="small" variant="outlined" />
                          <Chip label={s.status} size="small" color={statusColor(s.status)} />
                          {(s.current_bank || s.gmail_email) && (
                            <Chip label={s.current_bank || s.gmail_email} size="small" variant="outlined" color="primary" />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5 }}>
                          {s.gmail_email && (
                            <Typography variant="caption" display="block" color="text.secondary">
                              Account: {s.gmail_email}
                            </Typography>
                          )}
                          <Typography variant="caption" display="block">
                            Started: {fmtTs(s.started_at)}
                            {s.completed_at && ` · Done: ${fmtTs(s.completed_at)}`}
                          </Typography>
                          <Typography variant="caption" display="block">
                            {s.emails_processed} emails · {s.transactions_added} txns
                            {s.duplicates_found > 0 && ` · ${s.duplicates_found} dupes`}
                          </Typography>
                          {(s.status === 'processing' || s.status === 'queued') && (s.current_step || s.total_emails > 0) && (
                            <Typography variant="caption" color="warning.main" display="block">
                              {s.current_step || 'Working'}
                              {s.total_emails > 0 ? ` · ${s.processed_emails || 0}/${s.total_emails}` : ''}
                            </Typography>
                          )}
                          {s.error_message && (
                            <Typography variant="caption" color="error" display="block" sx={{ wordBreak: 'break-word' }}>
                              {s.error_message.slice(0, 100)}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Popover>

          <IconButton onClick={toggleTheme} color="inherit" sx={{ ml: 0.5 }}>
            {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
          <IconButton size="large" onClick={handleMenu} color="inherit">
            <AccountCircle />
          </IconButton>
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
            <MenuItem disabled>{user?.username || 'User'}</MenuItem>
            <MenuItem onClick={handleLogout}>Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Sidebar */}
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? mobileOpen : true}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main content */}
      <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, minWidth: 0 }}>
        <Toolbar />{/* spacer for the fixed AppBar */}

        {/* Global live sync status bar */}
        {activeSyncs.length > 0 && (() => {
          const s = activeSyncs[0];
          const pct = syncProgressPct(s);
          return (
            <Box>
              <LinearProgress variant={pct === null ? 'indeterminate' : 'determinate'} value={pct === null ? undefined : pct} />
              <Box sx={{ px: 2, py: 0.5, bgcolor: 'action.hover', display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <CircularProgress size={14} thickness={5} />
                <Typography variant="caption" sx={{ fontWeight: 500 }}>
                  Sync in progress
                  {activeSyncs.length > 1 ? ` — ${activeSyncs.length} active jobs` : ''}
                  {s.current_step ? ` · ${s.current_step}` : ''}
                  {s.current_bank ? ` · ${s.current_bank}` : ''}
                  {s.total_emails > 0 ? ` · ${s.processed_emails || 0}/${s.total_emails} emails` : ''}
                  {s.transactions_added > 0 ? ` · ${s.transactions_added} txns` : ''}
                </Typography>
              </Box>
            </Box>
          );
        })()}

        <Box sx={{ p: 3 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};

export default Layout;
