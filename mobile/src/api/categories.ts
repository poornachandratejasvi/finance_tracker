import { api } from "./client";
import { Category } from "../types";

export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>("/api/categories/");
  return data;
}

export interface CategoryPayload {
  name: string;
  icon?: string;
  color?: string;
  kind?: string;
}

export async function createCategory(payload: CategoryPayload): Promise<Category> {
  const { data } = await api.post<Category>("/api/categories/", payload);
  return data;
}

export async function updateCategory(
  categoryId: number,
  payload: Partial<CategoryPayload>
): Promise<Category> {
  const { data } = await api.put<Category>(`/api/categories/${categoryId}`, payload);
  return data;
}

export async function deleteCategory(categoryId: number): Promise<void> {
  await api.delete(`/api/categories/${categoryId}`);
}
