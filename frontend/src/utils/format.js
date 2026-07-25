// Shared formatting helpers so every page renders money/dates consistently.

export const CURRENCY_SYMBOLS = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  AUD: 'A$', CAD: 'C$', SGD: 'S$', CHF: 'CHF ', AED: 'AED ', CNY: '¥',
};

export const currencySymbol = (code) => {
  if (!code) return '₹';
  return CURRENCY_SYMBOLS[code] || `${code} `;
};

// Format money. Accepts { compact, decimals, currency (ISO code), symbol }.
// Negatives render as "-₹1,234.00" (sign before the symbol) to match the design.
export const formatCurrency = (value, { compact = false, decimals = 2, currency, symbol } = {}) => {
  const sym = symbol || currencySymbol(currency || 'INR');
  const n = Number(value || 0);
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (compact) {
    if (a >= 1e7) return `${sign}${sym}${(a / 1e7).toFixed(2)}Cr`;
    if (a >= 1e5) return `${sign}${sym}${(a / 1e5).toFixed(2)}L`;
    if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}K`;
    return `${sign}${sym}${a.toFixed(0)}`;
  }
  return `${sign}${sym}${a.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

// Whether an account has any balance to display (stored or transaction-derived).
export const hasAccountBalance = (bank) =>
  bank?.current_balance != null || bank?.computed_balance != null;

// Signed balance for display. A credit card's owed amount ALWAYS shows as negative,
// regardless of source:
// - Stored current_balance is a positive "amount owed" for credit cards, so we negate it.
// - computed_balance (the fallback estimate, credits-minus-debits over ALL transactions)
//   is NOT a reliable signed "owed" indicator — it can land positive even for a card
//   that owes money (e.g. lifetime refunds/payments outweighing purchases), so it must
//   be sign-forced the same way, not trusted as-is.
export const signedAccountBalance = (bank) => {
  const isCredit = (bank?.bank_type || '').toLowerCase() === 'credit';
  if (bank?.current_balance != null) {
    const bal = Number(bank.current_balance);
    return isCredit ? -Math.abs(bal) : bal;
  }
  if (bank?.computed_balance != null) {
    const bal = Number(bank.computed_balance);
    return isCredit ? -Math.abs(bal) : bal;
  }
  return 0;
};

// True when the shown balance is derived from transactions rather than a
// statement (so the UI can mark it as an estimate).
export const isEstimatedBalance = (bank) =>
  bank?.current_balance == null && bank?.computed_balance != null;

// Convenience: formatted balance string for an account, with its own currency + sign.
export const formatAccountBalance = (bank, opts = {}) =>
  formatCurrency(signedAccountBalance(bank), { currency: bank?.currency_code, ...opts });

// MUI color token for an amount: red when negative, default otherwise.
export const amountColor = (n) => (Number(n) < 0 ? 'error.main' : 'text.primary');

// Parse an ISO timestamp that may be naive-UTC (no tz marker) and render local time.
const _toDate = (iso) => {
  if (!iso) return null;
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasTz ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatDateTime = (iso, fallback = '—') => {
  const d = _toDate(iso);
  return d ? d.toLocaleString() : fallback;
};

export const formatDate = (iso, fallback = '—') => {
  const d = _toDate(iso);
  return d ? d.toLocaleDateString() : fallback;
};

// Relative "3 hours ago" / "4 days ago" for account last-activity chips.
export const timeAgo = (iso, fallback = '—') => {
  const d = _toDate(iso);
  if (!d) return fallback;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
};
