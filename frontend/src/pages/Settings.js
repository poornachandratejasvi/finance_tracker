import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Container,
  Box,
  Paper,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Divider,
  Alert,
  Avatar,
  Button,
  TextField,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Link as MuiLink,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  AttachMoney,
  Category as CategoryIcon,
  Description,
  Label as LabelIcon,
  Rule,
  NotificationsActive,
  Person,
  Api,
  People,
  Backup as BackupIcon,
  Email,
  Dns,
  CreditCard,
  PrivacyTip,
  HelpOutline,
  DarkMode,
  LightMode,
  PhotoCamera,
  Launch,
  DeleteSweep,
  AutoAwesome,
  Terminal,
  Info,
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { setHideDecimals } from '../utils/format';
import {
  getCurrentUser,
  updateMe,
  changePassword,
  getPreferences,
  updatePreferences,
  getSystemSettings,
} from '../services/api';

// Panels built in parallel by other agents (self-contained default exports).
import CurrenciesPanel from '../components/settings/CurrenciesPanel';
import CategoriesPanel from '../components/settings/CategoriesPanel';
import TemplatesPanel from '../components/settings/TemplatesPanel';
import LabelsPanel from '../components/settings/LabelsPanel';
import AutomaticRulesPanel from '../components/settings/AutomaticRulesPanel';
import NotificationRulesPanel from '../components/settings/NotificationRulesPanel';
import ExternalAccountsPanel from '../components/settings/ExternalAccountsPanel';
import UsersPanel from '../components/settings/UsersPanel';
import BackupPanel from '../components/settings/BackupPanel';
import AIPanel from '../components/settings/AIPanel';
import LogsPanel from '../components/settings/LogsPanel';

const NAV_WIDTH = 230;

// Clears all locally cached data (prefs, theme, auth tokens) and reloads.
const clearLocalData = () => {
  if (
    !window.confirm(
      'Remove all locally stored data (preferences, theme, cached tokens) and reload? You will be signed out.'
    )
  ) {
    return;
  }
  localStorage.clear();
  window.location.reload();
};

// Initials fallback for avatars.
const initialsOf = (name, email) => {
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
};

