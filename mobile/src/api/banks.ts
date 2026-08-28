import { api } from "./client";
import { Bank } from "../types";

export async function listBanks(): Promise<Bank[]> {
  const { data } = await api.get<Bank[]>("/api/banks/");
  return data;
}

export interface BankPayload {
  name: string;
  bank_type?: string;
  currency_code?: string;
  color?: string;
  current_balance?: number;
  is_archived?: boolean;
  sms_sender_pattern?: string;
  interest_rate?: number;
  minimum_payment?: number;
}

export async function createBank(payload: BankPayload): Promise<Bank> {
  const { data } = await api.post<Bank>("/api/banks/", payload);
  return data;
}

export async function updateBank(bankId: number, payload: Partial<BankPayload>): Promise<Bank> {
  const { data } = await api.put<Bank>(`/api/banks/${bankId}`, payload);
  return data;
}

export async function deleteBank(bankId: number): Promise<void> {
  await api.delete(`/api/banks/${bankId}`);
}
