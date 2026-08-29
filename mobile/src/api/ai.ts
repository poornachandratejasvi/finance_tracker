import { api } from "./client";
import { AIConfig, AnomaliesResponse, PredictionsResponse } from "../types";

export async function getAIConfig(): Promise<AIConfig> {
  const { data } = await api.get<AIConfig>("/api/ai/config");
  return data;
}

export interface AIConfigUpdatePayload {
  providers?: string[];
  claude?: { model?: string };
  gemini?: { model?: string };
  ollama?: { model?: string; base_url?: string };
  features?: Partial<AIConfig["features"]>;
  claude_key?: string;
  gemini_key?: string;
}

export async function updateAIConfig(payload: AIConfigUpdatePayload): Promise<AIConfig> {
  const { data } = await api.put<AIConfig>("/api/ai/config", payload);
  return data;
}

export async function testAIProvider(
  provider: string
): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post("/api/ai/test", { provider });
  return data;
}

export interface AskAiResponse {
  answer: string;
  ai: boolean;
}

export async function askAI(question: string): Promise<AskAiResponse> {
  const { data } = await api.post<AskAiResponse>("/api/ai/query", { question });
  return data;
}

export async function getPredictions(daysAhead: number = 45): Promise<PredictionsResponse> {
  const { data } = await api.get<PredictionsResponse>("/api/ai/predictions", { params: { days_ahead: daysAhead } });
  return data;
}

// Statistical (free) by default; pass useAi=true to refine with the configured provider.
export async function getAnomalies(useAi: boolean = false): Promise<AnomaliesResponse> {
  const { data } = await api.get<AnomaliesResponse>("/api/ai/anomalies", { params: { use_ai: useAi } });
  return data;
}

export interface QuickAddDraft {
  amount: number;
  description: string;
  transaction_type: "debit" | "credit";
  category: string | null;
  transaction_date: string; // YYYY-MM-DD
  bank_id: number | null;
}

// Parses a free-text sentence (e.g. "Spent 450 on coffee at Starbucks yesterday")
// into a draft transaction for the user to review before saving -- never creates
// anything itself, same pattern as the receipt-scan prefill.
export async function quickAddParse(text: string): Promise<QuickAddDraft> {
  const { data } = await api.post<QuickAddDraft>("/api/ai/quick-add", { text });
  return data;
}
