import { api } from "./client";
import { AIConfig } from "../types";

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
