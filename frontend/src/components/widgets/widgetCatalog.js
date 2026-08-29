import {
  AccountBalance, TrendingUp, PieChartOutline, ShowChart, Timeline,
  AccountBalanceWallet, Savings, CardGiftcard, Receipt, Speed,
  CalendarMonth, Storefront, Autorenew, WarningAmber, Insights, LocalFireDepartment, Functions,
  Summarize, Whatshot,
} from '@mui/icons-material';
import {
  NetWorthContent, IncomeExpenseContent, SpendingByCategoryContent, CashflowTrendContent,
  BalanceTrendContent, BankBalancesContent, InvestmentsSummaryContent, RewardPointsSummaryContent,
  RecentTransactionsContent, BudgetProgressContent, SpendingHeatmapContent, TopMerchantsContent,
  RecurringSubscriptionsContent, SpendingAnomaliesContent, CashflowForecastContent,
  ZeroSpendStreakContent, CustomFormulaContent, AISummaryContent, AIRoastContent,
} from './widgetContents.jsx';

// Single source of truth for every addable widget -- must stay in sync with
// backend/app/api/endpoints/dashboard_widgets.py's WIDGET_TYPES (the backend
// validates the type is one of these; this is where the human-facing
// label/icon/description/default size live).
export const WIDGET_CATALOG = {
  net_worth: { label: 'Net Worth', description: 'Total savings minus credit owed, with trend.', icon: AccountBalance, size: 'medium', Content: NetWorthContent },
  income_expense: { label: 'Income vs Expense', description: "This period's totals at a glance.", icon: TrendingUp, size: 'small', Content: IncomeExpenseContent },
  spending_by_category: { label: 'Spending by Category', description: 'Where your money went this period.', icon: PieChartOutline, size: 'medium', Content: SpendingByCategoryContent },
  cashflow_trend: { label: 'Cash Flow Trend', description: 'Income vs expense over time.', icon: ShowChart, size: 'large', Content: CashflowTrendContent },
  balance_trend: { label: 'Balance Trend', description: 'Savings and net worth over time.', icon: Timeline, size: 'large', Content: BalanceTrendContent },
  bank_balances: { label: 'Account Balances', description: 'Every account, ranked by balance.', icon: AccountBalanceWallet, size: 'medium', Content: BankBalancesContent },
  investments_summary: { label: 'Investments', description: 'PPF, mutual funds, stocks and more.', icon: Savings, size: 'medium', Content: InvestmentsSummaryContent },
  reward_points_summary: { label: 'Reward Points', description: 'Credit card points across all cards.', icon: CardGiftcard, size: 'medium', Content: RewardPointsSummaryContent },
  recent_transactions: { label: 'Recent Transactions', description: 'Your latest activity.', icon: Receipt, size: 'medium', Content: RecentTransactionsContent },
  budget_progress: { label: 'Budget Progress', description: 'Spend vs limit per budgeted category.', icon: Speed, size: 'medium', Content: BudgetProgressContent },
  spending_heatmap: { label: 'Spending Heatmap', description: 'Daily spend, calendar-style, last ~4 months.', icon: CalendarMonth, size: 'large', Content: SpendingHeatmapContent },
  top_merchants: { label: 'Top Merchants', description: 'Where you spend the most this period.', icon: Storefront, size: 'medium', Content: TopMerchantsContent },
  recurring_subscriptions: { label: 'Recurring & Subscriptions', description: 'Auto-detected subscriptions and standing instructions.', icon: Autorenew, size: 'medium', Content: RecurringSubscriptionsContent },
  spending_anomalies: { label: 'Spending Anomalies', description: 'Unusually large transactions, flagged automatically.', icon: WarningAmber, size: 'medium', Content: SpendingAnomaliesContent },
  cashflow_forecast: { label: 'Cash Flow Forecast', description: 'Expected upcoming income and bills.', icon: Insights, size: 'medium', Content: CashflowForecastContent },
  zero_spend_streak: { label: 'Zero-Spend Streak', description: 'Consecutive no-spend days, with badges.', icon: LocalFireDepartment, size: 'small', Content: ZeroSpendStreakContent },
  // Unlike every other type above, this one can be added more than once (see
  // AddWidgetDialog) -- each instance has its own config (which accounts +
  // which operation), so "already added" doesn't apply to it.
  custom_formula: { label: 'Custom Formula', description: 'Sum, difference, average or % across any of your accounts.', icon: Functions, size: 'medium', Content: CustomFormulaContent, repeatable: true },
  ai_summary: { label: 'AI Summary', description: 'Written monthly summary, generated on demand.', icon: Summarize, size: 'medium', Content: AISummaryContent },
  ai_roast: { label: 'Roast Me', description: "Opt-in, blunt AI commentary on last month's spending.", icon: Whatshot, size: 'medium', Content: AIRoastContent },
};

export const WIDGET_TYPES = Object.keys(WIDGET_CATALOG);
