import type { EnergyReport } from "../types";

function escapeCsvCell(val: string | number): string {
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface ExportEnergyCsvOptions {
  range: "hour" | "day" | "week" | "month";
  classroomLabel: string;
  /** Human-readable period label (same as table) */
  formatPeriod: (periodIso: string) => string;
  /** ISO date string (YYYY-MM-DD) for custom range start */
  start?: string;
  /** ISO date string (YYYY-MM-DD) for custom range end */
  end?: string;
}

/**
 * Build CSV and trigger browser download (UTF-8 with BOM for Excel).
 */
export function exportEnergyReportsToCsv(
  reports: EnergyReport[],
  options: ExportEnergyCsvOptions
): void {
  if (!reports.length) return;

  const { range, classroomLabel, formatPeriod, start, end } = options;
  const rangeLabels: Record<string, string> = {
    hour: "Hourly (Last 24 Hours)",
    day: "Daily (Last 30 Days)",
    week: "Weekly (Last 12 Weeks)",
    month: "Monthly (Last Year)",
  };

  const windowLabel =
    start || end
      ? `${start ?? "…"} to ${end ?? "…"}`
      : rangeLabels[range] ?? range;

  const header = [
    "Period",
    "Period (ISO)",
    "Total kWh",
    "Avg W",
    "Max W",
    "Min W",
    "Reading count",
  ];

  const rows = reports.map((r) => [
    escapeCsvCell(formatPeriod(r.period)),
    escapeCsvCell(r.period),
    escapeCsvCell(Number(r.total_kwh).toFixed(4)),
    escapeCsvCell(Number(r.avg_watts).toFixed(2)),
    escapeCsvCell(Number(r.max_watts).toFixed(2)),
    escapeCsvCell(Number(r.min_watts).toFixed(2)),
    escapeCsvCell(r.reading_count),
  ]);

  const metaLines = [
    `Classroom,${escapeCsvCell(classroomLabel)}`,
    `Time range,${escapeCsvCell(windowLabel)}`,
    "",
  ];

  const csvBody = [
    ...metaLines,
    header.join(","),
    ...rows.map((cells) => cells.join(",")),
  ].join("\r\n");

  const bom = "\ufeff";
  const blob = new Blob([bom + csvBody], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeClass = classroomLabel.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40);
  const filenameDatePart =
    start || end
      ? `${start ?? "from"}_to_${end ?? "now"}`
      : new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `energy-report_${range}_${safeClass}_${filenameDatePart}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
