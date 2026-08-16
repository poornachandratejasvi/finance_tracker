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
  is_archived: boolean | null;
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

export interface Label {
  id: number;
  user_id: number;
  name: string;
  color: string;
  auto_keywords: string[] | null;
  created_at: string;
}

export type RecordType = "any" | "debit" | "credit" | "transfer";

export interface AutoRule {
  id: number;
  user_id: number;
  name: string;
  keywords: string[];
  record_type: RecordType | null;
  category: string | null;
  label_ids: number[];
  priority: number | null;
  is_active: boolean | null;
  notify_discord: boolean | null;
  created_at: string;
}

export type AmountOperator = "none" | "eq" | "gte" | "lte" | "between";
export type ConditionLogic = "and" | "or";

export interface NotificationRule {
  id: number;
  user_id: number;
  name: string;
  trigger_type: "match" | "absence";
  keywords: string[];
  keyword_negate: boolean | null;
  record_type: RecordType | null;
  bank_id: number | null;
  bank_name: string | null;
  amount_operator: AmountOperator | null;
  amount_value: number | null;
  amount_value_max: number | null;
  amount_negate: boolean | null;
  condition_logic: ConditionLogic | null;
  check_day_of_month: number | null;
  notify_discord: boolean | null;
  notify_email: boolean | null;
  email_to: string | null;
  notify_task: boolean | null;
  is_active: boolean | null;
  last_triggered_at: string | null;
  last_triggered_month: string | null;
  created_at: string;
}

export interface UserPreferences {
  language: string;
  default_interval: string;
  hide_decimals: boolean;
  auto_logout: boolean;
}

export interface Currency {
  id: number;
  user_id: number;
  code: string;
  symbol: string;
  name: string | null;
  rate_to_base: number;
  is_base: boolean;
  created_at: string;
}

export interface Template {
  id: number;
  user_id: number;
  name: string;
  bank_id: number | null;
  category: string | null;
  amount: number | null;
  transaction_type: string;
  description: string | null;
  notes: string | null;
  currency_code: string | null;
  label_ids: number[];
  created_at: string;
}

export interface ApiToken {
  id: number;
  name: string | null;
  token_prefix: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "ADMIN" | "USER" | "VIEWER";
  is_active: boolean;
  created_at: string;
  household_id: number | null;
}

export interface GmailAccountStatus {
  id: number;
  email: string;
  is_active: boolean;
  last_synced: string | null;
  created_at: string;
  last_checked_at: string | null;
  last_error: string | null;
  status: "connected" | "error" | "reauth_required";
}

export interface BackupConfig {
  enabled: boolean;
  frequency: "hourly" | "daily" | "weekly";
  destination: "local" | "drive";
  last_run_at: string | null;
}

export interface BackupHistoryEntry {
  filename: string;
  size: number;
  destination: "local" | "drive";
  drive_file_id: string | null;
  created_at: string;
}

export interface BackupStatus {
  drive_connected: boolean;
  last_backup: BackupHistoryEntry | null;
  config: BackupConfig;
}

