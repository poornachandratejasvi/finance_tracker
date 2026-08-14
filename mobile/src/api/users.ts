import { api } from "./client";
import { User, UserPreferences } from "../types";

export async function updateProfile(payload: {
  full_name?: string;
  email?: string;
}): Promise<User> {
  const { data } = await api.put<User>("/api/users/me", payload);
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await api.post("/api/users/me/change-password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}

export async function getPreferences(): Promise<UserPreferences> {
  const { data } = await api.get<UserPreferences>("/api/users/me/preferences");
  return data;
}

export async function updatePreferences(
  payload: Partial<UserPreferences>
): Promise<UserPreferences> {
  const { data } = await api.put<UserPreferences>("/api/users/me/preferences", payload);
  return data;
}
