import { api } from "./client";

export interface ReceiptLineItem {
  name: string;
  amount: number;
}

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
  items?: ReceiptLineItem[];
  tax?: number | null;
  tip?: number | null;
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

// Archives the original receipt photo to Paperless-ngx (if configured -- see
// Settings -> External Accounts) and links it to the transaction the scan-to-
// draft flow above created. scanReceipt() only extracts data and discards the
// photo, so this is a separate call once the reviewed transaction is actually
// saved.
export async function attachReceipt(transactionId: number, photoUri: string): Promise<void> {
  const form = new FormData();
  form.append("file", {
    uri: photoUri,
    name: "receipt.jpg",
    type: "image/jpeg",
  } as unknown as Blob);

  await api.post(`/api/transactions/${transactionId}/attach-receipt`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}
