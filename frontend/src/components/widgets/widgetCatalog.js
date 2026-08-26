import {
  AccountBalance, TrendingUp, PieChartOutline, ShowChart, Timeline,
  AccountBalanceWallet, Savings, CardGiftcard, Receipt, Speed,
} from '@mui/icons-material';
import {
  NetWorthContent, IncomeExpenseContent, SpendingByCategoryContent, CashflowTrendContent,
  BalanceTrendContent, BankBalancesContent, InvestmentsSummaryContent, RewardPointsSummaryContent,
  RecentTransactionsContent, BudgetProgressContent,
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
};

export const WIDGET_TYPES = Object.keys(WIDGET_CATALOG);
