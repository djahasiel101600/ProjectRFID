import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Parse a datetime string as-is without timezone manipulation.
 * Since backend uses USE_TZ=False, all datetimes are already in local time.
 */
export function parseLocalDateTime(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  return new Date(dateStr);
}

/**
 * Format a datetime string to locale time string.
 */
export function formatLocalTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleTimeString();
}

/**
 * Format a datetime string to locale date/time string.
 */
export function formatLocalDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleString();
}

/**
 * ISO-style week: Monday through Sunday containing `period`.
 * Example: "Mon, Mar 16, 2026 – Sun, Mar 22, 2026"
 */
export function formatIsoWeekRangeLabel(period: string): string {
  const d = parseLocalDateTime(period);
  if (!d || isNaN(d.getTime())) return period;
  const monday = new Date(d.getTime());
  const day = monday.getDay(); // 0 = Sun … 6 = Sat
  const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const part = (date: Date) =>
    date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return `${part(monday)} – ${part(sunday)}`;
}
