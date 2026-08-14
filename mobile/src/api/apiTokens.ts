import { api } from "./client";
import { ApiToken } from "../types";

export async function listApiTokens(): Promise<ApiToken[]> {
  const { data } = await api.get<ApiToken[]>("/api/api-tokens/");
  return data;
}

export async function createApiToken(name: string): Promise<ApiToken & { token: string }> {
  const { data } = await api.post<ApiToken & { token: string }>("/api/api-tokens/", { name });
  return data;
}

export async function revokeApiToken(tokenId: number): Promise<void> {
  await api.delete(`/api/api-tokens/${tokenId}`);
}
