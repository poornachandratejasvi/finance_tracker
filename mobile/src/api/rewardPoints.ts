import { api } from "./client";
import { RewardEntryType, RewardPointEntry, RewardPointsResponse } from "../types";

export async function getRewardPoints(bankId?: number): Promise<RewardPointsResponse> {
  const { data } = await api.get<RewardPointsResponse>("/api/reward-points/", {
    params: bankId ? { bank_id: bankId } : undefined,
  });
  return data;
}

export interface RewardEntryPayload {
  bank_id: number;
  entry_type: RewardEntryType;
  points: number;
  expiry_date?: string | null;
  description?: string | null;
}

export async function createRewardEntry(payload: RewardEntryPayload): Promise<RewardPointEntry> {
  const { data } = await api.post<RewardPointEntry>("/api/reward-points/", payload);
  return data;
}

export async function deleteRewardEntry(entryId: number): Promise<void> {
  await api.delete(`/api/reward-points/${entryId}`);
}

export async function checkExpiringRewardPoints(): Promise<{ notified: number }> {
  const { data } = await api.post("/api/reward-points/check-expiring");
  return data;
}
