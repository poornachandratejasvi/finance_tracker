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
  sms_sender_pattern: string | null;
  interest_rate: number | null;
  minimum_payment: number | null;
  balance_below_limit_enabled?: boolean | null;
  balance_below_threshold?: number | null;
  balance_above_limit_enabled?: boolean | null;
  balance_above_threshold?: number | null;
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
  // A locally-queued, not-yet-synced transaction gets a string id ("local-<uuid>")
  // instead of the server's numeric id -- see mobile/src/offline/syncEngine.ts.
  id: number | string;
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
  client_uuid?: string | null;
  is_pending_sync?: boolean;
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

export interface NetWorthPoint {
  date: string;
  savings_total: number;
  credit_total: number;
  net_worth: number;
  // Additive-only (see the Net Worth screen/page) -- the fields above keep
  // their original bank-only meaning for the existing Dashboard widget.
  investments_total: number;
  loan_total: number;
  full_net_worth: number;
}

export interface NetWorthCurrent {
  savings_total: number;
  credit_total: number;
  net_worth: number;
  investments_total: number;
  loan_total: number;
  full_net_worth: number;
}

export interface NetWorthResponse {
  series: NetWorthPoint[];
  current: NetWorthCurrent | null;
}

export type DashboardWidgetType =
  | "net_worth" | "income_expense" | "spending_by_category" | "cashflow_trend"
  | "balance_trend" | "bank_balances" | "investments_summary"
  | "reward_points_summary" | "recent_transactions" | "budget_progress"
  | "spending_heatmap" | "top_merchants" | "recurring_subscriptions"
  | "spending_anomalies" | "cashflow_forecast" | "zero_spend_streak" | "custom_formula"
  | "ai_summary" | "ai_roast";

export interface DashboardWidget {
  id: number;
  widget_type: DashboardWidgetType;
  position: number;
  size: "small" | "medium" | "large";
  config: Record<string, unknown> | null;
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
  digest_enabled?: boolean;
  // HRA exemption inputs for the Tax Dashboard -- not on a payslip, so these
  // stay a small manual preference rather than a whole new endpoint.
  monthly_rent?: number;
  city_metro?: boolean;
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
  roundup_enabled: boolean;
  roundup_to: number;
  monthly_target: number | null;
  this_month_saved: number | null;
  monthly_target_met: boolean | null;
  created_at: string;
}

export interface RoundupPreview {
  pending_amount: number;
  transaction_count: number;
  roundup_to: number;
}

export interface RoundupSweepResult {
  swept_amount: number;
  transaction_count: number;
  goal: Goal;
}

export interface DebtAccount {
  bank_id: number;
  name: string;
  balance: number;
  interest_rate: number | null;
  minimum_payment: number;
  minimum_payment_is_estimated: boolean;
}

export interface DebtSummary {
  debts: DebtAccount[];
  total_balance: number;
  missing_interest_rate: string[];
}

export interface DebtPayoffScheduleItem {
  bank_id: number;
  name: string;
  payoff_month: number | null;
}

export interface DebtPayoffPlan {
  strategy: "avalanche" | "snowball";
  extra_payment: number;
  months: number | null;
  capped: boolean;
  total_interest: number;
  order: string[];
  schedule: DebtPayoffScheduleItem[];
}

export interface ZeroSpendStreaks {
  current_streak: number;
  longest_streak: number;
  lookback_days: number;
  badges: string[];
  next_badge: { days_needed: number; label: string } | null;
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
  sample_description: string;
  amount: number;
  frequency: string;
  occurrences: number;
  transaction_type: string;
  [key: string]: unknown;
}

export interface HeatmapDay {
  date: string;
  amount: number;
}

export interface HeatmapResponse {
  days: HeatmapDay[];
  max_amount: number;
}

export interface TopMerchant {
  merchant: string;
  sample_description: string;
  total: number;
  count: number;
}

export interface TopMerchantsResponse {
  merchants: TopMerchant[];
}

export interface SpendingAnomaly {
  description: string;
  amount: number;
  date: string;
  reason: string;
}

export interface AnomaliesResponse {
  anomalies: SpendingAnomaly[];
  ai: boolean;
}

