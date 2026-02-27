import { addDays, format, parseISO, subDays } from "date-fns";

export function toDateTimeLocal(isoValue: string) {
  if (!isoValue) return "";

  const date = parseISO(isoValue);
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function toDateOnly(isoValue: string) {
  if (!isoValue) return "";

  const date = parseISO(isoValue);
  return format(date, "yyyy-MM-dd");
}

export function allDayEndToInclusive(endDate: string) {
  return format(subDays(parseISO(`${endDate}T00:00:00`), 1), "yyyy-MM-dd");
}

export function allDayEndToExclusive(endDate: string) {
  return format(addDays(parseISO(`${endDate}T00:00:00`), 1), "yyyy-MM-dd");
}

export function toUtcRruleDate(dateValue: string) {
  const date = new Date(`${dateValue}T23:59:59.000Z`);
  return format(date, "yyyyMMdd'T'HHmmss'Z'");
}
