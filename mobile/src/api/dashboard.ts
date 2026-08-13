import { api } from "./client";
import { DashboardSummary } from "../types";

export async function fetchDashboardSummary(params?: {
  start_date?: string;
  end_date?: string;
}): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>("/api/dashboard/summary", { params });
  return data;
}

export async function fetchLatestMonth(): Promise<
  | { has_data: false }
  | { has_data: true; year: number; month: number; month_label: string; start_date: string; end_date: string }
> {
  const { data } = await api.get("/api/dashboard/latest-month");
  return data;
}
