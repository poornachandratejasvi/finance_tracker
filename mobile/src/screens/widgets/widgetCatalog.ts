import { ComponentType } from "react";
import { DashboardWidgetType } from "../../types";
import {
  NetWorthContent, IncomeExpenseContent, SpendingByCategoryContent, CashflowTrendContent,
  BalanceTrendContent, BankBalancesContent, InvestmentsSummaryContent, RewardPointsSummaryContent,
  RecentTransactionsContent, BudgetProgressContent, SpendingHeatmapContent, TopMerchantsContent,
  RecurringSubscriptionsContent, SpendingAnomaliesContent, CashflowForecastContent,
  ZeroSpendStreakContent, CustomFormulaContent,
} from "./widgetContents";

// Single source of truth for every addable widget on mobile -- mirrors
// frontend/src/components/widgets/widgetCatalog.js and must stay in sync
// with the backend's WIDGET_TYPES (backend/app/api/endpoints/dashboard_widgets.py).
export const WIDGET_CATALOG: Record<DashboardWidgetType, {
  label: string;
  description: string;
  size: "small" | "medium" | "large";
  Content: ComponentType<any>;
}> = {
  net_worth: { label: "Net Worth", description: "Total savings minus credit owed.", size: "medium", Content: NetWorthContent },
  income_expense: { label: "Income vs Expense", description: "This period's totals at a glance.", size: "small", Content: IncomeExpenseContent },
  spending_by_category: { label: "Spending by Category", description: "Where your money went this period.", size: "medium", Content: SpendingByCategoryContent },
  cashflow_trend: { label: "Cash Flow Trend", description: "Income vs expense over time.", size: "large", Content: CashflowTrendContent },
  balance_trend: { label: "Balance Trend", description: "Net balance over time.", size: "large", Content: BalanceTrendContent },
  bank_balances: { label: "Account Balances", description: "Every account, ranked by balance.", size: "medium", Content: BankBalancesContent },
  investments_summary: { label: "Investments", description: "PPF, mutual funds, stocks and more.", size: "medium", Content: InvestmentsSummaryContent },
  reward_points_summary: { label: "Reward Points", description: "Credit card points across all cards.", size: "medium", Content: RewardPointsSummaryContent },
  recent_transactions: { label: "Recent Transactions", description: "Your latest activity.", size: "medium", Content: RecentTransactionsContent },
  budget_progress: { label: "Budget Progress", description: "Spend vs limit per budgeted category.", size: "medium", Content: BudgetProgressContent },
  spending_heatmap: { label: "Spending Heatmap", description: "Daily spend, calendar-style, last ~4 months.", size: "large", Content: SpendingHeatmapContent },
  top_merchants: { label: "Top Merchants", description: "Where you spend the most this period.", size: "medium", Content: TopMerchantsContent },
  recurring_subscriptions: { label: "Recurring & Subscriptions", description: "Auto-detected subscriptions and standing instructions.", size: "medium", Content: RecurringSubscriptionsContent },
  spending_anomalies: { label: "Spending Anomalies", description: "Unusually large transactions, flagged automatically.", size: "medium", Content: SpendingAnomaliesContent },
  cashflow_forecast: { label: "Cash Flow Forecast", description: "Expected upcoming income and bills.", size: "medium", Content: CashflowForecastContent },
  zero_spend_streak: { label: "Zero-Spend Streak", description: "Consecutive no-spend days, with badges.", size: "small", Content: ZeroSpendStreakContent },
  custom_formula: { label: "Custom Formula", description: "Sum, difference, average or % across any of your accounts.", size: "medium", Content: CustomFormulaContent },
};

export const WIDGET_TYPES = Object.keys(WIDGET_CATALOG) as DashboardWidgetType[];
