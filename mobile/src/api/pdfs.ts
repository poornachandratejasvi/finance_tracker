import { api } from "./client";
import { PdfListResponse, StatementDashboardBank } from "../types";

export async function fetchStatementDashboard(): Promise<StatementDashboardBank[]> {
  const { data } = await api.get<{ banks: StatementDashboardBank[] }>(
    "/api/banks/statement-dashboard"
  );
  return data.banks;
}

export async function listPdfs(params?: {
  bank_id?: string;
  is_processed?: string;
  skip?: number;
  limit?: number;
}): Promise<PdfListResponse> {
  const { data } = await api.get<PdfListResponse>("/api/pdfs/", { params });
  return data;
}

export async function reprocessPdf(pdfId: number): Promise<void> {
  await api.post(`/api/pdfs/${pdfId}/reprocess`);
}

export async function testPdfPassword(
  pdfId: number,
  password: string
): Promise<{ success: boolean; message?: string }> {
  const { data } = await api.post("/api/pdfs/test-pdf-password", null, {
    params: { pdf_id: pdfId, password },
  });
  return data;
}

export async function updatePdfPassword(
  pdfId: number,
  password: string,
  applyToBank: boolean
): Promise<{ success: boolean }> {
  const { data } = await api.post("/api/pdfs/update-pdf-password", null, {
    params: { pdf_id: pdfId, password, apply_to_bank: applyToBank },
  });
  return data;
}
