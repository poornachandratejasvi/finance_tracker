import { api } from "./client";
import { Template } from "../types";

export async function listTemplates(): Promise<Template[]> {
  const { data } = await api.get<Template[]>("/api/templates/");
  return data;
}

export interface TemplatePayload {
  name: string;
  bank_id?: number | null;
  category?: string;
  amount?: number;
  transaction_type?: string;
  description?: string;
  notes?: string;
  currency_code?: string;
  label_ids?: number[];
}

export async function createTemplate(payload: TemplatePayload): Promise<Template> {
  const { data } = await api.post<Template>("/api/templates/", payload);
  return data;
}

export async function updateTemplate(
  templateId: number,
  payload: Partial<TemplatePayload>
): Promise<Template> {
  const { data } = await api.put<Template>(`/api/templates/${templateId}`, payload);
  return data;
}

export async function deleteTemplate(templateId: number): Promise<void> {
  await api.delete(`/api/templates/${templateId}`);
}
