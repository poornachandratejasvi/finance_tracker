import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControlLabel, Checkbox, Alert, CircularProgress, Box, Typography,
  Chip, List, ListItem, ListItemText
} from '@mui/material';
import { Lock, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import { testPDFPassword, updatePDFPassword } from '../services/api';

function PDFPasswordDialog({ open, onClose, pdf, onSuccess }) {
  const [password, setPassword] = useState('');
  const [applyToBank, setApplyToBank] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');
  const [passwords, setPasswords] = useState(['']);

  const commonPasswords = [
    { label: 'Account Number (from filename)', value: pdf?.file_name?.match(/\d{10,}/)?.[0] || '' },
    { label: 'Last 4 digits', value: pdf?.file_name?.match(/\d{4}(?=\.pdf)/)?.[0] || '' },
    { label: 'Last 6 digits', value: pdf?.file_name?.match(/\d{6}(?=\.pdf)/)?.[0] || '' },
  ].filter(p => p.value);

  const handleTest = async () => {
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    setTesting(true);
    setError('');
    setTestResult(null);

    try {
      const result = await testPDFPassword(pdf.id, password);
      setTestResult(result);
      
      if (result.password_works) {
        // Auto-save if password works
        setTimeout(() => {
          handleSave();
        }, 1500);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to test password');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      const result = await updatePDFPassword(pdf.id, password, applyToBank);
      if (result.success) {
        onSuccess(result);
        onClose();
      } else {
        setError(result.message || 'Failed to save password');
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save password');
    }
  };

  const handleTryPassword = async (pwd) => {
    setPassword(pwd);
    setError('');
    setTestResult(null);
    
    // Auto-test
    setTesting(true);
    try {
      const result = await testPDFPassword(pdf.id, pwd);
      setTestResult(result);
      
      if (result.password_works) {
        setTimeout(() => {
          handleSave();
        }, 1500);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to test password');
    } finally {
      setTesting(false);
    }
  };

  const handleAddPassword = () => {
    setPasswords([...passwords, '']);
  };

  const handlePasswordChange = (index, value) => {
    const newPasswords = [...passwords];
    newPasswords[index] = value;
    setPasswords(newPasswords);
    if (index === 0) {
      setPassword(value);
    }
  };

  const handleTryAll = async () => {
    setTesting(true);
    setError('');
    
    for (const pwd of passwords.filter(p => p.trim())) {
      try {
        const result = await testPDFPassword(pdf.id, pwd);
        setTestResult(result);
        
        if (result.password_works) {
          setPassword(pwd);
          setTimeout(() => {
            handleSave();
          }, 1500);
          break;
        }
      } catch (err) {
        // Continue trying next password
      }
    }
    
    setTesting(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <Lock />
          <Typography variant="h6">Unlock Password-Protected PDF</Typography>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box mb={2}>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            File: <strong>{pdf?.file_name}</strong>
          </Typography>
          <Chip 
            label="Password Protected" 
            color="warning" 
            size="small" 
            icon={<Lock />} 
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {testResult && (
          <Alert 
            severity={testResult.password_works ? 'success' : 'error'} 
            sx={{ mb: 2 }}
            icon={testResult.password_works ? <CheckCircle /> : <ErrorIcon />}
          >
            {testResult.password_works ? (
              <>
                <strong>Password works!</strong>
                {testResult.can_parse && (
                  <> Found {testResult.transactions_found} transactions. Saving...</>
                )}
              </>
            ) : (
              'Invalid password. Please try another.'
            )}
          </Alert>
        )}

        {commonPasswords.length > 0 && (
          <Box mb={3}>
            <Typography variant="subtitle2" gutterBottom>
              Common password formats:
            </Typography>
            <List dense>
              {commonPasswords.map((item, idx) => (
                <ListItem 
                  key={idx} 
                  button 
                  onClick={() => handleTryPassword(item.value)}
                  disabled={testing}
                >
                  <ListItemText 
                    primary={item.label} 
                    secondary={item.value}
                  />
                  <Button size="small" variant="outlined">
                    Try
                  </Button>
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
          Enter password(s) to test:
        </Typography>

        {passwords.map((pwd, index) => (
          <TextField
            key={index}
            fullWidth
            label={`Password ${index + 1}`}
            type="text"
            value={pwd}
            onChange={(e) => handlePasswordChange(index, e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && password.trim()) {
                handleTest();
              }
            }}
            disabled={testing}
            placeholder="e.g., DOB (DDMMYYYY), Last 4 digits, Account number"
            sx={{ mb: 2 }}
            helperText={index === 0 ? "Press Enter to test, or add more passwords below" : ""}
          />
        ))}

        <Box display="flex" gap={1} mb={2}>
          <Button 
            size="small" 
            onClick={handleAddPassword}
            disabled={testing}
          >
            Add More Password
          </Button>
          {passwords.filter(p => p.trim()).length > 1 && (
            <Button 
              size="small" 
              variant="outlined"
              onClick={handleTryAll}
              disabled={testing}
            >
              Try All ({passwords.filter(p => p.trim()).length})
            </Button>
          )}
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              checked={applyToBank}
              onChange={(e) => setApplyToBank(e.target.checked)}
              disabled={testing}
            />
          }
          label="Apply this password to all PDFs from this bank"
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={testing}>
          Cancel
        </Button>
        <Button 
          onClick={handleTest} 
          variant="contained" 
          disabled={testing || !password.trim()}
          startIcon={testing ? <CircularProgress size={20} /> : null}
        >
          {testing ? 'Testing...' : 'Test Password'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default PDFPasswordDialog;
