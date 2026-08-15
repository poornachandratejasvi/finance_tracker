import { api } from "./client";
import { Goal } from "../types";

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
