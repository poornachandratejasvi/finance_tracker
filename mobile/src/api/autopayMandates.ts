import { api } from "./client";
import { AutopayMandate, MandateFrequency, MandateStatus } from "../types";

export async function listAutopayMandates(): Promise<AutopayMandate[]> {
  const { data } = await api.get<AutopayMandate[]>("/api/autopay-mandates/");
  return data;
}

export interface MandatePayload {
  bank_id?: number | null;
  merchant_name: string;
  upi_vpa?: string | null;
  max_amount?: number | null;
  frequency?: MandateFrequency;
  next_debit_date?: string | null;
  status?: MandateStatus;
  notes?: string | null;
}

export async function createAutopayMandate(payload: MandatePayload): Promise<AutopayMandate> {
  const { data } = await api.post<AutopayMandate>("/api/autopay-mandates/", payload);
  return data;
}

export async function updateAutopayMandate(id: number, payload: Partial<MandatePayload>): Promise<AutopayMandate> {
  const { data } = await api.put<AutopayMandate>(`/api/autopay-mandates/${id}`, payload);
  return data;
}

export async function deleteAutopayMandate(id: number): Promise<void> {
  await api.delete(`/api/autopay-mandates/${id}`);
}
