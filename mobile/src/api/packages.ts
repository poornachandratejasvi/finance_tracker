import { api } from "./client";
import { Carrier, Package, PackageStatus } from "../types";

export async function getPackageCarriers(): Promise<Carrier[]> {
  const { data } = await api.get<Carrier[]>("/api/packages/carriers");
  return data;
}

export async function listPackages(): Promise<Package[]> {
  const { data } = await api.get<Package[]>("/api/packages/");
  return data;
}

export interface PackagePayload {
  carrier: string;
  tracking_number?: string | null;
  merchant?: string | null;
  order_id?: string | null;
  item_description?: string | null;
  status?: PackageStatus;
  expected_delivery_date?: string | null;
  tracking_url?: string | null;
  notes?: string | null;
}

export async function createPackage(payload: PackagePayload): Promise<Package> {
  const { data } = await api.post<Package>("/api/packages/", payload);
  return data;
}

export async function updatePackage(id: number, payload: Partial<PackagePayload>): Promise<Package> {
  const { data } = await api.put<Package>(`/api/packages/${id}`, payload);
  return data;
}

export async function deletePackage(id: number): Promise<void> {
  await api.delete(`/api/packages/${id}`);
}

export async function refreshPackageNow(id: number): Promise<Package> {
  const { data } = await api.post<Package>(`/api/packages/${id}/refresh-now`);
  return data;
}
