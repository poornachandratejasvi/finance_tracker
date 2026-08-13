const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function currencySymbol(code?: string | null): string {
  return CURRENCY_SYMBOLS[(code || "INR").toUpperCase()] || (code || "");
}

export function formatCurrency(amount: number, code?: string | null): string {
  const symbol = currencySymbol(code);
  const formatted = Math.abs(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "-" : ""}${symbol}${formatted}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
