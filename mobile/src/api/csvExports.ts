import { api } from "./client";

export async function generateCsv(pdfId: number): Promise<{ success: boolean; row_count: number }> {
  const { data } = await api.post(`/api/csv/pdfs/${pdfId}/generate`);
  return data;
}

export async function emailCsv(
  pdfId: number,
  toEmail?: string
): Promise<{ success: boolean; sent_to: string }> {
  const { data } = await api.post(`/api/csv/pdfs/${pdfId}/email`, { to_email: toEmail });
  return data;
}

export async function emailLatestForBank(
  bankId: number,
  toEmail?: string
): Promise<{ success: boolean; sent_to: string }> {
  const { data } = await api.post(`/api/csv/banks/${bankId}/email-latest`, { to_email: toEmail });
  return data;
}

export async function generateAllForBank(
  bankId: number
): Promise<{ success: boolean; processed: number; queued: number; message: string }> {
  const { data } = await api.post("/api/csv/pdfs/generate-all", null, { params: { bank_id: bankId } });
  return data;
}

export function zipDownloadPath(bankId: number): string {
  return `/api/csv/pdfs/download-zip?bank_id=${bankId}`;
}

export function csvDownloadPath(pdfId: number): string {
  return `/api/csv/pdfs/${pdfId}/download`;
}
