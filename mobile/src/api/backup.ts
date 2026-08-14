import { api } from "./client";
import { BackupConfig, BackupHistoryEntry, BackupStatus } from "../types";

export async function getBackupStatus(): Promise<BackupStatus> {
  const { data } = await api.get<BackupStatus>("/api/backup/status");
  return data;
}

export async function getBackupHistory(): Promise<BackupHistoryEntry[]> {
  const { data } = await api.get<BackupHistoryEntry[]>("/api/backup/history");
  return data;
}

export async function runBackup(destination?: "local" | "drive"): Promise<BackupHistoryEntry> {
  const { data } = await api.post<BackupHistoryEntry>("/api/backup/run", { destination });
  return data;
}

export async function updateBackupConfig(
  payload: Partial<BackupConfig>
): Promise<BackupConfig> {
  const { data } = await api.put<BackupConfig>("/api/backup/config", payload);
  return data;
}

export async function getDriveAuthUrl(): Promise<{ auth_url: string; configured: boolean }> {
  const { data } = await api.get("/api/backup/google/auth-url");
  return data;
}

export async function disconnectDrive(): Promise<{ success: boolean; drive_connected: boolean }> {
  const { data } = await api.post("/api/backup/google/disconnect");
  return data;
}
