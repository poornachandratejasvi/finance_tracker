import { api } from "./client";
import { AdminUser } from "../types";

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await api.get<AdminUser[]>("/api/users/");
  return data;
}

export interface AdminUserCreatePayload {
  username: string;
  email: string;
  password: string;
  full_name?: string;
  role?: string;
}

export async function createUser(payload: AdminUserCreatePayload): Promise<AdminUser> {
  const { data } = await api.post<AdminUser>("/api/users/", payload);
  return data;
}

export interface AdminUserUpdatePayload {
  email?: string;
  full_name?: string;
  role?: string;
  is_active?: boolean;
  password?: string;
}

export async function updateUser(
  userId: number,
  payload: AdminUserUpdatePayload
): Promise<AdminUser> {
  const { data } = await api.put<AdminUser>(`/api/users/${userId}`, payload);
  return data;
}

export async function deleteUser(userId: number): Promise<void> {
  await api.delete(`/api/users/${userId}`);
}

export async function shareHouseholdWith(
  userId: number,
  otherUserId: number
): Promise<{ success: boolean; household_id: number }> {
  const { data } = await api.post(`/api/users/${userId}/share-household-with/${otherUserId}`);
  return data;
}

export async function leaveHousehold(
  userId: number
): Promise<{ success: boolean; household_id: number }> {
  const { data } = await api.post(`/api/users/${userId}/leave-household`);
  return data;
}
