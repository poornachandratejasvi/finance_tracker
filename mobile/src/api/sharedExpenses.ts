import { api } from "./client";
import { HouseholdMember, SharedExpense } from "../types";

export async function listHouseholdMembers(): Promise<HouseholdMember[]> {
  const { data } = await api.get<HouseholdMember[]>("/api/shared-expenses/members");
  return data;
}

export async function listSharedExpenses(): Promise<SharedExpense[]> {
  const { data } = await api.get<SharedExpense[]>("/api/shared-expenses/");
  return data;
}

export interface SharedExpensePayload {
  description: string;
  total_amount: number;
  expense_date: string;
  splits: { user_id: number; amount: number }[];
}

export async function createSharedExpense(payload: SharedExpensePayload): Promise<SharedExpense> {
  const { data } = await api.post<SharedExpense>("/api/shared-expenses/", payload);
  return data;
}

export async function settleSharedExpenseShare(expenseId: number, shareId: number): Promise<SharedExpense> {
  const { data } = await api.post<SharedExpense>(`/api/shared-expenses/${expenseId}/shares/${shareId}/settle`);
  return data;
}

export async function deleteSharedExpense(id: number): Promise<void> {
  await api.delete(`/api/shared-expenses/${id}`);
}
