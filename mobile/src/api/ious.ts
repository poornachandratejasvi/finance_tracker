import { api } from "./client";
import { Iou, IouDirection, IouListResponse, IouPayment } from "../types";

export async function listIOUs(): Promise<IouListResponse> {
  const { data } = await api.get<IouListResponse>("/api/ious/");
  return data;
}

export interface IouPayload {
  person_name: string;
  direction: IouDirection;
  principal_amount: number;
  iou_date: string;
  due_date?: string | null;
  notes?: string | null;
}

export async function createIOU(payload: IouPayload): Promise<Iou> {
  const { data } = await api.post<Iou>("/api/ious/", payload);
  return data;
}

export async function updateIOU(id: number, payload: { person_name?: string; due_date?: string | null; notes?: string | null; status?: string }): Promise<Iou> {
  const { data } = await api.put<Iou>(`/api/ious/${id}`, payload);
  return data;
}

export async function deleteIOU(id: number): Promise<void> {
  await api.delete(`/api/ious/${id}`);
}

export async function listIOUPayments(iouId: number): Promise<IouPayment[]> {
  const { data } = await api.get<IouPayment[]>(`/api/ious/${iouId}/payments`);
  return data;
}

export async function recordIOUPayment(iouId: number, amount: number, paymentDate: string, notes?: string | null): Promise<Iou> {
  const { data } = await api.post<Iou>(`/api/ious/${iouId}/record-payment`, { amount, payment_date: paymentDate, notes: notes || null });
  return data;
}
