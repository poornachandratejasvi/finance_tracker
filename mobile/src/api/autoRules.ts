import { api } from "./client";
import { AutoRule, RecordType } from "../types";

export async function listAutoRules(): Promise<AutoRule[]> {
  const { data } = await api.get<AutoRule[]>("/api/rules/");
  return data;
}

export interface AutoRulePayload {
  name: string;
  keywords: string[];
  record_type?: RecordType;
  category?: string;
  label_ids?: number[];
  priority?: number;
  is_active?: boolean;
  notify_discord?: boolean;
}

export async function createAutoRule(payload: AutoRulePayload): Promise<AutoRule> {
  const { data } = await api.post<AutoRule>("/api/rules/", payload);
  return data;
}

export async function updateAutoRule(
  ruleId: number,
  payload: Partial<AutoRulePayload>
): Promise<AutoRule> {
  const { data } = await api.put<AutoRule>(`/api/rules/${ruleId}`, payload);
  return data;
}

export async function deleteAutoRule(ruleId: number): Promise<void> {
  await api.delete(`/api/rules/${ruleId}`);
}
