import React, { useState, useEffect, useRef } from 'react';
import {
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Alert,
  Link,
  CircularProgress,
  Tab,
  Tabs,
  Divider,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { login as loginApi, register as registerApi, getCurrentUser, getGoogleClientId, googleVerify } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// Load the Google Identity Services script once.
const loadGis = () =>
  new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.getElementById('gis-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.id = 'gis-script';
    s.onload = () => resolve();
    s.onerror = reject;
    document.body.appendChild(s);
  });

// FastAPI 422 responses put an ARRAY of {loc,msg,...} objects in `detail`. Rendering
// that array directly as a React child crashes the page, so always coerce to a string.
const formatApiError = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ');
  }
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') return detail.msg || JSON.stringify(detail);
  return fallback;
};

function Login() {
  const [tab, setTab] = useState(0);
  const [loginData, setLoginData] = useState({ username: '', password: '' });
  const [registerData, setRegisterData] = useState({
    username: '',
    email: '',
    password: '',
    full_name: '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(true);
  const googleBtnRef = useRef(null);
  const navigate = useNavigate();
  const { login: authLogin, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // Initialize Google Identity Services (Client-ID-only "Sign in with Google").
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { client_id, configured } = await getGoogleClientId();
        if (cancelled) return;
        if (!configured || !client_id) {
          setGoogleConfigured(false);
          return;
        }
        await loadGis();
        if (cancelled || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id,
          callback: async (resp) => {
            try {
              await googleVerify(resp.credential);
              const userData = await getCurrentUser();
              authLogin(userData);
              navigate('/dashboard');
            } catch (err) {
              setError(formatApiError(err, 'Google sign-in failed. Please try again.'));
            }
          },
        });
        setGoogleReady(true);
      } catch (_) {
        if (!cancelled) setGoogleConfigured(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render the official Google button once GIS is ready and the target div exists.
  useEffect(() => {
    if (googleReady && tab === 0 && googleBtnRef.current && window.google?.accounts?.id) {
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', width: 320, text: 'signin_with',
      });
    }
  }, [googleReady, tab]);

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
    setError('');
    setSuccess('');
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Validate inputs
    if (!loginData.username || !loginData.password) {
      setError('Please enter both username and password.');
      setLoading(false);
      return;
    }

    try {
      await loginApi(loginData.username, loginData.password);
      const userData = await getCurrentUser();
      authLogin(userData);
      navigate('/dashboard');
    } catch (err) {
      setError(formatApiError(err, 'Login failed. Please check your credentials.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    // Validate inputs
    if (!registerData.username || !registerData.email || !registerData.password) {
      setError('Please fill in all required fields.');
      setLoading(false);
      return;
    }

    if (registerData.password.length < 8) {
      setError('Password must be at least 8 characters long.');
      setLoading(false);
      return;
    }

    try {
      await registerApi(registerData);
      setSuccess('Registration successful! Please login with your credentials.');
      setTab(0);
      setRegisterData({ username: '', email: '', password: '', full_name: '' });
    } catch (err) {
      setError(formatApiError(err, 'Registration failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ p: 4, width: '100%' }}>
          <Typography component="h1" variant="h5" align="center" gutterBottom>
            Finance Tracker
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
            Multi-Bank Transaction Management System
          </Typography>

          <Tabs value={tab} onChange={handleTabChange} centered sx={{ mb: 3 }}>
            <Tab label="Login" />
            <Tab label="Register" />
          </Tabs>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          {tab === 0 && (
            <Box component="form" onSubmit={handleLoginSubmit}>
              <TextField
                margin="normal"
                required
                fullWidth
                id="username"
                label="Username"
                name="username"
                autoComplete="username"
                autoFocus
                value={loginData.username}
                onChange={(e) => setLoginData({ ...loginData, username: e.target.value })}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type="password"
                id="password"
                autoComplete="current-password"
                value={loginData.password}
                onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ mt: 3, mb: 2 }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'Sign In'}
              </Button>
              {googleConfigured && (
                <>
                  <Divider sx={{ my: 1 }}>or</Divider>
                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1, minHeight: 44 }}>
                    <div ref={googleBtnRef} />
                    {!googleReady && (
                      <Typography variant="caption" color="text.secondary">Loading Google sign-in…</Typography>
                    )}
                  </Box>
                </>
              )}
            </Box>
          )}

          {tab === 1 && (
            <Box component="form" onSubmit={handleRegisterSubmit}>
              <TextField
                margin="normal"
                required
                fullWidth
                id="reg-username"
                label="Username"
                name="username"
                autoComplete="username"
                autoFocus
                value={registerData.username}
                onChange={(e) => setRegisterData({ ...registerData, username: e.target.value })}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                id="email"
                label="Email Address"
                name="email"
                autoComplete="email"
                type="email"
                value={registerData.email}
                onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
              />
              <TextField
                margin="normal"
                fullWidth
                id="full_name"
                label="Full Name"
                name="full_name"
                autoComplete="name"
                value={registerData.full_name}
                onChange={(e) => setRegisterData({ ...registerData, full_name: e.target.value })}
              />
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label="Password"
                type="password"
                id="reg-password"
                autoComplete="new-password"
                value={registerData.password}
                onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                helperText="Minimum 8 characters"
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ mt: 3, mb: 2 }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'Register'}
              </Button>
            </Box>
          )}
        </Paper>

        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2 }}>
          Access API documentation at{' '}
          <Link href="http://localhost:8000/docs" target="_blank">
            /docs
          </Link>
        </Typography>
      </Box>
    </Container>
  );
}

export default Login;
