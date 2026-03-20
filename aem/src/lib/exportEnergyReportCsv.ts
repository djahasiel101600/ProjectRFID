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
}

/**
 * Build CSV and trigger browser download (UTF-8 with BOM for Excel).
 */
export function exportEnergyReportsToCsv(
  reports: EnergyReport[],
  options: ExportEnergyCsvOptions
): void {
  if (!reports.length) return;

  const { range, classroomLabel, formatPeriod } = options;
  const rangeLabels: Record<string, string> = {
    hour: "Hourly (Last 24 Hours)",
    day: "Daily (Last 30 Days)",
    week: "Weekly (Last 12 Weeks)",
    month: "Monthly (Last Year)",
  };

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
    `Time range,${escapeCsvCell(rangeLabels[range] ?? range)}`,
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
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safeClass = classroomLabel.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40);
  a.href = url;
  a.download = `energy-report_${range}_${safeClass}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
