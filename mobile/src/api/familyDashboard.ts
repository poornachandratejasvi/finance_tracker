import { api } from "./client";
import { FamilyDashboardResponse } from "../types";

export async function getFamilyDashboard(): Promise<FamilyDashboardResponse> {
  const { data } = await api.get<FamilyDashboardResponse>("/api/family-dashboard/");
  return data;
}
