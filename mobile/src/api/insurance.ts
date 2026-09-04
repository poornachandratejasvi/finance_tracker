import { api } from "./client";
import { InsurancePolicy, InsurancePolicyType, PolicyDocument, PremiumFrequency } from "../types";

export async function listInsurancePolicies(policyType?: string): Promise<InsurancePolicy[]> {
  const { data } = await api.get<InsurancePolicy[]>("/api/insurance/", { params: { policy_type: policyType || undefined } });
  return data;
}

export interface InsurancePolicyPayload {
  policy_type?: InsurancePolicyType;
  provider?: string | null;
  policy_number?: string | null;
  insured_name?: string | null;
  premium_amount?: number | null;
  premium_frequency?: PremiumFrequency;
  coverage_amount?: number | null;
  issued_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export async function createInsurancePolicy(payload: InsurancePolicyPayload): Promise<InsurancePolicy> {
  const { data } = await api.post<InsurancePolicy>("/api/insurance/", payload);
  return data;
}

export async function updateInsurancePolicy(id: number, payload: Partial<InsurancePolicyPayload>): Promise<InsurancePolicy> {
  const { data } = await api.put<InsurancePolicy>(`/api/insurance/${id}`, payload);
  return data;
}

export async function deleteInsurancePolicy(id: number): Promise<void> {
  await api.delete(`/api/insurance/${id}`);
}

export async function listPolicyDocuments(policyId: number): Promise<PolicyDocument[]> {
  const { data } = await api.get<PolicyDocument[]>(`/api/insurance/${policyId}/documents`);
  return data;
}

export async function uploadPolicyDocument(policyId: number, documentType: string, title: string, photoUri: string): Promise<PolicyDocument> {
  const form = new FormData();
  form.append("file", { uri: photoUri, name: "document.jpg", type: "image/jpeg" } as unknown as Blob);
  const { data } = await api.post<PolicyDocument>(`/api/insurance/${policyId}/documents`, form, {
    params: { document_type: documentType, title },
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deletePolicyDocument(policyId: number, documentId: number): Promise<void> {
  await api.delete(`/api/insurance/${policyId}/documents/${documentId}`);
}
