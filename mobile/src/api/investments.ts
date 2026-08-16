import { api } from "./client";
import {
  InvestmentAccountSummary, InvestmentCategory, InvestmentEntry,
  InvestmentEntryType, InvestmentsDashboard,
} from "../types";

export async function getInvestmentsDashboard(): Promise<InvestmentsDashboard> {
  const { data } = await api.get<InvestmentsDashboard>("/api/investments/dashboard");
  return data;
}

export interface InvestmentAccountPayload {
  name: string;
  category: InvestmentCategory;
}

export async function createInvestmentAccount(payload: InvestmentAccountPayload): Promise<InvestmentAccountSummary> {
  const { data } = await api.post<InvestmentAccountSummary>("/api/investments/", payload);
  return data;
}

export async function deleteInvestmentAccount(accountId: number): Promise<void> {
  await api.delete(`/api/investments/${accountId}`);
}

export async function getInvestmentEntries(accountId: number): Promise<{ entries: InvestmentEntry[] }> {
  const { data } = await api.get<{ entries: InvestmentEntry[] }>(`/api/investments/${accountId}/entries`);
  return data;
}

export interface InvestmentEntryPayload {
  entry_type: InvestmentEntryType;
  amount: number;
  quantity?: number | null;
  price_per_unit?: number | null;
  description?: string | null;
}

export async function createInvestmentEntry(
  accountId: number, payload: InvestmentEntryPayload
): Promise<InvestmentEntry> {
  const { data } = await api.post<InvestmentEntry>(`/api/investments/${accountId}/entries`, payload);
  return data;
}

export async function deleteInvestmentEntry(entryId: number): Promise<void> {
  await api.delete(`/api/investments/entries/${entryId}`);
}
