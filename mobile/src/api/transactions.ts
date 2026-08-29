import { api } from "./client";
import { Transaction, TransactionListResponse, TransactionType } from "../types";

export interface ListTransactionsParams {
  skip?: number;
  limit?: number;
  bank_id?: string;
  start_date?: string;
  end_date?: string;
  transaction_type?: string;
  category?: string;
  search?: string;
  updated_since?: string;
}

export async function listTransactions(
  params: ListTransactionsParams = {}
): Promise<TransactionListResponse> {
  const { data } = await api.get<TransactionListResponse>("/api/transactions/", {
    params: { limit: 30, skip: 0, ...params },
  });
  return data;
}

export interface CreateTransactionPayload {
  bank_id: number;
  transaction_date: string; // ISO 8601
  description: string;
  amount: number;
  transaction_type: TransactionType;
  category?: string;
  notes?: string;
  from_account?: string;
  client_uuid?: string;
}

export async function createTransaction(payload: CreateTransactionPayload): Promise<Transaction> {
  const { data } = await api.post<Transaction>("/api/transactions/", payload);
  return data;
}

export interface UpdateTransactionPayload {
  description?: string;
  amount?: number;
  transaction_type?: TransactionType;
  category?: string;
  notes?: string;
  transaction_date?: string;
  from_account?: string;
}

export async function updateTransaction(id: number, payload: UpdateTransactionPayload): Promise<Transaction> {
  const { data } = await api.put<Transaction>(`/api/transactions/${id}`, payload);
  return data;
}

export async function deleteTransaction(id: number): Promise<void> {
  await api.delete(`/api/transactions/${id}`);
}

export async function confirmTransaction(id: number): Promise<void> {
  await api.post("/api/transactions/bulk-confirm", { transaction_ids: [id] });
}

export interface RecycleBinItem extends Transaction {
  deleted_at: string;
  purge_at: string;
}

export async function listRecycleBin(): Promise<RecycleBinItem[]> {
  const { data } = await api.get<RecycleBinItem[]>("/api/transactions/recycle-bin");
  return data;
}

export async function restoreTransactions(ids: (number | string)[]): Promise<{ restored: number }> {
  const { data } = await api.post("/api/transactions/recycle-bin/restore", { transaction_ids: ids });
  return data;
}

export async function purgeTransactions(ids: (number | string)[]): Promise<{ purged: number }> {
  const { data } = await api.post("/api/transactions/recycle-bin/purge", { transaction_ids: ids });
  return data;
}
