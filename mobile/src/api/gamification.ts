import { api } from "./client";
import { ZeroSpendStreaks } from "../types";

export async function getZeroSpendStreaks(lookbackDays: number = 180): Promise<ZeroSpendStreaks> {
  const { data } = await api.get<ZeroSpendStreaks>("/api/gamification/streaks", {
    params: { lookback_days: lookbackDays },
  });
  return data;
}
