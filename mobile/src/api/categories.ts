import { api } from "./client";
import { Category } from "../types";

export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>("/api/categories/");
  return data;
}
