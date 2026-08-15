import { api } from "./client";
import { AnalyticsComparison, BalanceTrendResponse, CashflowResponse } from "../types";

export interface AnalyticsFilters {
  bank_id?: string;
  category?: string;
  label_id?: string;
  transaction_type?: string;
  min_amount?: number;
  max_amount?: number;
  search?: string;
  currency?: string;
  include_transfers?: boolean;
}

export async function fetchComparison(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
  labelA?: string,
  labelB?: string,
  filters?: AnalyticsFilters
): Promise<AnalyticsComparison> {
  const { data } = await api.get<AnalyticsComparison>("/api/analytics/comparison", {
    params: {
      start_a: startA,
      end_a: endA,
      start_b: startB,
      end_b: endB,
      label_a: labelA,
      label_b: labelB,
      ...filters,
    },
  });
  return data;
}

export async function fetchCashflow(
  startDate: string,
  endDate: string,
  granularity: "day" | "week" | "month" = "month",
  filters?: AnalyticsFilters
): Promise<CashflowResponse> {
  const { data } = await api.get<CashflowResponse>("/api/analytics/cashflow", {
    params: { start_date: startDate, end_date: endDate, granularity, ...filters },
  });
  return data;
}

export async function fetchBalanceTrend(
  startDate: string,
  endDate: string,
  granularity: "day" | "week" | "month" = "month",
  filters?: AnalyticsFilters
): Promise<BalanceTrendResponse> {
  const { data } = await api.get<BalanceTrendResponse>("/api/analytics/balance-trend", {
    params: { start_date: startDate, end_date: endDate, granularity, ...filters },
  });
  return data;
}
