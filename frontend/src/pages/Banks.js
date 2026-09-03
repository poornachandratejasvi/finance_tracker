import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Button,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Chip,
  IconButton,
  Paper,
  Switch,
  FormControlLabel,
  MenuItem,
  Menu,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import {
  Add,
  Sync,
  Delete,
  Upload,
  Email,
  AccountBalance,
  CreditCard,
  Edit,
  Refresh,
  MoreVert,
  Visibility,
  VisibilityOff,
  ArrowUpward,
  ArrowDownward,
} from '@mui/icons-material';
import { Avatar, Divider, Tooltip } from '@mui/material';
import InputAdornment from '@mui/material/InputAdornment';
import { useLocation } from 'react-router-dom';
import { getBanks, createBank, updateBank, deleteBank, startSync, emailLatestBankCSV, generateAllCSV, reprocessAllPDFs, getBankAccountPassword, getBankPasswordCandidates, updateBankPasswordCandidates, recomputeBalances, redetectCreditBalances, checkStaleCreditCards, reorderBanks, listCreditCardFees, createCreditCardFee, updateCreditCardFee, deleteCreditCardFee } from '../services/api';
import api from '../services/api';
import { formatCurrency, signedAccountBalance, hasAccountBalance, isEstimatedBalance, timeAgo } from '../utils/format';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

