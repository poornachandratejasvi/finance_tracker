import { api } from "./client";
import { SyncLog } from "../types";

export async function startSync(params?: {
  sync_type?: string;
  gmail_account_id?: number;
  bank_id?: number;
}): Promise<{ sync_log_id: number; status: string }> {
  const { data } = await api.post("/api/sync/", params || {});
  return data;
}

export async function fetchRecentSyncs(limit = 10): Promise<SyncLog[]> {
  const { data } = await api.get<SyncLog[]>("/api/sync/recent", { params: { limit } });
  return data;
}

export async function fetchActiveSyncs(): Promise<SyncLog[]> {
  const { data } = await api.get<SyncLog[]>("/api/sync/active");
  return data;
}

export async function clearStuckSyncs(): Promise<{ cleared: number }> {
  const { data } = await api.post("/api/sync/clear-stuck");
  return data;
}
