export type TransactionType = "debit" | "credit";

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  is_active: boolean;
  household_id: number | null;
}

export interface Bank {
  id: number;
  name: string;
  code: string | null;
  bank_type: string | null;
  currency_code: string | null;
  color: string | null;
  current_balance: number | null;
  computed_balance: number | null;
  is_active: boolean;
}

export interface Category {
  id: number;
  name: string;
  icon: string | null;
  color: string | null;
  kind: string | null;
  parent_id: number | null;
}

export interface Transaction {
  id: number;
  user_id: number;
  bank_id: number;
  bank_name: string | null;
  bank_type: string | null;
  currency_code: string | null;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: TransactionType;
  category: string | null;
  notes: string | null;
  from_account: string | null;
  to_account: string | null;
  is_duplicate: boolean;
  is_manual: boolean;
  is_confirmed: boolean;
  source: string | null;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface TransactionListResponse {
  items: Transaction[];
  total: number;
  skip: number;
  limit: number;
}

export interface BankBalanceSummary {
  bank_id: number;
  bank_name: string;
  bank_type: string | null;
  current_balance: number;
  period_credit: number;
  period_debit: number;
  period_net: number;
}

export interface DashboardSummary {
  total_debit: number;
  total_credit: number;
  net_balance: number;
  transaction_count: number;
  balances: {
    savings_total: number;
    credit_total: number;
    period_savings_net: number;
    period_credit_net: number;
    banks: BankBalanceSummary[];
  };
  bank_summary: Array<{
    bank_name: string;
    transaction_count: number;
    total_debit: number;
    total_credit: number;
  }>;
  category_summary: Array<{
    category: string;
    transaction_count: number;
    total_amount: number;
  }>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}
