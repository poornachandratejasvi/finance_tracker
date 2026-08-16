import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Clear tokens and bounce to login
const logoutAndRedirect = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

// Serialize concurrent refreshes so we only hit /auth/refresh once
let isRefreshing = false;
let refreshQueue = [];
const processQueue = (error, token = null) => {
  refreshQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token)));
  refreshQueue = [];
};

// Handle token expiration: try a refresh, then retry the original request once
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      logoutAndRedirect();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;
    try {
      const { data } = await axios.post(`${API_URL}/api/auth/refresh`, {
        refresh_token: refreshToken,
      });
      localStorage.setItem('access_token', data.access_token);
      api.defaults.headers.common.Authorization = `Bearer ${data.access_token}`;
      processQueue(null, data.access_token);
      originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      logoutAndRedirect();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

// Authentication
export const login = async (username, password) => {
  // Use URLSearchParams so the body genuinely IS application/x-www-form-urlencoded
  // (FormData would send multipart/form-data despite the header, which was misleading).
  const params = new URLSearchParams();
  params.append('username', username);
  params.append('password', password);

  const response = await axios.post(`${API_URL}/api/auth/login`, params);

  if (response.data.access_token) {
    localStorage.setItem('access_token', response.data.access_token);
    localStorage.setItem('refresh_token', response.data.refresh_token);
  }
  
  return response.data;
};

export const register = async (userData) => {
  const response = await axios.post(`${API_URL}/api/auth/register`, userData);
  return response.data;
};

export const getGoogleLoginUrl = async () => {
  // Unauthenticated: use bare axios so the 401 interceptor never fires.
  const response = await axios.get(`${API_URL}/api/oauth/google/login-url`);
  return response.data;
};

// Google Identity Services (GIS) — Client-ID-only "Sign in with Google".
export const getGoogleClientId = async () => {
  const response = await axios.get(`${API_URL}/api/auth/google/client-id`);
  return response.data; // { client_id, configured }
};

export const googleVerify = async (credential) => {
  // Verify the Google ID token server-side and receive app tokens.
  const response = await axios.post(`${API_URL}/api/auth/google/verify`, { credential });
  if (response.data.access_token) {
    localStorage.setItem('access_token', response.data.access_token);
    localStorage.setItem('refresh_token', response.data.refresh_token);
  }
  return response.data;
};


export const getCurrentUser = async () => {
  const response = await api.get('/api/users/me');
  return response.data;
};

export const logout = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};

// Transactions
export const getTransactions = async (params = {}) => {
  const response = await api.get('/api/transactions/', { params });
  return response.data;
};

export const createTransaction = async (data) => {
  const response = await api.post('/api/transactions/', data);
  return response.data;
};

export const updateTransaction = async (id, data) => {
  const response = await api.put(`/api/transactions/${id}`, data);
  return response.data;
};

export const deleteTransaction = async (id) => {
  await api.delete(`/api/transactions/${id}`);
};

export const bulkDeleteTransactions = async (ids) =>
  (await api.post('/api/transactions/bulk-delete', { transaction_ids: ids })).data;

export const bulkConfirmTransactions = async (ids) =>
  (await api.post('/api/transactions/bulk-confirm', { transaction_ids: ids })).data;

export const getDuplicates = async () => {
  const response = await api.get('/api/transactions/duplicates');
  return response.data;
};

// Banks
export const getBanks = async () => {
  const response = await api.get('/api/banks/');
  return response.data;
};

export const createBank = async (data) => {
  const response = await api.post('/api/banks/', data);
  return response.data;
};

export const updateBank = async (id, data) => {
  const response = await api.put(`/api/banks/${id}`, data);
  return response.data;
};

export const getBankPasswordCandidates = async (id) => {
  const response = await api.get(`/api/banks/${id}/password-candidates`);
  return response.data;
};

export const updateBankPasswordCandidates = async (id, data) => {
  const response = await api.put(`/api/banks/${id}/password-candidates`, data);
  return response.data;
};

export const listBankPasswordCandidates = async () => {
  const response = await api.get('/api/banks/password-candidates');
  return response.data;
};

export const deleteBank = async (id) => {
  const response = await api.delete(`/api/banks/${id}`);
  return response.data;
};

export const getBankAccountPassword = async (id) => {
  const response = await api.get(`/api/banks/${id}/account-password`);
  return response.data;
};