function Banks() {
  const location = useLocation();
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(2);
  const [refreshUnit, setRefreshUnit] = useState('hours');
  const [showArchived, setShowArchived] = useState(false);
  
  // Bank Dialog
  const [bankDialog, setBankDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editingBankId, setEditingBankId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [existingPasswordSet, setExistingPasswordSet] = useState(false);
  const [newBank, setNewBank] = useState({
    name: '',
    code: '',
    sender_email: '',
    sender_emails: '',
    sms_sender_pattern: '',
    account_number: '',
    account_password: '',
    bank_type: 'savings',
    csv_email: '',
    current_balance: '',
    pdf_filename_prefix: '',
    interest_rate: '',
    minimum_payment: '',
    balance_below_limit_enabled: false,
    balance_below_threshold: '',
    balance_above_limit_enabled: false,
    balance_above_threshold: '',
  });
  
  // Password candidates for the bank being edited
  const [passwordCandidates, setPasswordCandidates] = useState([]);
  const [newPasswordCandidate, setNewPasswordCandidate] = useState('');
  const [showCandidatePasswords, setShowCandidatePasswords] = useState(false);

  // Annual fee / fee-waiver config for a credit-type bank (separate table, see
  // credit_card_fees.py -- only relevant/loaded when editing an existing credit card).
  const [feeForm, setFeeForm] = useState({ annual_fee_amount: '', fee_anniversary_date: '', waiver_spend_threshold: '' });
  const [hadFeeConfig, setHadFeeConfig] = useState(false);
  
  // PDF Upload Dialog
  const [pdfDialog, setPdfDialog] = useState(false);
  const [selectedBank, setSelectedBank] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfPassword, setPdfPassword] = useState('');
  
  // Sync Dialog
  const [syncDialog, setSyncDialog] = useState(false);
  const [syncBank, setSyncBank] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [bankMenuAnchor, setBankMenuAnchor] = useState(null);
  const [bankMenuTarget, setBankMenuTarget] = useState(null);

  // View Password Dialog
  const [passwordViewDialog, setPasswordViewDialog] = useState(false);
  const [passwordViewData, setPasswordViewData] = useState({ bank_name: '', password: '', has_password: false });
  const [passwordViewLoading, setPasswordViewLoading] = useState(false);
  const [showViewedPassword, setShowViewedPassword] = useState(false);

  const handleViewPassword = async (bank) => {
    setPasswordViewLoading(true);
    setPasswordViewDialog(true);
    setShowViewedPassword(false);
    setPasswordViewData({ bank_name: bank.name, password: '', has_password: false });
    try {
      const data = await getBankAccountPassword(bank.id);
      setPasswordViewData({ bank_name: bank.name, password: data.password || '', has_password: data.has_password });
    } catch (err) {
      setPasswordViewData({ bank_name: bank.name, password: 'Error fetching password', has_password: false });
    } finally {
      setPasswordViewLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('gmail_connected')) {
      fetchData();
      setSuccess(`Gmail connected: ${params.get('gmail_connected')}`);
    }
    if (params.get('error')) {
      setError(`Gmail connection failed: ${params.get('error')}`);
    }
  }, [location.search]);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      const multiplier = refreshUnit === 'days' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
      interval = setInterval(async () => {
        await fetchData();
        try {
          await startSync({ gmail_account_id: null, sync_type: 'incremental' });
          console.log('Auto-sync triggered');
        } catch (error) {
          console.error('Auto-sync failed:', error);
        }
      }, refreshInterval * multiplier);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refreshUnit]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const banksRes = await getBanks();
      setBanks(banksRes || []);
    } catch (err) {
      setError('Failed to load data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBank = async () => {
    try {
      // Process sender_emails - convert comma-separated string to array
      const bankData = { ...newBank };
      if (bankData.sender_emails && bankData.sender_emails.trim()) {
        const emailsArray = bankData.sender_emails
          .split(',')
          .map(email => email.trim())
          .filter(email => email);
        bankData.sender_emails = JSON.stringify(emailsArray);
      } else {
        delete bankData.sender_emails;
      }

      if (bankData.current_balance !== '' && bankData.current_balance !== null && bankData.current_balance !== undefined) {
        const parsedBalance = parseFloat(bankData.current_balance);
        bankData.current_balance = Number.isNaN(parsedBalance) ? null : parsedBalance;
      } else {
        delete bankData.current_balance;
      }
      for (const field of ['interest_rate', 'minimum_payment', 'balance_below_threshold', 'balance_above_threshold']) {
        if (bankData[field] !== '' && bankData[field] !== null && bankData[field] !== undefined) {
          const parsed = parseFloat(bankData[field]);
          bankData[field] = Number.isNaN(parsed) ? null : parsed;
        } else {
          delete bankData[field];
        }
      }

      let savedBankId = editingBankId;
      if (editMode) {
        await updateBank(editingBankId, bankData);
        // Save password candidates if any are set
        if (passwordCandidates.length > 0) {
          try {
            await updateBankPasswordCandidates(editingBankId, { candidates: passwordCandidates });
          } catch (pwErr) {
            console.error('Failed to save password candidates:', pwErr);
          }
        }
        setSuccess('Bank updated successfully');
      } else {
        const created = await createBank(bankData);
        savedBankId = created?.id;
        try {
          await startSync({ gmail_account_id: null, sync_type: 'incremental' });
          setSuccess('Bank added successfully. Sync started to fetch PDFs.');
        } catch (syncError) {
          setSuccess('Bank added successfully. Sync could not start automatically.');
          console.error('Auto-sync failed:', syncError);
        }
      }

      // Annual fee / fee-waiver config -- separate table from Bank itself, only
      // relevant for credit cards. Create/update/delete based on what changed.
      if (bankData.bank_type === 'credit' && savedBankId) {
        const feeFilled = feeForm.annual_fee_amount !== '' && feeForm.fee_anniversary_date !== '';
        try {
          if (feeFilled) {
            const feePayload = {
              annual_fee_amount: parseFloat(feeForm.annual_fee_amount),
              fee_anniversary_date: feeForm.fee_anniversary_date,
              waiver_spend_threshold: feeForm.waiver_spend_threshold === '' ? null : parseFloat(feeForm.waiver_spend_threshold),
            };
            if (hadFeeConfig) await updateCreditCardFee(savedBankId, feePayload);
            else await createCreditCardFee({ bank_id: savedBankId, ...feePayload });
          } else if (hadFeeConfig) {
            await deleteCreditCardFee(savedBankId);
          }
        } catch (feeErr) {
          console.error('Failed to save annual fee config:', feeErr);
        }
      }

      setBankDialog(false);
      setEditMode(false);
      setEditingBankId(null);
      setNewBank({ name: '', code: '', sender_email: '', sender_emails: '', sms_sender_pattern: '', account_number: '', account_password: '', bank_type: 'savings', csv_email: '', current_balance: '', pdf_filename_prefix: '', interest_rate: '', minimum_payment: '', balance_below_limit_enabled: false, balance_below_threshold: '', balance_above_limit_enabled: false, balance_above_threshold: '' });
      setPasswordCandidates([]);
      setNewPasswordCandidate('');
      setFeeForm({ annual_fee_amount: '', fee_anniversary_date: '', waiver_spend_threshold: '' });
      setHadFeeConfig(false);
      fetchData();
    } catch (err) {
      setError(editMode ? 'Failed to update bank' : 'Failed to add bank');
    }
  };

  const handlePdfUpload = async () => {
    if (!pdfFile) {
      setError('Please select a PDF file');
      return;
    }
    
    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('file', pdfFile);
      
      const token = localStorage.getItem('access_token');
      let url = `${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/api/banks/${selectedBank.id}/upload-pdf`;
      
      if (pdfPassword) {
        url += `?password=${encodeURIComponent(pdfPassword)}`;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Upload failed');
      }
      
      const result = await response.json();
      setSuccess(`PDF processed successfully! Added ${result.transactions_count} transactions.`);
      setPdfDialog(false);
      setPdfFile(null);
      setPdfPassword('');
      fetchData(); // Refresh bank data
    } catch (err) {
      setError(err.message || 'Failed to upload PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncLoading(true);
      await startSync({ bank_id: syncBank.id });
      setSuccess(`Sync started for ${syncBank.name}`);
      setSyncDialog(false);
    } catch (err) {
      setError('Failed to start sync');
    } finally {
      setSyncLoading(false);
    }
  };

  const handleResyncPdfs = async (bankId, forceAll = false) => {
    try {
      setLoading(true);
      // When force_all, first trigger a fresh Gmail sync to fetch any new emails
      if (forceAll) {
        await startSync({ gmail_account_id: null, sync_type: 'incremental' });
      }
      const params = new URLSearchParams();
      if (bankId) params.append('bank_id', bankId);
      params.append('force_all', forceAll);

      const response = await api.post(`/api/sync/resync-pdfs?${params}`);
      const result = response.data;
      setSuccess(`Resynced ${result.pdfs_processed} PDFs, added ${result.transactions_added} transactions`);
      
      if (result.errors && result.errors.length > 0) {
        console.warn('Resync errors:', result.errors);
      }
      
      fetchData(); // Refresh data
    } catch (err) {
      setError(err.message || 'Failed to resync PDFs');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLatestCsv = async (bank) => {
    try {
      const toEmail = bank.csv_email || window.prompt('Send CSV to email:');
      if (!toEmail) {
        return;
      }
      setLoading(true);
      await emailLatestBankCSV(bank.id, { to_email: toEmail, delete_after: true });
      setSuccess(`CSV emailed to ${toEmail}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to send CSV email');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCsvs = async (bankId) => {
    try {
      setLoading(true);
      const result = await generateAllCSV(bankId);
      setSuccess(`Generated CSVs for ${result.processed} PDFs`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate CSVs');
    } finally {
      setLoading(false);
    }
  };

  const handleReprocessAllPdfs = async (bankId) => {
    try {
      setLoading(true);
      const result = await reprocessAllPDFs(bankId);
      setSuccess(`Reprocessed ${result.processed} PDFs`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to reprocess PDFs');
    } finally {
      setLoading(false);
    }
  };
  
  const handleResyncAll = () => {
    if (window.confirm('Resync ALL PDFs and reprocess transactions?')) {
      handleResyncPdfs(null, true);
    }
  };

  // Fix balances that went stale (e.g. statements uploaded out of chronological
  // order) — recomputes savings/other accounts from the latest statement's own
  // running balance.
  const handleRecomputeBalances = async () => {
    try {
      setLoading(true);
      const result = await recomputeBalances();
      setSuccess(
        result.updated
          ? `Recomputed balances — ${result.updated} account${result.updated === 1 ? '' : 's'} corrected.`
          : 'All balances already match their latest statement.'
      );
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to recompute balances');
    } finally {
      setLoading(false);
    }
  };

  // Re-derive credit-card Total Amount Due from the latest statement (regex, then
  // an AI-assisted fallback for layouts the regex can't parse).
  const handleRedetectCreditBalances = async () => {
    try {
      setLoading(true);
      const result = await redetectCreditBalances(true);
      const banksReport = result.banks || [];
      const fixed = banksReport.filter((b) => b.source === 'regex' || b.source === 'ai');
      const pending = banksReport.filter((b) => !['regex', 'ai', 'unchanged'].includes(b.source));
      let msg = fixed.length
        ? `Updated ${fixed.length} credit card${fixed.length === 1 ? '' : 's'}: ${fixed.map((b) => `${b.bank_name} → ₹${b.new_balance}`).join(', ')}.`
        : 'No credit card balances changed.';
      if (pending.length) {
        msg += ` Needs attention: ${pending.map((b) => `${b.bank_name} (${b.detail || b.source})`).join('; ')}`;
      }
      setSuccess(msg);
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to redetect credit card balances');
    } finally {
      setLoading(false);
    }
  };

  // Flag/zero credit cards with no transaction in 60+ days, right now instead of
  // waiting for the once-a-day scheduled check.
  const handleCheckStaleCreditCards = async () => {
    try {
      setLoading(true);
      const result = await checkStaleCreditCards();
      setSuccess(
        result.flagged
          ? `${result.flagged} card${result.flagged === 1 ? '' : 's'} had no activity in 60+ days — balance reset to 0.`
          : 'No dormant credit cards found — all balances reflect recent activity.'
      );
      fetchData();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to check for dormant credit cards');
    } finally {
      setLoading(false);
    }
  };

  const openPdfDialog = (bank) => {
    setSelectedBank(bank);
    setPdfDialog(true);
  };

  const openSyncDialog = (bank) => {
    setSyncBank(bank);
    setSyncDialog(true);
  };

  const handleDeleteBank = async (bankId) => {
    if (!window.confirm('Are you sure you want to delete this bank? This will not delete associated transactions.')) {
      return;
    }
    
    try {
      await deleteBank(bankId);
      setSuccess('Bank deleted successfully');
      fetchData();
    } catch (err) {
      setError('Failed to delete bank');
    }
  };

  const handleEditBank = (bank) => {
    setEditMode(true);
    setEditingBankId(bank.id);
    
    // Handle sender_emails - convert array to comma-separated string
    let senderEmailsStr = '';
    if (bank.sender_emails) {
      try {
        const emails = typeof bank.sender_emails === 'string' ? JSON.parse(bank.sender_emails) : bank.sender_emails;
        senderEmailsStr = Array.isArray(emails) ? emails.join(', ') : '';
      } catch (e) {
        console.error('Failed to parse sender_emails:', e);
      }
    }
    
    setNewBank({
      name: bank.name || '',
      code: bank.code || '',
      sender_email: bank.sender_email || '',
      sender_emails: senderEmailsStr,
      sms_sender_pattern: bank.sms_sender_pattern || '',
      account_number: bank.account_number || '',
      account_password: '',
      bank_type: bank.bank_type || 'savings',
      csv_email: bank.csv_email || '',
      current_balance: bank.current_balance ?? '',
      pdf_filename_prefix: bank.pdf_filename_prefix || '',
      interest_rate: bank.interest_rate ?? '',
      minimum_payment: bank.minimum_payment ?? '',
      balance_below_limit_enabled: !!bank.balance_below_limit_enabled,
      balance_below_threshold: bank.balance_below_threshold ?? '',
      balance_above_limit_enabled: !!bank.balance_above_limit_enabled,
      balance_above_threshold: bank.balance_above_threshold ?? '',
    });
    setExistingPasswordSet(bank.has_password === true);
    setShowPassword(false);
    // Load existing password candidates for this bank
    setPasswordCandidates([]);
    setNewPasswordCandidate('');
    getBankPasswordCandidates(bank.id).then((data) => {
      setPasswordCandidates(data?.candidates || []);
    }).catch(() => {});

    setFeeForm({ annual_fee_amount: '', fee_anniversary_date: '', waiver_spend_threshold: '' });
    setHadFeeConfig(false);
    if (bank.bank_type === 'credit') {
      listCreditCardFees().then((fees) => {
        const existing = (fees || []).find((f) => f.bank_id === bank.id);
        if (existing) {
          setFeeForm({
            annual_fee_amount: existing.annual_fee_amount ?? '',
            fee_anniversary_date: existing.fee_anniversary_date || '',
            waiver_spend_threshold: existing.waiver_spend_threshold ?? '',
          });
          setHadFeeConfig(true);
        }
      }).catch(() => {});
    }
    setBankDialog(true);
  };

  const handleOpenBankMenu = (event, bank) => {
    setBankMenuAnchor(event.currentTarget);
    setBankMenuTarget(bank);
  };

  const handleCloseBankMenu = () => {
    setBankMenuAnchor(null);
    setBankMenuTarget(null);
  };

  // ---- Account list helpers (Wallet-style list rendering) ----
  const bankAvatarColor = (bank) =>
    bank.color
      || (bank.bank_type === 'credit' ? '#b07aa1'
        : bank.bank_type === 'savings' ? '#4e79a7' : '#59a14f');

  const bankTypeLabel = (bank) =>
    bank.bank_type === 'credit' ? 'Credit account'
      : bank.bank_type === 'savings' ? 'Savings account'
      : bank.bank_type === 'investment' ? 'Feeds Investments (see Investments page)' : 'General';

  // Days since an ISO timestamp (naive-UTC safe). null when missing/invalid.
  const daysSince = (iso) => {
    if (!iso) return null;
    const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
    const d = new Date(hasTz ? iso : `${iso}Z`);
    if (Number.isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  };

  // Status dot + optional label for the "Last update" line. Defensive by design.
  const bankStatus = (bank) => {
    const ts = bank.last_synced_at || bank.last_transaction_at;
    const days = daysSince(ts);
    const isStatementBank = Boolean(bank.sender_email || bank.sender_emails);
    if (days == null) return { color: 'error.main', label: 'Never synced' };
    if (days > 150) return { color: 'error.main', label: 'Attention needed' };
    if (days > 60 || (!bank.has_password && isStatementBank)) {
      return { color: 'warning.main', label: 'Attention needed' };
    }
    if (days <= 7) return { color: 'success.main', label: '' };
    return { color: 'text.disabled', label: '' };
  };

  // Moves a bank up/down within its own section (main vs excluded-from-stats,
  // respecting the current archived filter) and persists via display_order --
  // this is also what drives the Dashboard account carousel's order.
  const moveBank = (bank, direction) => {
    const sameSection = (b) =>
      b.exclude_from_stats === bank.exclude_from_stats && (showArchived || !b.is_archived);
    setBanks((prev) => {
      const sectionIndices = prev.map((b, i) => (sameSection(b) ? i : -1)).filter((i) => i >= 0);
      const idx = prev.findIndex((b) => b.id === bank.id);
      const posInSection = sectionIndices.indexOf(idx);
      const targetPos = posInSection + direction;
      if (targetPos < 0 || targetPos >= sectionIndices.length) return prev;
      const targetIdx = sectionIndices[targetPos];
      const next = [...prev];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      reorderBanks(next.filter(sameSection).map((b) => b.id)).catch(() => fetchData());
      return next;
    });
  };

  const renderBankRow = (bank, dimmed = false, sectionBanks = []) => {
    const sectionIdx = sectionBanks.findIndex((b) => b.id === bank.id);
    const status = bankStatus(bank);
    const showBalance = hasAccountBalance(bank);
    const signed = signedAccountBalance(bank);
    return (
      <Paper
        key={bank.id}
        variant="outlined"
        sx={{
          p: 2,
          mb: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          borderRadius: 2,
          opacity: dimmed ? 0.6 : 1,
          transition: 'box-shadow .2s',
          '&:hover': { boxShadow: 3 },
        }}
      >
        <Avatar sx={{ bgcolor: bankAvatarColor(bank), width: 48, height: 48, fontWeight: 700 }}>
          {bank.name
            ? bank.name.trim().charAt(0).toUpperCase()
            : (bank.bank_type === 'credit' ? <CreditCard /> : <AccountBalance />)}
        </Avatar>

        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box display="flex" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap title={bank.name}>
              {bank.name}
            </Typography>
            {bank.is_archived && (
              <Chip label="Archived" size="small" variant="outlined" sx={{ height: 18 }} />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">{bankTypeLabel(bank)}</Typography>
          <Box display="flex" alignItems="center" gap={0.75} mt={0.25}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: status.color, flexShrink: 0 }} />
            <Typography variant="caption" color="text.secondary" noWrap>
              Last update: {timeAgo(bank.last_synced_at || bank.last_transaction_at)}
              {status.label ? ` · ${status.label}` : ''}
            </Typography>
          </Box>
        </Box>

        {showBalance && (
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography
              variant="h6"
              fontWeight={700}
              sx={{ lineHeight: 1.1, color: signed < 0 ? 'error.main' : 'text.primary' }}
            >
              {formatCurrency(signed, { currency: bank.currency_code })}
            </Typography>
            {bank.balance_source === 'manual' ? (
              <Tooltip title="Manually set — won't be overwritten by automatic statement redetection until you edit it again or click Redetect Credit Balances">
                <Typography variant="caption" color="text.secondary">manual</Typography>
              </Tooltip>
            ) : isEstimatedBalance(bank) && (
              <Typography variant="caption" color="text.secondary">est.</Typography>
            )}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Tooltip title="Move up">
              <span>
                <IconButton size="small" disabled={sectionIdx <= 0} onClick={() => moveBank(bank, -1)} sx={{ p: 0.25 }}>
                  <ArrowUpward sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move down">
              <span>
                <IconButton
                  size="small"
                  disabled={sectionIdx < 0 || sectionIdx >= sectionBanks.length - 1}
                  onClick={() => moveBank(bank, 1)}
                  sx={{ p: 0.25 }}
                >
                  <ArrowDownward sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <Tooltip title="Sync">
            <IconButton size="small" color="primary" onClick={() => openSyncDialog(bank)}>
              <Sync />
            </IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => handleEditBank(bank)}>
              <Edit />
            </IconButton>
          </Tooltip>
          <Tooltip title="More actions">
            <IconButton size="small" onClick={(event) => handleOpenBankMenu(event, bank)}>
              <MoreVert />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>
    );
  };

  if (loading) {
    return (
      <Container>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  const visibleBanks = banks.filter((b) => showArchived || !b.is_archived);
  const mainBanks = visibleBanks.filter((b) => !b.exclude_from_stats);
  const excludedBanks = visibleBanks.filter((b) => b.exclude_from_stats);

  return (
    <Container maxWidth={false} sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3, md: 4 } }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: -0.5 }}>Bank Management</Typography>
        <Box display="flex" alignItems="center" gap={2}>
          <FormControlLabel
            control={
              <Switch
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                color="primary"
              />
            }
            label="Auto Refresh"
          />
          {autoRefresh && (
            <TextField
              type="number"
              label="Interval"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Math.max(1, parseInt(e.target.value) || 1))}
              size="small"
              sx={{ width: 120 }}
            />
          )}
          {autoRefresh && (
            <FormControl size="small" sx={{ width: 120 }}>
              <InputLabel>Unit</InputLabel>
              <Select value={refreshUnit} onChange={(e) => setRefreshUnit(e.target.value)} label="Unit">
                <MenuItem value="hours">Hours</MenuItem>
                <MenuItem value="days">Days</MenuItem>
              </Select>
            </FormControl>
          )}
          <IconButton onClick={fetchData} color="primary">
            <Refresh />
          </IconButton>
          <Button
            variant="outlined"
            startIcon={<Sync />}
            onClick={handleResyncAll}
            sx={{ mr: 1 }}
            disabled={loading}
          >
            Resync All
          </Button>
          <Tooltip title="Fix balances that went stale (e.g. a statement uploaded out of order) by recomputing them from each account's latest statement">
            <span>
              <Button
                variant="outlined"
                onClick={handleRecomputeBalances}
                sx={{ mr: 1 }}
                disabled={loading}
              >
                Recompute Balances
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Re-derive credit card Total Amount Due from the latest statement (regex, then an AI-assisted fallback)">
            <span>
              <Button
                variant="outlined"
                onClick={handleRedetectCreditBalances}
                sx={{ mr: 1 }}
                disabled={loading}
              >
                Redetect Credit Balances
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Check now for credit cards with no transaction in 60+ days and reset their balance to 0 (normally runs automatically once a day)">
            <span>
              <Button
                variant="outlined"
                onClick={handleCheckStaleCreditCards}
                sx={{ mr: 1 }}
                disabled={loading}
              >
                Check Dormant Cards
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="outlined"
            onClick={() => handleReprocessAllPdfs(null)}
            sx={{ mr: 1 }}
            disabled={loading}
          >
            Reprocess PDFs
          </Button>
          <Button
            variant="outlined"
            onClick={() => handleGenerateCsvs(null)}
            sx={{ mr: 1 }}
            disabled={loading}
          >
            Generate CSVs
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setBankDialog(true)}
          >
            Add Bank
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Banks */}
      {
        <Box>
          {banks.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <AccountBalance sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="textSecondary" gutterBottom>
                No Banks Configured
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Add your first bank to start tracking transactions
              </Typography>
              <Button variant="contained" startIcon={<Add />} onClick={() => setBankDialog(true)}>
                Add Bank
              </Button>
            </Paper>
          ) : (
            <>
              <Box display="flex" justifyContent="flex-end" alignItems="center" mb={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                      color="primary"
                    />
                  }
                  label="Show Archived"
                />
              </Box>

              {mainBanks.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    No accounts to display
                  </Typography>
                </Paper>
              ) : (
                mainBanks.map((bank) => renderBankRow(bank, bank.is_archived, mainBanks))
              )}

              {excludedBanks.length > 0 && (
                <Box sx={{ mt: 4 }}>
                  <Typography
                    variant="subtitle2"
                    color="text.secondary"
                    sx={{ mb: 1.5, textTransform: 'uppercase', letterSpacing: 0.5 }}
                  >
                    Excluded from statistics
                  </Typography>
                  {excludedBanks.map((bank) => renderBankRow(bank, true, excludedBanks))}
                </Box>
              )}
            </>
          )}
        </Box>
      }

      <Menu
        anchorEl={bankMenuAnchor}
        open={Boolean(bankMenuAnchor)}
        onClose={handleCloseBankMenu}
      >
        <MenuItem onClick={() => { handleCloseBankMenu(); if (bankMenuTarget) openPdfDialog(bankMenuTarget); }}>
          <Upload fontSize="small" style={{ marginRight: 8 }} /> Upload PDF
        </MenuItem>
        <MenuItem onClick={() => { handleCloseBankMenu(); if (bankMenuTarget) openSyncDialog(bankMenuTarget); }}>
          <Sync fontSize="small" style={{ marginRight: 8 }} /> Sync
        </MenuItem>
        <MenuItem onClick={() => { handleCloseBankMenu(); if (bankMenuTarget) handleEmailLatestCsv(bankMenuTarget); }}>
          <Email fontSize="small" style={{ marginRight: 8 }} /> Email CSV
        </MenuItem>
        <MenuItem onClick={() => { handleCloseBankMenu(); if (bankMenuTarget) handleViewPassword(bankMenuTarget); }}>
          <Visibility fontSize="small" style={{ marginRight: 8 }} /> View Password
        </MenuItem>
        <MenuItem onClick={() => { handleCloseBankMenu(); if (bankMenuTarget) handleResyncPdfs(bankMenuTarget.id, false); }}>
          Resync New
        </MenuItem>
        <MenuItem onClick={() => {
          if (bankMenuTarget && window.confirm(`Resync ALL PDFs for ${bankMenuTarget.name}?`)) {
            handleCloseBankMenu();
            handleResyncPdfs(bankMenuTarget.id, true);
          } else {
            handleCloseBankMenu();
          }
        }}>
          Resync All
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => { const t = bankMenuTarget; handleCloseBankMenu(); if (t) handleDeleteBank(t.id); }}
          sx={{ color: 'error.main' }}
        >
          <Delete fontSize="small" style={{ marginRight: 8 }} /> Delete Bank
        </MenuItem>
      </Menu>

      {/* View Password Dialog */}
      <Dialog open={passwordViewDialog} onClose={() => setPasswordViewDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Bank Password — {passwordViewData.bank_name}</DialogTitle>
        <DialogContent>
          {passwordViewLoading ? (
            <Box display="flex" justifyContent="center" py={3}><CircularProgress /></Box>
          ) : (
            <Box sx={{ pt: 1 }}>
              {passwordViewData.has_password ? (
                <TextField
                  fullWidth
                  label="Stored Password"
                  value={showViewedPassword ? passwordViewData.password : '•'.repeat(passwordViewData.password.length || 8)}
                  InputProps={{
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowViewedPassword(!showViewedPassword)} edge="end">
                          {showViewedPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              ) : (
                <Alert severity="info">No password saved for this bank.</Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasswordViewDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Bank Dialog */}
      <Dialog open={bankDialog} onClose={() => { setBankDialog(false); setEditMode(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>{editMode ? 'Edit Bank' : 'Add New Bank'}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <TextField
              fullWidth
              label="Bank Name"
              value={newBank.name}
              onChange={(e) => setNewBank({ ...newBank, name: e.target.value })}
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Bank Code"
              value={newBank.code}
              onChange={(e) => setNewBank({ ...newBank, code: e.target.value })}
              helperText="Unique code to identify this bank (e.g., HDFC, ICICI, SBI)"
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Sender Email"
              type="email"
              value={newBank.sender_email}
              onChange={(e) => setNewBank({ ...newBank, sender_email: e.target.value })}
              helperText="Primary email address that sends statements (e.g., alerts@hdfcbank.net)"
              sx={{ mb: 2 }}
              required
            />
            <TextField
              fullWidth
              label="Additional Sender Emails (Optional)"
              value={newBank.sender_emails}
              onChange={(e) => setNewBank({ ...newBank, sender_emails: e.target.value })}
              helperText="Comma-separated email addresses (e.g., alerts@bank.com, statements@bank.com)"
              sx={{ mb: 2 }}
              placeholder="email1@bank.com, email2@bank.com"
            />
            <TextField
              fullWidth
              label="SMS Sender ID (Optional)"
              value={newBank.sms_sender_pattern}
              onChange={(e) => setNewBank({ ...newBank, sms_sender_pattern: e.target.value })}
              helperText="The alphanumeric ID your bank's alert texts come from (e.g., HDFCBK, AD-SBIINB) — not a phone number. Lets the Android app match an incoming SMS to this account."
              sx={{ mb: 2 }}
              placeholder="HDFCBK"
            />
            <TextField
              fullWidth
              label="CSV Email (Optional)"
              type="email"
              value={newBank.csv_email}
              onChange={(e) => setNewBank({ ...newBank, csv_email: e.target.value })}
              helperText="Default recipient for CSV exports"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              select
              label="Account Type"
              value={newBank.bank_type}
              onChange={(e) => setNewBank({ ...newBank, bank_type: e.target.value })}
              helperText="Type of bank account"
              sx={{ mb: 2 }}
            >
              <MenuItem value="savings">Savings Account</MenuItem>
              <MenuItem value="credit">Credit Card</MenuItem>
              <MenuItem value="loan">Loan (personal, car, home, etc.)</MenuItem>
              <MenuItem value="investment">Investment Statement (e.g. CDSL/NSDL CAS)</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </TextField>
            {newBank.bank_type === 'investment' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                This won't show up as a bank balance — it's just a way to let statement
                emails from this sender (e.g. eCAS@cdslstatement.com for CDSL's Consolidated
                Account Statement) get auto-downloaded, so their holdings can feed the
                Investments page instead. Add the PDF password below like any other bank
                once it's created.
              </Alert>
            )}
            <TextField
              fullWidth
              label="Account Number (Optional)"
              value={newBank.account_number}
              onChange={(e) => setNewBank({ ...newBank, account_number: e.target.value })}
              helperText="Your account number with this bank (for reference)"
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label={['credit', 'loan'].includes(newBank.bank_type) ? 'Current Outstanding Amount (Optional)' : 'Current Balance (Optional)'}
              type="number"
              value={newBank.current_balance}
              onChange={(e) => setNewBank({ ...newBank, current_balance: e.target.value })}
              helperText={
                newBank.bank_type === 'credit'
                  ? "What you currently owe on this card. Overrides the auto-detected Total Amount Due — set this any time the automatic statement detection is stale or wrong."
                  : newBank.bank_type === 'loan'
                    ? "What you currently owe on this loan."
                    : "Overrides the auto-detected balance"
              }
              sx={{ mb: 2 }}
            />
            {['credit', 'loan'].includes(newBank.bank_type) && (
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <TextField
                  label="Interest Rate % (Optional)"
                  type="number"
                  value={newBank.interest_rate || ''}
                  onChange={(e) => setNewBank({ ...newBank, interest_rate: e.target.value })}
                  helperText="Annual rate — used by the Debt Payoff calculator"
                  fullWidth
                />
                <TextField
                  label="Minimum Payment (Optional)"
                  type="number"
                  value={newBank.minimum_payment || ''}
                  onChange={(e) => setNewBank({ ...newBank, minimum_payment: e.target.value })}
                  helperText="Leave blank to estimate as 2% of balance"
                  fullWidth
                />
              </Box>
            )}
            {newBank.bank_type === 'credit' && (
              <Box sx={{ mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Annual Fee (Optional)</Typography>
                <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                  <TextField
                    label="Annual Fee Amount"
                    type="number"
                    value={feeForm.annual_fee_amount}
                    onChange={(e) => setFeeForm({ ...feeForm, annual_fee_amount: e.target.value })}
                    fullWidth
                  />
                  <TextField
                    label="Anniversary Date"
                    type="date"
                    value={feeForm.fee_anniversary_date}
                    onChange={(e) => setFeeForm({ ...feeForm, fee_anniversary_date: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    helperText="Last (or first) date the fee was/will be charged"
                    fullWidth
                  />
                </Box>
                <TextField
                  label="Waiver Spend Threshold (Optional)"
                  type="number"
                  value={feeForm.waiver_spend_threshold}
                  onChange={(e) => setFeeForm({ ...feeForm, waiver_spend_threshold: e.target.value })}
                  helperText="Spend this much since the last anniversary to get the fee waived"
                  fullWidth
                />
              </Box>
            )}
            <Box sx={{ display: 'flex', gap: 2, mb: newBank.balance_below_limit_enabled ? 1 : 2, alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!newBank.balance_below_limit_enabled}
                    onChange={(e) => setNewBank({ ...newBank, balance_below_limit_enabled: e.target.checked })}
                  />
                }
                label="Notify if balance goes below a limit"
              />
            </Box>
            {newBank.balance_below_limit_enabled && (
              <TextField
                fullWidth
                label="Minimum balance"
                type="number"
                value={newBank.balance_below_threshold}
                onChange={(e) => setNewBank({ ...newBank, balance_below_threshold: e.target.value })}
                sx={{ mb: 2 }}
              />
            )}
            <Box sx={{ display: 'flex', gap: 2, mb: newBank.balance_above_limit_enabled ? 1 : 2, alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!newBank.balance_above_limit_enabled}
                    onChange={(e) => setNewBank({ ...newBank, balance_above_limit_enabled: e.target.checked })}
                  />
                }
                label="Notify if balance goes above a limit"
              />
            </Box>
            {newBank.balance_above_limit_enabled && (
              <TextField
                fullWidth
                label="Maximum balance"
                type="number"
                value={newBank.balance_above_threshold}
                onChange={(e) => setNewBank({ ...newBank, balance_above_threshold: e.target.value })}
                sx={{ mb: 2 }}
              />
            )}
            <TextField
              fullWidth
              label={editMode && existingPasswordSet ? 'Change Password (leave blank to keep current)' : 'Account Password (Optional)'}
              type={showPassword ? 'text' : 'password'}
              value={newBank.account_password}
              onChange={(e) => setNewBank({ ...newBank, account_password: e.target.value })}
              helperText={
                editMode && existingPasswordSet
                  ? '✓ Password is set — enter new value to change, or leave blank to keep existing'
                  : 'PDF password used for auto-decryption during sync'
              }
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="PDF Filename Prefix (Optional)"
              value={newBank.pdf_filename_prefix}
              onChange={(e) => setNewBank({ ...newBank, pdf_filename_prefix: e.target.value })}
              helperText="Only import PDFs whose filename starts with this prefix (e.g. 'HDFC_CC' for credit card). Leave empty to import all PDFs from this sender."
              sx={{ mb: 2 }}
            />
            {editMode && (
              <Box sx={{ mt: 1, mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Password Candidates (tried automatically for encrypted PDFs)</Typography>
                  <IconButton size="small" onClick={() => setShowCandidatePasswords(!showCandidatePasswords)} title={showCandidatePasswords ? 'Hide passwords' : 'Show passwords'}>
                    {showCandidatePasswords ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  <TextField
                    size="small"
                    label="Add password"
                    type={showCandidatePasswords ? 'text' : 'password'}
                    value={newPasswordCandidate}
                    onChange={(e) => setNewPasswordCandidate(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && newPasswordCandidate.trim()) {
                        if (!passwordCandidates.includes(newPasswordCandidate.trim())) {
                          setPasswordCandidates([...passwordCandidates, newPasswordCandidate.trim()]);
                        }
                        setNewPasswordCandidate('');
                      }
                    }}
                    sx={{ flexGrow: 1 }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      const trimmed = newPasswordCandidate.trim();
                      if (trimmed && !passwordCandidates.includes(trimmed)) {
                        setPasswordCandidates([...passwordCandidates, trimmed]);
                      }
                      setNewPasswordCandidate('');
                    }}
                    disabled={!newPasswordCandidate.trim()}
                  >
                    Add
                  </Button>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {passwordCandidates.length === 0 ? (
                    <Typography variant="caption" color="textSecondary">No additional passwords saved</Typography>
                  ) : (
                    passwordCandidates.map((pwd, i) => (
                      <Chip
                        key={i}
                        label={showCandidatePasswords ? pwd : '••••••••'}
                        size="small"
                        onDelete={() => setPasswordCandidates(passwordCandidates.filter((_, idx) => idx !== i))}
                        variant="outlined"
                        color="primary"
                      />
                    ))
                  )}
                </Box>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setBankDialog(false); setEditMode(false); setShowPassword(false); setExistingPasswordSet(false); setPasswordCandidates([]); setNewPasswordCandidate(''); }}>Cancel</Button>
          <Button onClick={handleAddBank} variant="contained" disabled={!newBank.name || !newBank.code || !newBank.sender_email}>
            {editMode ? 'Update Bank' : 'Add Bank'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload PDF Dialog */}
      <Dialog open={pdfDialog} onClose={() => setPdfDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Bank Statement PDF</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body2" gutterBottom>
              Bank: <strong>{selectedBank?.name}</strong>
            </Typography>
            <Button
              variant="outlined"
              component="label"
              fullWidth
              sx={{ mb: 2, mt: 2 }}
            >
              {pdfFile ? pdfFile.name : 'Select PDF File'}
              <input
                type="file"
                hidden
                accept=".pdf"
                onChange={(e) => setPdfFile(e.target.files[0])}
              />
            </Button>
            <TextField
              fullWidth
              label="PDF Password (if protected)"
              type="password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              helperText="Leave empty if PDF is not password protected"
            />
            <Alert severity="info" sx={{ mt: 2 }}>
              The system will automatically extract transactions from the PDF and add them to your database.
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPdfDialog(false)}>Cancel</Button>
          <Button onClick={handlePdfUpload} variant="contained" disabled={!pdfFile}>
            Upload & Process
          </Button>
        </DialogActions>
      </Dialog>

      {/* Sync Dialog */}
      <Dialog open={syncDialog} onClose={() => setSyncDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Sync Bank Statements</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <Typography variant="body1" gutterBottom>
              Sync transactions from Gmail for <strong>{syncBank?.name}</strong>?
            </Typography>
            <Typography variant="body2" color="textSecondary" sx={{ mt: 2 }}>
              This will search for new bank statement emails and process any PDFs found.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSyncDialog(false)} disabled={syncLoading}>Cancel</Button>
          <Button
            onClick={handleSync}
            variant="contained"
            disabled={syncLoading}
            startIcon={syncLoading ? <CircularProgress size={20} /> : <Sync />}
          >
            {syncLoading ? 'Syncing...' : 'Start Sync'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default Banks;
