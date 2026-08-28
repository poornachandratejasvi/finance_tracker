import { api } from "./client";
import { DebtPayoffPlan, DebtSummary } from "../types";

export async function getDebtSummary(): Promise<DebtSummary> {
  const { data } = await api.get<DebtSummary>("/api/debt/summary");
  return data;
}

export async function getDebtPayoffPlan(
  strategy: "avalanche" | "snowball" = "avalanche",
  extraPayment: number = 0
): Promise<DebtPayoffPlan> {
  const { data } = await api.get<DebtPayoffPlan>("/api/debt/payoff-plan", {
    params: { strategy, extra_payment: extraPayment },
  });
  return data;
}
