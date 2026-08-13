import { api, clearSession } from "./client";
import { User } from "../types";

export async function fetchCurrentUser(): Promise<User> {
  const { data } = await api.get<User>("/api/users/me");
  return data;
}

export async function logout(): Promise<void> {
  await clearSession();
}
