import type { AttendanceSession } from "../types";

function escapeCsvCell(val: string | number | null): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface ExportAttendanceCsvOptions {
  classroomLabel: string;
  teacherLabel: string;
  startDate: string;
  endDate: string;
  statusLabel: string;
  /** Converts an ISO datetime string to a localized time string (HH:MM AM/PM) */
  formatTime: (iso: string | null) => string;
}

export function exportAttendanceToCsv(
  sessions: AttendanceSession[],
  options: ExportAttendanceCsvOptions
): void {
  if (!sessions.length) return;

  const { classroomLabel, teacherLabel, startDate, endDate, statusLabel, formatTime } = options;

  const dateRangeLabel =
    startDate && endDate
      ? `${startDate} – ${endDate}`
      : startDate
        ? `From ${startDate}`
        : endDate
          ? `Up to ${endDate}`
          : "All dates";

  const header = [
    "Teacher",
    "Classroom",
    "Date",
    "Time In",
    "Time Out",
    "Status",
    "Duration (min)",
    "Excess (min)",
    "kWh",
  ];

  const rows = sessions.map((s) => {
    const excess = getExcessMinutes(s);
    return [
      escapeCsvCell(s.teacher_name),
      escapeCsvCell(s.classroom_name),
      escapeCsvCell(s.date),
      escapeCsvCell(formatTime(s.time_in)),
      escapeCsvCell(formatTime(s.time_out)),
      escapeCsvCell(s.status_display || s.status),
      escapeCsvCell(s.duration_minutes ?? ""),
      escapeCsvCell(excess ?? ""),
      escapeCsvCell(s.total_kwh != null ? Number(s.total_kwh).toFixed(4) : ""),
    ];
  });

  const metaLines = [
    `Classroom,${escapeCsvCell(classroomLabel)}`,
    `Teacher,${escapeCsvCell(teacherLabel)}`,
    `Date Range,${escapeCsvCell(dateRangeLabel)}`,
    `Status,${escapeCsvCell(statusLabel)}`,
    "",
  ];

  const csvBody = [
    ...metaLines,
    header.join(","),
    ...rows.map((cells) => cells.join(",")),
  ].join("\r\n");

  const bom = "\ufeff";
  const blob = new Blob([bom + csvBody], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safeClass = classroomLabel.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 40);
  const safeStart = startDate.replace(/[^0-9-]/g, "") || "all";
  const safeEnd = endDate.replace(/[^0-9-]/g, "") || "all";
  a.href = url;
  a.download = `attendance_${safeStart}_${safeEnd}_${safeClass}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Compute excess minutes beyond expected_out (mirrors page logic). */
function getExcessMinutes(session: AttendanceSession): number | null {
  if (!session.expected_out) return null;
  const expected = new Date(session.expected_out);
  if (isNaN(expected.getTime())) return null;
  const endTime =
    session.status === "IN"
      ? new Date()
      : session.time_out
        ? new Date(session.time_out)
        : null;
  if (!endTime || isNaN(endTime.getTime()) || endTime <= expected) return null;
  return Math.floor((endTime.getTime() - expected.getTime()) / 60000);
}
