import { api } from "./client";
import { DashboardWidget, DashboardWidgetType } from "../types";

export async function listDashboardWidgets(): Promise<DashboardWidget[]> {
  const { data } = await api.get<DashboardWidget[]>("/api/dashboard-widgets/");
  return data;
}

export async function addDashboardWidget(
  widgetType: DashboardWidgetType,
  size: "small" | "medium" | "large" = "medium"
): Promise<DashboardWidget> {
  const { data } = await api.post<DashboardWidget>("/api/dashboard-widgets/", { widget_type: widgetType, size });
  return data;
}

export async function reorderDashboardWidgets(ids: number[]): Promise<void> {
  await api.post("/api/dashboard-widgets/reorder", { ids });
}

export async function deleteDashboardWidget(id: number): Promise<void> {
  await api.delete(`/api/dashboard-widgets/${id}`);
}

export async function updateDashboardWidget(
  id: number,
  payload: { size?: "small" | "medium" | "large"; config?: Record<string, unknown> }
): Promise<DashboardWidget> {
  const { data } = await api.put<DashboardWidget>(`/api/dashboard-widgets/${id}`, payload);
  return data;
}

export interface FormulaValue {
  result: number | null;
  operation: "sum" | "difference" | "average" | "percentage";
  currency_code: string | null;
  breakdown: Array<{ bank_id: number; bank_name: string; balance: number; currency_code: string }>;
}

export async function getWidgetFormulaValue(id: number): Promise<FormulaValue> {
  const { data } = await api.get<FormulaValue>(`/api/dashboard-widgets/${id}/formula-value`);
  return data;
}
