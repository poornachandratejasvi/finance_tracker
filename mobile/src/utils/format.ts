const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencySymbol(code?: string | null): string {
  return CURRENCY_SYMBOLS[(code || "INR").toUpperCase()] || (code || "");
}

// Set once at app startup from Settings -> Profile -> Preferences -> "Hide
// decimals within amounts" (see AuthContext.tsx). A module-level flag rather
// than threading the preference through every formatCurrency call site,
// since it's called from dozens of components as a plain function.
let hideDecimals = false;
export function setHideDecimals(v: boolean): void {
  hideDecimals = !!v;
}

export function formatCurrency(amount: number, code?: string | null): string {
  const symbol = currencySymbol(code);
  const decimals = hideDecimals ? 0 : 2;
  const formatted = Math.abs(amount).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${amount < 0 ? "-" : ""}${symbol}${formatted}`;
}

// Signed balance for a bank list row: falls back to computed_balance when no
// statement balance is stored, and always shows a credit card's owed amount
// as negative regardless of source (mirrors signedAccountBalance() in
// frontend/src/utils/format.js -- current_balance is stored as a positive
// amount-owed for credit cards, and the computed net isn't a reliable sign
// on its own).
export function signedAccountBalance(bank: { bank_type?: string | null; current_balance?: number | null; computed_balance?: number | null }): number {
  const isCredit = (bank?.bank_type || "").toLowerCase() === "credit";
  const raw = bank?.current_balance ?? bank?.computed_balance;
  if (raw == null) return 0;
  return isCredit ? -Math.abs(raw) : raw;
}

export function formatDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
