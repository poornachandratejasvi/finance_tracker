import { api } from "./client";
import { ScheduleConfig, Watcher, WatcherSuggestion } from "../types";

export async function getScheduleConfig(): Promise<ScheduleConfig> {
  const { data } = await api.get<ScheduleConfig>("/api/settings/schedule");
  return data;
}

export async function saveScheduleConfig(
  patch: Partial<ScheduleConfig>
): Promise<ScheduleConfig> {
  const { data } = await api.post<ScheduleConfig>("/api/settings/schedule", patch);
  return data;
}

export async function getDiscordWebhook(): Promise<{ webhook_url: string | null }> {
  const { data } = await api.get("/api/settings/discord-webhook");
  return data;
}

export async function saveDiscordWebhook(webhookUrl: string): Promise<{ webhook_url: string | null }> {
  const { data } = await api.post("/api/settings/discord-webhook", { webhook_url: webhookUrl });
  return data;
}

export async function testDiscordWebhook(): Promise<{ success: boolean; message?: string }> {
  const { data } = await api.post("/api/settings/discord-webhook/test");
  return data;
}

export async function getNotifyUrls(): Promise<{ urls: string[] }> {
  const { data } = await api.get("/api/settings/notify-urls");
  return data;
}

export async function saveNotifyUrls(urls: string[]): Promise<{ success: boolean; count: number }> {
  const { data } = await api.post("/api/settings/notify-urls", { urls });
  return data;
}

export async function testNotifyUrls(): Promise<{ success: boolean; message?: string }> {
  const { data } = await api.post("/api/settings/notify-urls/test");
  return data;
}

export async function listWatchers(): Promise<Watcher[]> {
  const { data } = await api.get<Watcher[]>("/api/watchers/");
  return data;
}

export interface WatcherPayload {
  name: string;
  match_keywords: string[];
  match_amount?: number | null;
  frequency?: string;
  is_active?: boolean;
}

export async function createWatcher(payload: WatcherPayload): Promise<Watcher> {
  const { data } = await api.post<Watcher>("/api/watchers/", payload);
  return data;
}

export async function updateWatcher(
  watcherId: number,
  payload: Partial<WatcherPayload>
): Promise<Watcher> {
  const { data } = await api.put<Watcher>(`/api/watchers/${watcherId}`, payload);
  return data;
}

export async function deleteWatcher(watcherId: number): Promise<void> {
  await api.delete(`/api/watchers/${watcherId}`);
}

export async function detectRecurringWatchers(): Promise<WatcherSuggestion[]> {
  const { data } = await api.get<WatcherSuggestion[]>("/api/watchers/detect-recurring");
  return data;
}

export async function runWatchersNow(): Promise<{ success: boolean }> {
  const { data } = await api.post("/api/watchers/run-now");
  return data;
}