/* -------------------------------------------------------------------------- */
/* GENERAL panel (implemented inline)                                          */
/* -------------------------------------------------------------------------- */
function GeneralPanel({ setSuccess, setError }) {
  const { mode, toggleTheme } = useTheme();

  const [profile, setProfile] = useState({
    full_name: '',
    email: '',
    username: '',
    avatar_url: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [prefs, setPrefs] = useState({
    language: 'en',
    default_interval: 'this_month',
    hide_decimals: false,
    auto_logout: false,
  });
  const [prefsLoading, setPrefsLoading] = useState(true);

  const [pwd, setPwd] = useState({ current_password: '', new_password: '', confirm: '' });
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [me, p] = await Promise.all([
          getCurrentUser(),
          getPreferences().catch(() => null),
        ]);
        setProfile({
          full_name: me.full_name || '',
          email: me.email || '',
          username: me.username || '',
          avatar_url: me.avatar_url || '',
        });
        if (p) setPrefs((prev) => ({ ...prev, ...p }));
      } catch (err) {
        setError('Failed to load profile');
      } finally {
        setPrefsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // Cover-crop to a centered square.
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setProfile((prev) => ({ ...prev, avatar_url: canvas.toDataURL('image/jpeg', 0.85) }));
      };
      img.onerror = () => setError('Could not read that image');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    setError('');
    try {
      await updateMe({
        full_name: profile.full_name,
        email: profile.email,
        avatar_url: profile.avatar_url,
      });
      const me = await getCurrentUser();
      setProfile({
        full_name: me.full_name || '',
        email: me.email || '',
        username: me.username || '',
        avatar_url: me.avatar_url || '',
      });
      setSuccess('Profile saved');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const persistPref = async (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if ('hide_decimals' in patch) setHideDecimals(!!patch.hide_decimals);
    try {
      await updatePreferences(patch);
    } catch (err) {
      setError('Failed to save preference');
    }
  };

  const handleChangePassword = async () => {
    setError('');
    if (!pwd.current_password || !pwd.new_password) {
      setError('Enter your current and new password');
      return;
    }
    if (pwd.new_password.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (pwd.new_password !== pwd.confirm) {
      setError('New password and confirmation do not match');
      return;
    }
    setSavingPwd(true);
    try {
      await changePassword({
        current_password: pwd.current_password,
        new_password: pwd.new_password,
      });
      setPwd({ current_password: '', new_password: '', confirm: '' });
      setSuccess('Password changed');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to change password');
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Profile
      </Typography>
      <Divider sx={{ mb: 3 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 3, flexWrap: 'wrap' }}>
        <Avatar
          src={profile.avatar_url || undefined}
          sx={{ width: 88, height: 88, fontSize: 30, bgcolor: 'primary.main' }}
        >
          {!profile.avatar_url && initialsOf(profile.full_name, profile.email)}
        </Avatar>
        <Box>
          <Button component="label" variant="outlined" startIcon={<PhotoCamera />}>
            Upload photo
            <input hidden type="file" accept="image/*" onChange={handlePhoto} />
          </Button>
          {profile.avatar_url && (
            <Button
              sx={{ ml: 1 }}
              color="inherit"
              onClick={() => setProfile((p) => ({ ...p, avatar_url: '' }))}
            >
              Remove
            </Button>
          )}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Images are resized to 256×256 before saving.
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Username"
            value={profile.username}
            disabled
            helperText="Username cannot be changed"
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Full name"
            value={profile.full_name}
            onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
          />
        </Grid>
        <Grid item xs={12}>
          <Button variant="contained" onClick={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save'}
          </Button>
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Preferences
      </Typography>
      {prefsLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel id="lang-label">Website language</InputLabel>
              <Select
                labelId="lang-label"
                label="Website language"
                value={prefs.language}
                onChange={(e) => persistPref({ language: e.target.value })}
              >
                <MenuItem value="en">English</MenuItem>
                <MenuItem value="es">Español</MenuItem>
                <MenuItem value="de">Deutsch</MenuItem>
                <MenuItem value="fr">Français</MenuItem>
                <MenuItem value="hi">हिन्दी</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel id="interval-label">Default interval on Dashboard</InputLabel>
              <Select
                labelId="interval-label"
                label="Default interval on Dashboard"
                value={prefs.default_interval}
                onChange={(e) => persistPref({ default_interval: e.target.value })}
              >
                <MenuItem value="this_month">This month</MenuItem>
                <MenuItem value="last_month">Last month</MenuItem>
                <MenuItem value="this_year">This year</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!prefs.hide_decimals}
                  onChange={(e) => persistPref({ hide_decimals: e.target.checked })}
                />
              }
              label="Hide decimals within amounts"
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={!!prefs.auto_logout}
                  onChange={(e) => persistPref({ auto_logout: e.target.checked })}
                />
              }
              label="Enable auto-logout"
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch checked={mode === 'dark'} onChange={toggleTheme} />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {mode === 'dark' ? (
                    <DarkMode fontSize="small" />
                  ) : (
                    <LightMode fontSize="small" />
                  )}
                  Dark theme
                </Box>
              }
            />
          </Grid>
        </Grid>
      )}

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Change password
      </Typography>
      <Grid container spacing={2} sx={{ maxWidth: 520 }}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="password"
            label="Current password"
            value={pwd.current_password}
            onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })}
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="password"
            label="New password"
            value={pwd.new_password}
            onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })}
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            type="password"
            label="Confirm new password"
            value={pwd.confirm}
            onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
          />
        </Grid>
        <Grid item xs={12}>
          <Button variant="contained" onClick={handleChangePassword} disabled={savingPwd}>
            {savingPwd ? 'Updating…' : 'Update password'}
          </Button>
        </Grid>
      </Grid>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Local data
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Clear cached preferences, theme and sign-in tokens stored in this browser.
      </Typography>
      <Button color="error" variant="outlined" startIcon={<DeleteSweep />} onClick={clearLocalData}>
        Remove local data
      </Button>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/* REST API panel (links to the existing full page)                            */
