import { api } from "./client";

export interface SearchResultItem {
  id: number;
  type: "transaction" | "bank" | "category" | "label" | "template" | "reward_point";
  title: string;
  subtitle: string;
}

export interface SearchResponse {
  transactions: SearchResultItem[];
  banks: SearchResultItem[];
  categories: SearchResultItem[];
  labels: SearchResultItem[];
  templates: SearchResultItem[];
  reward_points: SearchResultItem[];
}

export async function globalSearch(q: string): Promise<SearchResponse> {
  const { data } = await api.get<SearchResponse>("/api/search/", { params: { q } });
  return data;
}
