import { api } from "./client";
import { ExpiringPolicy, Vehicle, VehicleDocScanResult, VehiclePolicy } from "../types";

export async function listVehicles(): Promise<Vehicle[]> {
  const { data } = await api.get<Vehicle[]>("/api/vehicles/");
  return data;
}

export interface VehiclePayload {
  registration_number: string;
  nickname?: string | null;
  vehicle_type?: string;
  make?: string | null;
  model?: string | null;
  fuel_type?: string | null;
  purchase_date?: string | null;
  notes?: string | null;
}

export async function createVehicle(payload: VehiclePayload): Promise<Vehicle> {
  const { data } = await api.post<Vehicle>("/api/vehicles/", payload);
  return data;
}

export async function updateVehicle(id: number, payload: Partial<VehiclePayload>): Promise<Vehicle> {
  const { data } = await api.put<Vehicle>(`/api/vehicles/${id}`, payload);
  return data;
}

export async function deleteVehicle(id: number): Promise<void> {
  await api.delete(`/api/vehicles/${id}`);
}

export interface PolicyPayload {
  provider?: string | null;
  policy_number?: string | null;
  policy_type?: string;
  premium_amount?: number | null;
  start_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
}

export async function createVehiclePolicy(vehicleId: number, payload: PolicyPayload): Promise<VehiclePolicy> {
  const { data } = await api.post<VehiclePolicy>(`/api/vehicles/${vehicleId}/policies`, payload);
  return data;
}

export async function updateVehiclePolicy(policyId: number, payload: Partial<PolicyPayload>): Promise<VehiclePolicy> {
  const { data } = await api.put<VehiclePolicy>(`/api/vehicles/policies/${policyId}`, payload);
  return data;
}

export async function getExpiringPolicies(withinDays: number = 45): Promise<ExpiringPolicy[]> {
  const { data } = await api.get<ExpiringPolicy[]>("/api/vehicles/expiring", { params: { within_days: withinDays } });
  return data;
}

export async function scanVehicleDocument(docType: "rc" | "insurance", photoUri: string): Promise<VehicleDocScanResult> {
  const form = new FormData();
  form.append("file", { uri: photoUri, name: "document.jpg", type: "image/jpeg" } as unknown as Blob);
  const { data } = await api.post<VehicleDocScanResult>("/api/vehicles/scan-document", form, {
    params: { doc_type: docType },
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
