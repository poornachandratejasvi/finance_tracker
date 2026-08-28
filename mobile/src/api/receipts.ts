import { api } from "./client";

export interface ReceiptScanResult {
  success: boolean;
  reason?: "no_text" | "no_extraction";
  message?: string;
  raw_text?: string;
  amount?: number;
  description?: string;
  transaction_date?: string | null;
  category?: string | null;
  transaction_type?: "debit";
}

export async function scanReceipt(photoUri: string): Promise<ReceiptScanResult> {
  const form = new FormData();
  // React Native's fetch/FormData accepts this {uri,name,type} shape in place of a real Blob.
  form.append("file", {
    uri: photoUri,
    name: "receipt.jpg",
    type: "image/jpeg",
  } as unknown as Blob);

  const { data } = await api.post<ReceiptScanResult>("/api/receipts/scan", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
