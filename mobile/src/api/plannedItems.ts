import { api } from "./client";
import {
  PlannedDirection,
  PlannedItem,
  PlannedItemCandidate,
  PlannedItemOccurrence,
  PlannedItemsSummary,
  PlannedRecurrence,
} from "../types";

export async function listPlannedItems(): Promise<PlannedItem[]> {
  const { data } = await api.get<PlannedItem[]>("/api/planned-items/");
  return data;
}

export interface PlannedItemPayload {
  name: string;
  direction?: PlannedDirection;
  amount?: number | null;
  match_hint?: string | null;
  due_date: string;
  recurrence?: PlannedRecurrence;
  notes?: string | null;
}

export async function createPlannedItem(payload: PlannedItemPayload): Promise<PlannedItem> {
  const { data } = await api.post<PlannedItem>("/api/planned-items/", payload);
  return data;
}

export async function updatePlannedItem(id: number, payload: Partial<PlannedItemPayload> & { is_active?: boolean }): Promise<PlannedItem> {
  const { data } = await api.put<PlannedItem>(`/api/planned-items/${id}`, payload);
  return data;
}

export async function deletePlannedItem(id: number): Promise<void> {
  await api.delete(`/api/planned-items/${id}`);
}

export async function getPlannedItemCandidates(occurrenceId: number): Promise<PlannedItemCandidate[]> {
  const { data } = await api.get<PlannedItemCandidate[]>(`/api/planned-items/occurrences/${occurrenceId}/candidates`);
  return data;
}

export async function confirmPlannedItemMatch(occurrenceId: number, transactionId: number): Promise<PlannedItemOccurrence> {
  const { data } = await api.post<PlannedItemOccurrence>(`/api/planned-items/occurrences/${occurrenceId}/confirm`, {
    transaction_id: transactionId,
  });
  return data;
}

export async function closePlannedItemOccurrence(occurrenceId: number): Promise<PlannedItemOccurrence> {
  const { data } = await api.post<PlannedItemOccurrence>(`/api/planned-items/occurrences/${occurrenceId}/close`);
  return data;
}

export async function getPlannedItemsSummary(month?: string): Promise<PlannedItemsSummary> {
  const { data } = await api.get<PlannedItemsSummary>("/api/planned-items/summary", {
    params: month ? { month } : {},
  });
  return data;
}
