import { api } from "./client";
import { Warranty, WarrantyCategory, PolicyDocument } from "../types";

export async function listWarranties(category?: string): Promise<Warranty[]> {
  const { data } = await api.get<Warranty[]>("/api/warranties/", { params: { category: category || undefined } });
  return data;
}

export interface WarrantyPayload {
  item_name: string;
  category?: WarrantyCategory;
  vendor?: string | null;
  purchase_date?: string | null;
  purchase_amount?: number | null;
  warranty_expiry?: string | null;
  amc_expiry?: string | null;
  amc_provider?: string | null;
  notes?: string | null;
}

export async function createWarranty(payload: WarrantyPayload): Promise<Warranty> {
  const { data } = await api.post<Warranty>("/api/warranties/", payload);
  return data;
}

export async function updateWarranty(id: number, payload: Partial<WarrantyPayload>): Promise<Warranty> {
  const { data } = await api.put<Warranty>(`/api/warranties/${id}`, payload);
  return data;
}

export async function deleteWarranty(id: number): Promise<void> {
  await api.delete(`/api/warranties/${id}`);
}

export async function listWarrantyDocuments(warrantyId: number): Promise<PolicyDocument[]> {
  const { data } = await api.get<PolicyDocument[]>(`/api/warranties/${warrantyId}/documents`);
  return data;
}

export async function uploadWarrantyDocument(warrantyId: number, documentType: string, title: string, photoUri: string): Promise<PolicyDocument> {
  const form = new FormData();
  form.append("file", { uri: photoUri, name: "document.jpg", type: "image/jpeg" } as unknown as Blob);
  const { data } = await api.post<PolicyDocument>(`/api/warranties/${warrantyId}/documents`, form, {
    params: { document_type: documentType, title },
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deleteWarrantyDocument(warrantyId: number, documentId: number): Promise<void> {
  await api.delete(`/api/warranties/${warrantyId}/documents/${documentId}`);
}