export interface AIConfig {
  providers: string[];
  claude: { model: string };
  gemini: { model: string };
  ollama: { model: string; base_url: string };
  features: {
    categorize: boolean;
    insights: boolean;
    predict: boolean;
    query: boolean;
    anomalies: boolean;
    summary: boolean;
  };
  claude_key_set: boolean;
  gemini_key_set: boolean;
  available: { ollama: boolean; claude: boolean; gemini: boolean };
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

export interface AnalyticsPeriod {
  label: string;
  income_total: number;
  expense_total: number;
  net: number;
  income_by_category: CategoryAmount[];
  expense_by_category: CategoryAmount[];
}

export interface AnalyticsComparison {
  base_currency: { code: string; symbol: string };
  period_a: AnalyticsPeriod;
  period_b: AnalyticsPeriod;
}

export interface CashflowPoint {
  date: string;
  income: number;
  expense: number;
  net: number;
}

export interface CashflowResponse {
  granularity: "day" | "week" | "month";
  series: CashflowPoint[];
  totals: { income: number; expense: number; net: number };
}

export interface BalanceTrendPoint {
  date: string;
  balance: number;
}

export interface BalanceTrendResponse {
  granularity: "day" | "week" | "month";
  series: BalanceTrendPoint[];
  ending_balance: number;
  net_change: number;
}

export interface Budget {
  category: string;
  monthly_limit: number;
  alert_at_pct: number;
}

export interface BudgetsConfig {
  budgets: Budget[];
  alert_email: string | null;
  discord_alerts: boolean;
}

export interface BudgetStatusItem {
  id: number;
  category: string;
  monthly_limit: number;
  alert_at_pct: number;
  spent: number;
  remaining: number;
  pct: number;
  over: boolean;
}

export interface BudgetStatus {
  period: string;
  budgets: BudgetStatusItem[];
  total_limit: number;
  total_spent: number;
}

export interface Goal {
  id: number;
  name: string;
  target_amount: number;
  current_amount: number;
  remaining: number;
  pct: number;
  target_date: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
}

export interface PdfStatement {
  id: number;
  file_name: string;
  file_path: string | null;
  decrypted_available: boolean;
  is_processed: boolean;
  error_message: string | null;
  is_password_protected: boolean;
  statement_period_start: string | null;
  statement_period_end: string | null;
  created_at: string;
  bank_name: string | null;
  bank_id: number | null;
  from_email: string | null;
  email_subject: string | null;
  email_received_date: string | null;
  transaction_count: number;
}

export interface PdfListResponse {
  items: PdfStatement[];
  total: number;
  skip: number;
  limit: number;
}

export interface StatementDashboardBank {
  bank_id: number;
  bank_name: string;
  bank_type: string | null;
  bank_code: string | null;
  current_balance: number | null;
  balance_updated_at: string | null;
  total_statements: number;
  total_transactions: number;
  latest_email_subject: string | null;
  latest_received_date: string | null;
  latest_statement_period_end: string | null;
  latest_pdf_filename: string | null;
  latest_pdf_processed: boolean;
  expected_next_statement: string | null;
  days_until_next: number | null;
}

export type SyncStatus = "queued" | "processing" | "success" | "partial" | "failed";

export interface SyncLog {
  sync_log_id: number;
  status: SyncStatus;
  sync_type: string | null;
  gmail_email: string | null;
  emails_processed: number;
  transactions_added: number;
  duplicates_found: number;
  total_emails: number | null;
  processed_emails: number | null;
  current_step: string | null;
  current_bank: string | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface ScheduleConfig {
  enabled: boolean;
  frequency: "hourly" | "every4h" | "daily" | "weekly";
  hour: number;
  day_of_week: number;
  notify_on_completion: boolean;
  auto_generate_csv: boolean;
  csv_email_on_sync: boolean;
  last_run_at: string | null;
}

export type WatcherFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface Watcher {
  id: number;
  user_id: number;
  name: string;
  match_keywords: string[];
  match_amount: number | null;
  frequency: WatcherFrequency;
  is_active: boolean;
  current_period: string | null;
  current_task_id: string | null;
  cleared_at: string | null;
  created_at: string;
}

export interface WatcherSuggestion {
  bank_name: string | null;
  suggested_keywords: string[];
  match_amount?: number | null;
  [key: string]: unknown;
}

export type RewardEntryType = "earned" | "redeemed" | "expired" | "adjustment";

export interface RewardPointEntry {
  id: number;
  bank_id: number;
  entry_type: RewardEntryType;
  points: number;
  expiry_date: string | null;
  description: string | null;
  source: "manual" | "auto" | "ai";
  created_at: string;
}

export interface RewardPointExpiring {
  expiry_date: string;
  points: number;
  entry_id: number;
}

export interface RewardPointSummary {
  bank_id: number;
  bank_name: string;
  balance: number;
  expiring: RewardPointExpiring[];
  next_expiry_date: string | null;
}

export interface RewardPointsResponse {
  summaries: RewardPointSummary[];
  entries: RewardPointEntry[];
}

export interface RewardPointsMonth {
  month: string; // 'YYYY-MM'
  gained: number;
  used: number;
  expired: number;
  net: number;
}

export interface FamilyMemberBank {
  bank_id: number;
  bank_name: string;
  bank_type: string;
  current_balance: number;
  currency_code: string | null;
  balance_updated_at: string | null;
}

export interface FamilyMember {
  user_id: number;
  username: string;
  full_name: string | null;
  role: string;
  is_you: boolean;
  banks: FamilyMemberBank[];
  assets: number;
  liabilities: number;
  net: number;
}

export interface FamilyDashboardResponse {
  members: FamilyMember[];
  totals: {
    total_assets: number;
    total_liabilities: number;
    net_worth: number;
  };
}
