import { api } from "./client";
import { Currency } from "../types";

export async function listCurrencies(): Promise<Currency[]> {
  const { data } = await api.get<Currency[]>("/api/currencies/");
  return data;
}

export interface CurrencyPayload {
  code: string;
  symbol?: string;
  name?: string;
  rate_to_base?: number;
  is_base?: boolean;
}

export async function createCurrency(payload: CurrencyPayload): Promise<Currency> {
  const { data } = await api.post<Currency>("/api/currencies/", payload);
  return data;
}

export async function updateCurrency(
  currencyId: number,
  payload: Partial<CurrencyPayload>
): Promise<Currency> {
  const { data } = await api.put<Currency>(`/api/currencies/${currencyId}`, payload);
  return data;
}

export async function deleteCurrency(currencyId: number): Promise<void> {
  await api.delete(`/api/currencies/${currencyId}`);
}
