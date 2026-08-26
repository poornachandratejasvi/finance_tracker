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
