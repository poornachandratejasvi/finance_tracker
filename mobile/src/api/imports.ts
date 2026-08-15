import { api } from "./client";

export interface ImportPreview {
  columns: string[];
  rows: string[][];
  total_rows: number;
  suggested_mapping: Record<string, string | null>;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string | null;
}

export async function previewImportFile(file: PickedFile): Promise<ImportPreview> {
  const form = new FormData();
  // React Native's fetch/FormData accepts this {uri,name,type} shape in place of a real Blob.
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || "application/octet-stream",
  } as unknown as Blob);

  const { data } = await api.post<ImportPreview>("/api/imports/preview", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export interface ImportMapping {
  date: string;
  description: string;
  amount: string;
  type?: string;
  category?: string;
  notes?: string;
}

export interface ImportCommitPayload {
  bank_id: number;
  columns: string[];
  rows: string[][];
  mapping: ImportMapping;
  skip_duplicates?: boolean;
}

export interface ImportCommitResult {
  created: number;
  skipped_duplicates: number;
  errors: Array<{ row: number; message: string }>;
}

export async function commitImport(payload: ImportCommitPayload): Promise<ImportCommitResult> {
  const { data } = await api.post<ImportCommitResult>("/api/imports/commit", payload);
  return data;
}
