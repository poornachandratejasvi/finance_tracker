import { api } from "./client";
import { Goal, RoundupPreview, RoundupSweepResult } from "../types";

export async function listGoals(): Promise<Goal[]> {
  const { data } = await api.get<Goal[]>("/api/goals/");
  return data;
}

export interface GoalPayload {
  name: string;
  target_amount: number;
  current_amount?: number;
  target_date?: string | null;
  color?: string;
  is_active?: boolean;
  roundup_enabled?: boolean;
  roundup_to?: number;
  monthly_target?: number | null;
}

export async function getRoundupPreview(goalId: number): Promise<RoundupPreview> {
  const { data } = await api.get<RoundupPreview>(`/api/goals/${goalId}/roundup-preview`);
  return data;
}

export async function sweepRoundups(goalId: number): Promise<RoundupSweepResult> {
  const { data } = await api.post<RoundupSweepResult>(`/api/goals/${goalId}/sweep-roundups`);
  return data;
}

export async function createGoal(payload: GoalPayload): Promise<Goal> {
  const { data } = await api.post<Goal>("/api/goals/", payload);
  return data;
}

export async function updateGoal(goalId: number, payload: Partial<GoalPayload>): Promise<Goal> {
  const { data } = await api.put<Goal>(`/api/goals/${goalId}`, payload);
  return data;
}

export async function deleteGoal(goalId: number): Promise<void> {
  await api.delete(`/api/goals/${goalId}`);
}

export async function contributeToGoal(goalId: number, amount: number): Promise<Goal> {
  const { data } = await api.post<Goal>(`/api/goals/${goalId}/contribute`, { amount });
  return data;
}
