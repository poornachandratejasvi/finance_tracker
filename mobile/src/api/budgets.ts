import { api } from "./client";
import { Budget, BudgetsConfig, BudgetStatus } from "../types";

export async function getBudgetsConfig(): Promise<BudgetsConfig> {
  const { data } = await api.get<BudgetsConfig>("/api/settings/budgets");
  return data;
}

export async function saveBudgetsConfig(
  budgets: Budget[],
  alertEmail?: string | null,
  discordAlerts?: boolean
): Promise<BudgetsConfig> {
  const { data } = await api.post<BudgetsConfig>("/api/settings/budgets", {
    budgets,
    alert_email: alertEmail,
    discord_alerts: discordAlerts,
  });
  return data;
}

export async function getBudgetStatus(): Promise<BudgetStatus> {
  const { data } = await api.get<BudgetStatus>("/api/settings/budgets/status");
  return data;
}
