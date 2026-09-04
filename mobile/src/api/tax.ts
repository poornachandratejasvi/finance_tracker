import { api } from "./client";
import { TaxDashboard } from "../types";

export async function getTaxDashboard(financialYear?: string, seniorCitizen = false): Promise<TaxDashboard> {
  const { data } = await api.get<TaxDashboard>("/api/tax/dashboard", {
    params: { financial_year: financialYear || undefined, senior_citizen: seniorCitizen },
  });
  return data;
}