export interface TransactionPrediction {
  description: string;
  category: string | null;
  bank_name: string | null;
  amount: number;
  transaction_type: string;
  predicted_date: string;
  occurrences: number;
  avg_interval_days: number;
}

export interface PredictionsResponse {
  predictions: TransactionPrediction[];
  expected_expense: number;
  expected_income: number;
  days_ahead: number;
}

export interface VehiclePolicy {
  id: number;
  vehicle_id: number;
  provider: string | null;
  policy_number: string | null;
  policy_type: string;
  premium_amount: number | null;
  start_date: string | null;
  expiry_date: string | null;
  days_until_expiry: number | null;
  notes: string | null;
}

export interface Vehicle {
  id: number;
  registration_number: string;
  nickname: string | null;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  fuel_type: string | null;
  purchase_date: string | null;
  notes: string | null;
  current_policy: VehiclePolicy | null;
  policy_count: number;
}

export interface ExpiringPolicy extends VehiclePolicy {
  vehicle_registration_number: string;
  vehicle_nickname: string | null;
}

export interface VehicleDocScanResult {
  success: boolean;
  message?: string;
  registration_number?: string | null;
  make?: string | null;
  model?: string | null;
  fuel_type?: string | null;
  provider?: string | null;
  policy_number?: string | null;
  policy_type?: string | null;
  premium_amount?: number | null;
  start_date?: string | null;
  expiry_date?: string | null;
}

export type RewardEntryType = "earned" | "redeemed" | "expired" | "adjustment";

