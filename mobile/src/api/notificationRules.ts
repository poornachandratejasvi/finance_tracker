import { api } from "./client";
import { AmountOperator, ConditionLogic, NotificationRule, RecordType } from "../types";

export async function listNotificationRules(): Promise<NotificationRule[]> {
  const { data } = await api.get<NotificationRule[]>("/api/notification-rules/");
  return data;
}

export interface NotificationRulePayload {
  name: string;
  trigger_type?: "match" | "absence";
  keywords?: string[];
  keyword_negate?: boolean;
  record_type?: RecordType;
  bank_id?: number | null;
  amount_operator?: AmountOperator;
  amount_value?: number;
  amount_value_max?: number;
  amount_negate?: boolean;
  condition_logic?: ConditionLogic;
  check_day_of_month?: number;
  notify_discord?: boolean;
  notify_email?: boolean;
  email_to?: string;
  notify_task?: boolean;
  is_active?: boolean;
}

export async function createNotificationRule(
  payload: NotificationRulePayload
): Promise<NotificationRule> {
  const { data } = await api.post<NotificationRule>("/api/notification-rules/", payload);
  return data;
}

export async function updateNotificationRule(
  ruleId: number,
  payload: Partial<NotificationRulePayload>
): Promise<NotificationRule> {
  const { data } = await api.put<NotificationRule>(`/api/notification-rules/${ruleId}`, payload);
  return data;
}

export async function deleteNotificationRule(ruleId: number): Promise<void> {
  await api.delete(`/api/notification-rules/${ruleId}`);
}

export async function testNotificationRule(ruleId: number): Promise<{ result: unknown }> {
  const { data } = await api.post(`/api/notification-rules/${ruleId}/test`);
  return data;
}
