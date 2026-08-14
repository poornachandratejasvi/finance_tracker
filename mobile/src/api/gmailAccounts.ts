import { api } from "./client";
import { GmailAccountStatus } from "../types";

export async function getGmailStatus(): Promise<{ accounts: GmailAccountStatus[]; total: number }> {
  const { data } = await api.get("/api/gmail-accounts/status");
  return data;
}

export async function getGmailAuthUrl(): Promise<{ auth_url: string; state: string }> {
  const { data } = await api.get("/api/oauth/gmail/auth-url");
  return data;
}

export async function checkGmailAccountNow(accountId: number): Promise<GmailAccountStatus> {
  const { data } = await api.post(`/api/gmail-accounts/${accountId}/check-now`);
  return data;
}

export async function disconnectGmailAccount(accountId: number): Promise<void> {
  await api.delete(`/api/gmail-accounts/${accountId}`);
}

export async function syncAlertsNow(): Promise<{ created: number }> {
  const { data } = await api.post("/api/gmail-accounts/sync-alerts-now");
  return data;
}