export interface RewardPointEntry {
  id: number;
  bank_id: number;
  entry_type: RewardEntryType;
  points: number;
  expiry_date: string | null;
  entry_date: string | null;
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

export type InvestmentCategory =
  | "ppf" | "mutual_fund" | "stocks" | "nps" | "epf" | "bonds" | "gold" | "vehicle"
  | "crypto" | "collectible";

export type InvestmentEntryType = "buy" | "sell" | "contribution" | "withdrawal" | "value_update";

export interface InvestmentAccountSummary {
  id: number;
  name: string;
  category: InvestmentCategory;
  source: "auto" | "manual";
  current_value: number;
  linked_bank_id: number | null;
}

export interface InvestmentCategorySummary {
  category: InvestmentCategory;
  total_value: number;
  accounts: InvestmentAccountSummary[];
}

export interface InvestmentsDashboard {
  categories: InvestmentCategorySummary[];
  total_value: number;
}

export interface InvestmentEntry {
  id: number;
  investment_account_id: number;
  entry_type: InvestmentEntryType;
  amount: number;
  quantity: number | null;
  price_per_unit: number | null;
  entry_date: string | null;
  description: string | null;
  source: "manual" | "auto";
  created_at: string;
}

// ---- Autopay Mandates ----

export type MandateFrequency = "weekly" | "monthly" | "yearly" | "other";
export type MandateStatus = "active" | "paused" | "cancelled";

export interface AutopayMandate {
  id: number;
  bank_id: number | null;
  merchant_name: string;
  upi_vpa: string | null;
  max_amount: number | null;
  frequency: MandateFrequency;
  next_debit_date: string | null;
  status: MandateStatus;
  notes: string | null;
}

// ---- Insurance ----

export type InsurancePolicyType = "health" | "life" | "home" | "other";
export type PremiumFrequency = "monthly" | "quarterly" | "yearly";

export interface InsurancePolicy {
  id: number;
  policy_type: InsurancePolicyType;
  provider: string | null;
  policy_number: string | null;
  insured_name: string | null;
  premium_amount: number | null;
  premium_frequency: PremiumFrequency;
  coverage_amount: number | null;
  issued_date: string | null;
  expiry_date: string | null;
  days_until_expiry: number | null;
  is_active: boolean;
  notes: string | null;
  document_count: number;
}

export interface PolicyDocument {
  id: number;
  document_type: string;
  title: string | null;
  url: string | null;
  processing: boolean;
  created_at: string | null;
}

// ---- Warranties ----

export type WarrantyCategory = "electronics" | "appliance" | "furniture" | "other";

export interface Warranty {
  id: number;
  item_name: string;
  category: WarrantyCategory;
  vendor: string | null;
  purchase_date: string | null;
  purchase_amount: number | null;
  warranty_expiry: string | null;
  warranty_days_until_expiry: number | null;
  amc_expiry: string | null;
  amc_days_until_expiry: number | null;
  amc_provider: string | null;
  notes: string | null;
  document_count: number;
}

// ---- IOUs ----

export type IouDirection = "lent" | "borrowed";
export type IouStatus = "open" | "settled";

export interface Iou {
  id: number;
  person_name: string;
  direction: IouDirection;
  principal_amount: number;
  outstanding_amount: number;
  iou_date: string;
  due_date: string | null;
  status: IouStatus;
  notes: string | null;
}

export interface IouListResponse {
  items: Iou[];
  total_owed_to_me: number;
  total_i_owe: number;
}

export interface IouPayment {
  id: number;
  amount: number;
  payment_date: string;
  notes: string | null;
}

// ---- Tax Dashboard ----

export interface TaxSection {
  limit: number;
  utilized: number;
  remaining: number;
  breakdown: { label: string; amount: number }[];
}

export interface HraExemption {
  configured: boolean;
  monthly_rent: number;
  city_metro: boolean;
  months_on_file?: number;
  basic_total?: number;
  hra_received_total?: number;
  rent_paid_total?: number;
  exemption: number;
}

export interface TaxDashboard {
  financial_year: string;
  sections: {
    "80c": TaxSection;
    "80d": TaxSection;
    "80ccd_1b": TaxSection;
  };
  hra_exemption: HraExemption | null;
}

// ---- Payslips ----

export interface Payslip {
  id: number;
  month: string;
  employee_name: string | null;
  regime_type: string | null;
  basic: number | null;
  hra_received: number | null;
  provident_fund: number | null;
  income_tax_deducted: number | null;
  other_earnings_total: number | null;
  other_deductions_total: number | null;
  total_earnings: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  document_url: string | null;
}

// ---- Shared Expenses ----

export interface HouseholdMember {
  id: number;
  username: string;
}

export interface SharedExpenseShare {
  id: number;
  user_id: number;
  username: string | null;
  amount: number;
  is_settled: boolean;
  settled_at: string | null;
}

export interface SharedExpense {
  id: number;
  description: string;
  total_amount: number;
  expense_date: string | null;
  paid_by_user_id: number;
  paid_by_username: string | null;
  shares: SharedExpenseShare[];
}

// ---- Packages ----

export type PackageStatus = "ordered" | "shipped" | "out_for_delivery" | "delivered" | "unknown";

export interface Package {
  id: number;
  source: "email" | "manual";
  carrier: string;
  merchant: string | null;
  tracking_number: string | null;
  order_id: string | null;
  item_description: string | null;
  status: PackageStatus;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  tracking_url: string | null;
  last_checked_at: string | null;
  last_tracker_error: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface Carrier {
  key: string;
  label: string;
  has_live_tracking: boolean;
  has_external_lookup: boolean;
}

// ---- Calendar ----

export interface CalendarItem {
  type: string;
  id: number | null;
  date: string | null;
  title: string;
  subtitle: string | null;
  amount: number | null;
  link: string | null;
  is_overdue: boolean;
  payment_status?: string;
}

// ---- Planned Expenses/Income ----

export type PlannedDirection = "expense" | "income";
export type PlannedRecurrence = "none" | "weekly" | "monthly" | "yearly";
export type PlannedOccurrenceStatus = "open" | "matched" | "closed";

export interface PlannedItemOccurrence {
  id: number;
  planned_item_id: number;
  due_date: string;
  expected_amount: number | null;
  status: PlannedOccurrenceStatus;
  matched_transaction_id: number | null;
  closed_at: string | null;
}

export interface PlannedItem {
  id: number;
  name: string;
  direction: PlannedDirection;
  amount: number | null;
  match_hint: string | null;
  due_date: string;
  recurrence: PlannedRecurrence;
  is_active: boolean;
  notes: string | null;
  created_at: string | null;
  current_occurrence: PlannedItemOccurrence | null;
}

export interface PlannedItemsSummary {
  month: string;
  planned_income: number;
  planned_expense: number;
  open_count: number;
  total_count: number;
}

export interface PlannedItemCandidate {
  id: number;
  description: string;
  amount: number;
  transaction_type: string;
  transaction_date: string | null;
  bank_id: number | null;
}
