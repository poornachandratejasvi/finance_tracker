import { api } from "./client";

export async function registerPushToken(token: string, platform: "ios" | "android"): Promise<void> {
  await api.post("/api/push-tokens/", { token, platform });
}

export async function unregisterPushToken(token: string): Promise<void> {
  await api.delete(`/api/push-tokens/${encodeURIComponent(token)}`);
}
