import { api } from "./client";
import { Bank } from "../types";

export async function listBanks(): Promise<Bank[]> {
  const { data } = await api.get<Bank[]>("/api/banks/");
  return data;
}
