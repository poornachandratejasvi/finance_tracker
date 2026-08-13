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
}

export async function createTransaction(payload: CreateTransactionPayload): Promise<Transaction> {
  const { data } = await api.post<Transaction>("/api/transactions/", payload);
  return data;
}