/* -------------------------------------------------------------------------- */
function RestApiPanel() {
  const navigate = useNavigate();
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        REST API
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Create API tokens and configure ingest field mapping to post transactions from an iOS
        Shortcut, webhook or any external client.
      </Typography>
      <Button variant="contained" startIcon={<Launch />} onClick={() => navigate('/api-access')}>
        Open API Access
      </Button>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/* Simple informational panels                                                 */
/* -------------------------------------------------------------------------- */
function InfoPanel({ title, children }) {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {children}
    </Box>
  );
}

function McpPanel() {
  return (
    <InfoPanel title="MCP Server">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The Model Context Protocol (MCP) server lets AI assistants securely query your finance
        data through a standard tool interface. Point an MCP-compatible client at this instance and
        authenticate with a REST API token to expose your transactions, categories and reports as
        tools.
      </Typography>
      <Alert severity="info">
        Generate a token under <strong>REST API</strong>, then configure your MCP client to use it
        as the <code>X-API-Key</code> credential.
      </Alert>
    </InfoPanel>
  );
}

function BillingPanel() {
  return (
    <InfoPanel title="Billing">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This is a self-hosted instance — there is no subscription or billing tied to your account.
        All features are available without a paid plan.
      </Typography>
      <Alert severity="success">You are on the self-hosted plan. Nothing to pay.</Alert>
    </InfoPanel>
  );
}

function PrivacyPanel() {
  return (
    <InfoPanel title="Personal data & privacy">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Your financial data stays on this self-hosted instance. You can clear everything cached in
        this browser at any time. Removing local data signs you out and wipes preferences, theme and
        access tokens from this device — your server-side data is unaffected.
      </Typography>
      <Button color="error" variant="outlined" startIcon={<DeleteSweep />} onClick={clearLocalData}>
        Remove local data
      </Button>
    </InfoPanel>
  );
}

function HelpPanel() {
  return (
    <InfoPanel title="Help">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Find guides on connecting banks, importing statements, categorising transactions and setting
        up automatic rules in the documentation.
      </Typography>
      <Stack spacing={1}>
        <MuiLink href="/docs" target="_blank" rel="noopener">
          Open documentation
        </MuiLink>
      </Stack>
    </InfoPanel>
  );
}

