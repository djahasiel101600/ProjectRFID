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
