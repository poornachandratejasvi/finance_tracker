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