function AboutPanel() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSystemSettings()
      .then(setInfo)
      .catch(() => setError("Couldn't load version info."));
  }, []);

  return (
    <InfoPanel title="About">
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Version: <strong>{info ? info.app_version : '…'}</strong>
        </Typography>
      </Stack>
      <Stack spacing={1}>
        <MuiLink
          href="https://github.com/poornachandratejasvi/finance_tracker"
          target="_blank"
          rel="noopener"
        >
          View source on GitHub
        </MuiLink>
        <MuiLink
          href="https://github.com/poornachandratejasvi/finance_tracker/pkgs/container/finance_tracker-backend"
          target="_blank"
          rel="noopener"
        >
          Browse release versions
        </MuiLink>
      </Stack>
    </InfoPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav configuration                                                           */
/* -------------------------------------------------------------------------- */
const NAV_SECTIONS = [
  {
    section: 'Wallet',
    items: [
      { key: 'currencies', label: 'Currencies', icon: <AttachMoney /> },
      { key: 'categories', label: 'Categories', icon: <CategoryIcon /> },
      { key: 'templates', label: 'Templates', icon: <Description /> },
      { key: 'labels', label: 'Labels', icon: <LabelIcon /> },
      { key: 'rules', label: 'Automatic Rules', icon: <Rule /> },
      { key: 'notification-rules', label: 'Notification Rules', icon: <NotificationsActive /> },
    ],
  },
  {
    section: 'General',
    items: [
      { key: 'general', label: 'General', icon: <Person /> },
      { key: 'ai', label: 'AI', icon: <AutoAwesome /> },
      { key: 'rest-api', label: 'REST API', icon: <Api /> },
      { key: 'users', label: 'Users', icon: <People />, adminOnly: true },
      { key: 'external-accounts', label: 'External Accounts', icon: <Email /> },
      { key: 'backup', label: 'Backup', icon: <BackupIcon /> },
      { key: 'mcp', label: 'MCP Server', icon: <Dns /> },
      { key: 'logs', label: 'Application Logs', icon: <Terminal />, adminOnly: true },
      { key: 'billing', label: 'Billing', icon: <CreditCard /> },
      { key: 'privacy', label: 'Personal data & privacy', icon: <PrivacyTip /> },
      { key: 'help', label: 'Help', icon: <HelpOutline /> },
      { key: 'about', label: 'About', icon: <Info /> },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Settings HUB shell                                                          */
/* -------------------------------------------------------------------------- */
function Settings() {
  const { user } = useAuth();
  const location = useLocation();
  const isAdmin = user?.role === 'ADMIN';

  const [active, setActive] = useState('general');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ?drive_connected=1 -> jump to Backup and confirm the OAuth round-trip.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('drive_connected') === '1') {
      setActive('backup');
      setSuccess('Google Drive connected successfully.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const renderPanel = () => {
    switch (active) {
      case 'currencies':
        return <CurrenciesPanel />;
      case 'categories':
        return <CategoriesPanel />;
      case 'templates':
        return <TemplatesPanel />;
      case 'labels':
        return <LabelsPanel />;
      case 'rules':
        return <AutomaticRulesPanel />;
      case 'notification-rules':
        return <NotificationRulesPanel />;
      case 'external-accounts':
        return <ExternalAccountsPanel />;
      case 'users':
        return isAdmin ? <UsersPanel /> : <GeneralPanel setSuccess={setSuccess} setError={setError} />;
      case 'backup':
        return <BackupPanel />;
      case 'ai':
        return <AIPanel />;
      case 'rest-api':
        return <RestApiPanel />;
      case 'mcp':
        return <McpPanel />;
      case 'logs':
        return isAdmin ? <LogsPanel /> : <GeneralPanel setSuccess={setSuccess} setError={setError} />;
      case 'billing':
        return <BillingPanel />;
      case 'privacy':
        return <PrivacyPanel />;
      case 'help':
        return <HelpPanel />;
      case 'about':
        return <AboutPanel />;
      case 'general':
      default:
        return <GeneralPanel setSuccess={setSuccess} setError={setError} />;
    }
  };

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
        {/* Left navigation rail */}
        <Paper
          sx={{
            width: { xs: '100%', md: NAV_WIDTH },
            flexShrink: 0,
            alignSelf: 'flex-start',
            py: 1,
          }}
        >
          {NAV_SECTIONS.map((sec) => (
            <List
              key={sec.section}
              dense
              subheader={
                <ListSubheader
                  disableSticky
                  sx={{
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    bgcolor: 'transparent',
                    lineHeight: 2.2,
                  }}
                >
                  {sec.section}
                </ListSubheader>
              }
            >
              {sec.items
                .filter((item) => !item.adminOnly || isAdmin)
                .map((item) => (
                  <ListItemButton
                    key={item.key}
                    selected={active === item.key}
                    onClick={() => setActive(item.key)}
                    sx={{ mx: 1, borderRadius: 1.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                    />
                  </ListItemButton>
                ))}
            </List>
          ))}
        </Paper>

        {/* Right content panel */}
        <Paper sx={{ flexGrow: 1, p: 3, minWidth: 0 }}>{renderPanel()}</Paper>
      </Box>
    </Container>
  );
}

export default Settings;
