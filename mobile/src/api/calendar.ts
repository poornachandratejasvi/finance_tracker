import { api } from "./client";
import { CalendarItem } from "../types";

export async function getCalendar(daysAhead = 60, daysBack = 60): Promise<CalendarItem[]> {
  const { data } = await api.get<CalendarItem[]>("/api/calendar/", {
    params: { days_ahead: daysAhead, days_back: daysBack },
  });
  return data;
}
