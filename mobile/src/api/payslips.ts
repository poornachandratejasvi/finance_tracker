import { api } from "./client";
import { Payslip } from "../types";

export async function listPayslips(): Promise<Payslip[]> {
  const { data } = await api.get<Payslip[]>("/api/payslips/");
  return data;
}

export async function uploadPayslip(fileUri: string, fileName: string): Promise<Payslip> {
  const form = new FormData();
  form.append("file", { uri: fileUri, name: fileName || "payslip.pdf", type: "application/pdf" } as unknown as Blob);
  const { data } = await api.post<Payslip>("/api/payslips/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deletePayslip(id: number): Promise<void> {
  await api.delete(`/api/payslips/${id}`);
}