export const emailCSVForBank = async (bankId, payload) => {
  const response = await api.post(`/api/csv/banks/${bankId}/email-latest`, payload);
  return response.data;
};

export const generateCSVForBank = async (bankId) => {
  const response = await api.post(`/api/csv/pdfs/generate-all?bank_id=${bankId}`);
  return response.data;
};

export const getGmailAccounts = async () => {
  const response = await api.get('/api/gmail-accounts/');
  return response.data;
};

export const getGmailAccountsStatus = async () => {
  const response = await api.get('/api/gmail-accounts/status');
  return response.data;
};

export const getGmailAuthUrl = async () => {
  const response = await api.get('/api/oauth/gmail/auth-url');
  return response.data;
};

export const checkGmailAccountNow = async (id) => (await api.post(`/api/gmail-accounts/${id}/check-now`)).data;
export const testGmailNotification = async (id) => (await api.post(`/api/gmail-accounts/${id}/test-notification`)).data;
export const syncAlertsNow = async () => (await api.post('/api/gmail-accounts/sync-alerts-now')).data;
export const disconnectGmailAccount = async (id) => { await api.delete(`/api/gmail-accounts/${id}`); };
export const getGoogleCredentialsStatus = async () => (await api.get('/api/gmail-accounts/google-credentials/status')).data;
export const uploadGoogleCredentials = async (file) => {
  const form = new FormData();
  form.append('file', file);
  return (await api.post('/api/gmail-accounts/google-credentials', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
};

// Labels
export const getLabels = async () => {
  const response = await api.get('/api/labels/');
  return response.data;
};

export const createLabel = async (data) => {
  const response = await api.post('/api/labels/', data);
  return response.data;
};

export const updateLabel = async (id, data) => {
  const response = await api.put(`/api/labels/${id}`, data);
  return response.data;
};

export const deleteLabel = async (id) => {
  await api.delete(`/api/labels/${id}`);
};

export const addLabelToTransaction = async (data) => {
  const response = await api.post('/api/labels/transaction-labels', data);
  return response.data;
};

export const bulkLabelTransactions = async (data) => {
  const response = await api.post('/api/labels/bulk-label', data);
  return response.data;
};

export const createAutoLabelRule = async (labelId, data) => {
  const response = await api.post(`/api/labels/${labelId}/rules`, data);
  return response.data;
};

// Sync
export const startSync = async (data) => {
  const response = await api.post('/api/sync/', data);
  return response.data;
};

export const getSyncStatus = async (id) => {
  const response = await api.get(`/api/sync/status/${id}`);
  return response.data;
};

// Logs
export const getBackendLogs = async (lines = 100) => {
  const response = await api.get(`/api/logs/backend?lines=${lines}`);
  return response.data;
};

export const getSystemInfo = async () => {
  const response = await api.get('/api/logs/system');
  return response.data;
};

export const getContainerLogs = async (lines = 100) => {
  const response = await api.get(`/api/logs/containers?lines=${lines}`);
  return response.data;
};

// PDFs
export const getPDFs = async (params = {}) => {
  const response = await api.get('/api/pdfs/', { params });
  return response.data;
};

export const getPDFStats = async () => {
  const response = await api.get('/api/pdfs/stats');
  return response.data;
};

export const downloadPDF = async (pdfId) => {
  const response = await api.get(`/api/pdfs/${pdfId}/download`, {
    responseType: 'blob'
  });
  return response.data;
};

export const reprocessPDF = async (pdfId) => {
  const response = await api.post(`/api/pdfs/${pdfId}/reprocess`);
  return response.data;
};

export const reprocessAllPDFs = async (bankId) => {
  const params = bankId ? `?bank_id=${bankId}` : '';
  const response = await api.post(`/api/pdfs/reprocess-all${params}`);
  return response.data;
};

// Recompute every account's balance from the latest statement's running balance
// (fixes staleness when statements were uploaded out of chronological order).
export const recomputeBalances = async () => (await api.post('/api/banks/recompute-balances')).data;

// Re-derive credit-card Total Amount Due from the latest statement (regex, then an
// AI-assisted fallback for statement layouts the regex can't parse). Per-bank report.
export const redetectCreditBalances = async (useAi = true) =>
  (await api.post('/api/banks/redetect-credit-balances', null, { params: { use_ai: useAi } })).data;

// Manually run the 60+ day no-activity credit card check right now, instead of
// waiting for the once-a-day scheduled run.
export const checkStaleCreditCards = async () => (await api.post('/api/banks/check-stale-credit-cards')).data;

export const getPDFFields = async (pdfId) => {
  const response = await api.get(`/api/pdfs/${pdfId}/fields`);
  return response.data;
};

export const remapPDFBank = async (pdfIds, bankId) => {
  const response = await api.post('/api/pdfs/remap-bank', {
    pdf_ids: pdfIds,
    bank_id: bankId,
  });
  return response.data;
};

export const deletePDFsBySender = async (fromEmail, bankId = null, deleteTransactions = true) => {
  const response = await api.post('/api/pdfs/delete-by-sender', {
    from_email: fromEmail,
    bank_id: bankId,
    delete_transactions: deleteTransactions,
  });
  return response.data;
};

// CSV Exports
export const generateCSV = async (pdfId) => {
  const response = await api.post(`/api/csv/pdfs/${pdfId}/generate`);
  return response.data;
};

export const downloadCSV = async (pdfId) => {
  const response = await api.get(`/api/csv/pdfs/${pdfId}/download`, {
    responseType: 'blob'
  });
  return response.data;
};

export const emailCSV = async (pdfId, payload) => {
  const response = await api.post(`/api/csv/pdfs/${pdfId}/email`, payload);
  return response.data;
};

export const emailLatestBankCSV = async (bankId, payload) => {
  const response = await api.post(`/api/csv/banks/${bankId}/email-latest`, payload);
  return response.data;
};

export const generateAllCSV = async (bankId) => {
  const params = bankId ? `?bank_id=${bankId}` : '';
  const response = await api.post(`/api/csv/pdfs/generate-all${params}`);
  return response.data;
};

export const generateBulkCSV = async (pdfIds) => {
  const response = await api.post('/api/csv/pdfs/bulk-generate', { pdf_ids: pdfIds });
  return response.data;
};

export const cleanupCsvExports = async (payload) => {
  const response = await api.post('/api/csv/cleanup', payload);
  return response.data;
};

export const cleanupPdfs = async (payload) => {
  const response = await api.post('/api/pdfs/cleanup', payload);
  return response.data;
};

export const testPDFPassword = async (pdfId, password) => {
  const response = await api.post(`/api/sync/test-pdf-password?pdf_id=${pdfId}&password=${encodeURIComponent(password)}`);
  return response.data;
};

export const updatePDFPassword = async (pdfId, password, applyToBank = false) => {
  const response = await api.post(`/api/sync/update-pdf-password?pdf_id=${pdfId}&password=${encodeURIComponent(password)}&apply_to_bank=${applyToBank}`);
  return response.data;
};

export const getRecentSyncs = async (limit = 10) => {
  const response = await api.get(`/api/sync/recent?limit=${limit}`);
  return response.data;
};

export const getWorkerConfig = async () => {
  const response = await api.get('/api/sync/worker-config');
  return response.data;
};

export const getBankStatementDashboard = async () => {
  const response = await api.get('/api/banks/statement-dashboard');
  return response.data;
};

export const getScheduleSettings = async () => {
  const response = await api.get('/api/settings/schedule');
  return response.data;
};

export const saveScheduleSettings = async (data) => {
  const response = await api.post('/api/settings/schedule', data);
  return response.data;
};

export const getBudgetSettings = async () => {
  const response = await api.get('/api/settings/budgets');
  return response.data;
};

export const saveBudgetSettings = async (data) => {
  const response = await api.post('/api/settings/budgets', data);
  return response.data;
};

export const getBudgetStatus = async () => {
  const response = await api.get('/api/settings/budgets/status');
  return response.data;
};

// Savings goals
export const listGoals = async () => {
  const response = await api.get('/api/goals/');
  return response.data;
};
export const createGoal = async (data) => {
  const response = await api.post('/api/goals/', data);
  return response.data;
};
export const updateGoal = async (id, data) => {
  const response = await api.put(`/api/goals/${id}`, data);
  return response.data;
};
export const deleteGoal = async (id) => {
  await api.delete(`/api/goals/${id}`);
};

// Imports (CSV/Excel -> transactions, via column mapping)
export const previewImportFile = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post('/api/imports/preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};
export const commitImport = async (payload) => {
  const response = await api.post('/api/imports/commit', payload);
  return response.data;
};

// Reward points
export const getRewardPoints = async (bankId) => {
  const response = await api.get('/api/reward-points/', { params: bankId ? { bank_id: bankId } : {} });
  return response.data;
};
export const createRewardEntry = async (data) => {
  const response = await api.post('/api/reward-points/', data);
  return response.data;
};
export const deleteRewardEntry = async (id) => {
  await api.delete(`/api/reward-points/${id}`);
};
export const checkExpiringRewardPoints = async () => {
  const response = await api.post('/api/reward-points/check-expiring');
  return response.data;
};
export const getRewardPointsMonthly = async (bankId, months = 12) => {
  const params = { months };
  if (bankId) params.bank_id = bankId;
  const response = await api.get('/api/reward-points/monthly', { params });
  return response.data;
};

// Family dashboard (admin-only)
export const getFamilyDashboard = async () => {
  const response = await api.get('/api/family-dashboard/');
  return response.data;
};

// Net worth history
export const getNetWorth = async (days = 180) => {
  const response = await api.get(`/api/dashboard/net-worth?days=${days}`);
  return response.data;
};

// Insights / recurring
export const getInsights = async () => {
  const response = await api.get('/api/transactions/insights');
  return response.data;
};
export const getRecurring = async () => {
  const response = await api.get('/api/transactions/recurring');
  return response.data;
};

export const getSystemSettings = async () => {
  const response = await api.get('/api/settings/system-info');
  return response.data;
};

// Live sync status (for the global status bar)
export const getActiveSyncs = async () => {
  const response = await api.get('/api/sync/active');
  return response.data;
};

export const clearStuckSyncs = async () => {
  const response = await api.post('/api/sync/clear-stuck');
  return response.data;
};

// API tokens (for iOS Shortcut / webhook ingestion)
export const listApiTokens = async () => {
  const response = await api.get('/api/api-tokens/');
  return response.data;
};

export const createApiToken = async (name) => {
  const response = await api.post('/api/api-tokens/', { name });
  return response.data;
};

export const revokeApiToken = async (id) => {
  await api.delete(`/api/api-tokens/${id}`);
};

// Generate + download a ready-to-install iOS Shortcut (.shortcut) with the server URL and
// a fresh API token baked in. Authenticated POST returning a binary blob; we trigger a save.
export const downloadShortcut = async (opts = {}) => {
  const res = await api.post('/api/ingest/shortcut', opts, { responseType: 'blob' });
  // Pull the filename the server suggested, else fall back.
  let filename = 'Add Transaction.shortcut';
  const cd = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'];
  if (cd) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (m && m[1]) filename = decodeURIComponent(m[1]);
  }
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  return filename;
};

// Same idea as downloadShortcut, but for the SMS-forwarding Automation shortcut
// (posts a message's raw text to /api/ingest/sms instead of asking for amount/description).
export const downloadSmsShortcut = async (opts = {}) => {
  const res = await api.post('/api/ingest/sms-shortcut', opts, { responseType: 'blob' });
  let filename = 'SMS Auto-Detect.shortcut';
  const cd = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'];
  if (cd) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (m && m[1]) filename = decodeURIComponent(m[1]);
  }
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  return filename;
};

// Ingest mapping (source JSON key -> transaction field)
export const getIngestTargetFields = async () => {
  const response = await api.get('/api/ingest/target-fields');
  return response.data;
};

export const getIngestMapping = async () => {
  const response = await api.get('/api/ingest/mapping');
  return response.data;
};

export const saveIngestMapping = async (data) => {
  const response = await api.post('/api/ingest/mapping', data);
  return response.data;
};

// Categories (name -> icon/color/kind metadata)
export const getCategories = async () => {
  const response = await api.get('/api/categories/');
  return response.data;
};
export const createCategory = async (data) => {
  const response = await api.post('/api/categories/', data);
  return response.data;
};
export const updateCategory = async (id, data) => {
  const response = await api.put(`/api/categories/${id}`, data);
  return response.data;
};
export const deleteCategory = async (id) => {
  await api.delete(`/api/categories/${id}`);
};

// Category auto-categorization rules (keyword -> category)
export const getCategoryRules = async () => (await api.get('/api/categories/rules')).data;
export const createCategoryRule = async (data) => (await api.post('/api/categories/rules', data)).data;
export const updateCategoryRule = async (id, data) => (await api.put(`/api/categories/rules/${id}`, data)).data;
export const deleteCategoryRule = async (id) => { await api.delete(`/api/categories/rules/${id}`); };
export const recategorizeTransactions = async (onlyUncategorized = true) =>
  (await api.post('/api/categories/recategorize', { only_uncategorized: onlyUncategorized })).data;

// Wallet-style Automatic Rules (name + keywords + record type -> category + labels)
export const getAutoRules = async () => (await api.get('/api/rules/')).data;
export const createAutoRule = async (data) => (await api.post('/api/rules/', data)).data;
export const updateAutoRule = async (id, data) => (await api.put(`/api/rules/${id}`, data)).data;
export const deleteAutoRule = async (id) => { await api.delete(`/api/rules/${id}`); };
export const applyAutoRules = async (onlyUncategorized = false) =>
  (await api.post('/api/rules/apply', { only_uncategorized: onlyUncategorized })).data;
// Preview existing records matching a rule's keywords + record type
export const previewRuleMatches = async ({ keywords, record_type, limit = 200 }) =>
  (await api.post('/api/rules/preview', { keywords, record_type, limit })).data;
// Apply a rule's category + labels to specific record ids
export const applyRuleToSelected = async ({ transaction_ids, category, label_ids }) =>
  (await api.post('/api/rules/apply-selected', { transaction_ids, category, label_ids })).data;

// Notification Rules (multi-channel keyword-match / missing-transaction alerting)
export const getNotificationRules = async () => (await api.get('/api/notification-rules/')).data;
export const createNotificationRule = async (data) => (await api.post('/api/notification-rules/', data)).data;
export const updateNotificationRule = async (id, data) => (await api.put(`/api/notification-rules/${id}`, data)).data;
export const deleteNotificationRule = async (id) => { await api.delete(`/api/notification-rules/${id}`); };
export const testNotificationRule = async (id) => (await api.post(`/api/notification-rules/${id}/test`)).data;
export const checkAbsenceNotificationsNow = async () => (await api.post('/api/notification-rules/check-absence-now')).data;
// Apply a rule's category + labels to EVERY matching record (not just the previewed
// page) — the server re-runs the match query, so this scales beyond the preview cap.
export const applyRuleToAllMatching = async ({ keywords, record_type, category, label_ids }) =>
  (await api.post('/api/rules/apply-all-matching', { keywords, record_type, category, label_ids })).data;

// Discord webhook notifications (fired when a real-time transaction matches a rule
// with notify_discord=true; not fired by bulk "apply to existing" actions)
export const getDiscordConfig = async () => (await api.get('/api/notifications/discord')).data;
export const updateDiscordWebhook = async (webhookUrl) =>
  (await api.put('/api/notifications/discord', { webhook_url: webhookUrl })).data;
export const testDiscordWebhook = async () => (await api.post('/api/notifications/discord/test')).data;

// Transaction watchers (named recurring-transaction expectations that get a fresh
// Google Task each month and auto-complete it when a matching transaction appears)
export const getWatchers = async () => (await api.get('/api/watchers/')).data;
export const createWatcher = async (data) => (await api.post('/api/watchers/', data)).data;
export const updateWatcher = async (id, data) => (await api.put(`/api/watchers/${id}`, data)).data;
export const deleteWatcher = async (id) => (await api.delete(`/api/watchers/${id}`)).data;
export const runWatchersNow = async () => (await api.post('/api/watchers/run-now')).data;
export const detectRecurringTransactions = async () => (await api.get('/api/watchers/detect-recurring')).data;

// AI (Claude / Gemini)
export const getAIConfig = async () => (await api.get('/api/ai/config')).data;
export const updateAIConfig = async (data) => (await api.put('/api/ai/config', data)).data;
export const testAI = async (data) => (await api.post('/api/ai/test', data)).data;
export const aiCategorize = async (onlyUncategorized = true, limit = 200) =>
  (await api.post('/api/ai/categorize', { only_uncategorized: onlyUncategorized, limit })).data;
export const getPredictions = async (daysAhead = 45) =>
  (await api.get('/api/ai/predictions', { params: { days_ahead: daysAhead } })).data;
// insights/summary are cached by default; pass generate=true to call the provider & refresh cache
export const getAIInsights = async (generate = false) =>
  (await api.get('/api/ai/insights', { params: { generate } })).data;
export const getAIModels = async (provider, { api_key, base_url } = {}) =>
  (await api.get('/api/ai/models', { params: { provider, api_key, base_url } })).data;
export const aiQuery = async (question) => (await api.post('/api/ai/query', { question })).data;
// anomalies are statistical (free) by default; pass useAi=true to refine with the provider
export const getAnomalies = async (useAi = false) =>
  (await api.get('/api/ai/anomalies', { params: { use_ai: useAi } })).data;
export const getAISummary = async (generate = false) =>
  (await api.get('/api/ai/summary', { params: { generate } })).data;
// per-model token usage
export const getAIUsage = async () => (await api.get('/api/ai/usage')).data;
export const resetAIUsage = async () => (await api.post('/api/ai/usage/reset')).data;

// Currencies (per-user, with rate_to_base for conversion)
export const getCurrencies = async () => {
  const response = await api.get('/api/currencies/');
  return response.data;
};
export const createCurrency = async (data) => {
  const response = await api.post('/api/currencies/', data);
  return response.data;
};
export const updateCurrency = async (id, data) => {
  const response = await api.put(`/api/currencies/${id}`, data);
  return response.data;
};
export const deleteCurrency = async (id) => {
  await api.delete(`/api/currencies/${id}`);
};

// Analytics (Wallet-style reports)
export const getAnalyticsComparison = async (params = {}) => {
  const response = await api.get('/api/analytics/comparison', { params });
  return response.data;
};
export const getAnalyticsCashflow = async (params = {}) => {
  const response = await api.get('/api/analytics/cashflow', { params });
  return response.data;
};
export const getAnalyticsBalanceTrend = async (params = {}) => {
  const response = await api.get('/api/analytics/balance-trend', { params });
  return response.data;
};

// Saved filters ("My filter")
export const getSavedFilters = async (scope) => {
  const response = await api.get('/api/filters/', { params: scope ? { scope } : {} });
  return response.data;
};
export const createSavedFilter = async (data) => {
  const response = await api.post('/api/filters/', data);
  return response.data;
};
export const deleteSavedFilter = async (id) => {
  await api.delete(`/api/filters/${id}`);
};

// Templates
export const getTemplates = async () => (await api.get('/api/templates/')).data;
export const createTemplate = async (data) => (await api.post('/api/templates/', data)).data;
export const updateTemplate = async (id, data) => (await api.put(`/api/templates/${id}`, data)).data;
export const deleteTemplate = async (id) => { await api.delete(`/api/templates/${id}`); };

// Current-user profile / password / preferences
export const updateMe = async (data) => (await api.put('/api/users/me', data)).data;
export const changePassword = async (data) => (await api.post('/api/users/me/change-password', data)).data;
export const getPreferences = async () => (await api.get('/api/users/me/preferences')).data;
export const updatePreferences = async (data) => (await api.put('/api/users/me/preferences', data)).data;

// Admin user management
export const getUsers = async () => (await api.get('/api/users/')).data;
export const createUser = async (data) => (await api.post('/api/users/', data)).data;
export const updateUser = async (id, data) => (await api.put(`/api/users/${id}`, data)).data;
export const deleteUser = async (id) => { await api.delete(`/api/users/${id}`); };
export const shareHousehold = async (userId, otherUserId) =>
  (await api.post(`/api/users/${userId}/share-household-with/${otherUserId}`)).data;
export const leaveHousehold = async (userId) =>
  (await api.post(`/api/users/${userId}/leave-household`)).data;

// Backup (Google Drive)
export const getBackupStatus = async () => (await api.get('/api/backup/status')).data;
export const runBackup = async (data = {}) => (await api.post('/api/backup/run', data)).data;
export const getBackupHistory = async () => (await api.get('/api/backup/history')).data;
export const getBackupConfig = async () => (await api.get('/api/backup/config')).data;
export const saveBackupConfig = async (data) => (await api.put('/api/backup/config', data)).data;
export const getDriveAuthUrl = async () => (await api.get('/api/backup/google/auth-url')).data;
export const disconnectDrive = async () => (await api.post('/api/backup/google/disconnect')).data;
export const downloadBackupUrl = (filename) => `${API_URL}/api/backup/download/${encodeURIComponent(filename)}`;
// Authenticated download: the endpoint needs the bearer token, so a plain <a href>
// would 401. Fetch as a blob through the api instance and trigger a client-side save.
export const downloadBackup = async (filename) => {
  const res = await api.get(`/api/backup/download/${encodeURIComponent(filename)}`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};
// Restore — DESTRUCTIVE, replaces the entire app database. Admin-only on the server.
export const restoreBackup = async (filename) => (await api.post('/api/backup/restore', { filename })).data;
export const restoreBackupUpload = async (file) => {
  const form = new FormData();
  form.append('file', file);
  return (await api.post('/api/backup/restore-upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
};

export default api;
