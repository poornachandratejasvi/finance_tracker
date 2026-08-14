import { api } from "./client";

export async function getSystemInfo(): Promise<
  { cpu_percent: number; memory_percent: number; disk_percent: number } | { message: string; info: string }
> {
  const { data } = await api.get("/api/logs/system");
  return data;
}

export async function getBackendLogs(lines = 200): Promise<{ logs: string; status: string }> {
  const { data } = await api.get("/api/logs/backend", { params: { lines } });
  return data;
}
