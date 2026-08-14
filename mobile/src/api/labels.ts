import { api } from "./client";
import { Label } from "../types";

export async function listLabels(): Promise<Label[]> {
  const { data } = await api.get<Label[]>("/api/labels/");
  return data;
}

export interface LabelPayload {
  name: string;
  color?: string;
  auto_keywords?: string[];
}

export async function createLabel(payload: LabelPayload): Promise<Label> {
  const { data } = await api.post<Label>("/api/labels/", payload);
  return data;
}

export async function updateLabel(labelId: number, payload: Partial<LabelPayload>): Promise<Label> {
  const { data } = await api.put<Label>(`/api/labels/${labelId}`, payload);
  return data;
}

export async function deleteLabel(labelId: number): Promise<void> {
  await api.delete(`/api/labels/${labelId}`);
}
