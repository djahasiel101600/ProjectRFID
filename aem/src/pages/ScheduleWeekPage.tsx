import { useState, useEffect, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Building2,
  BookOpen,
  Clock,
  Zap,
  LogIn,
  LogOut,
  LayoutList,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import apiService from "../services/api";
import { parseLocalDateTime } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type { WeeklyScheduleEntry } from "../types";

const SKELETON_WIDTHS = [
  "60%", "52%", "44%", "56%", "48%",
  "40%", "36%", "44%", "40%", "44%",
];

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <TableRow key={i} className="animate-pulse">
          {SKELETON_WIDTHS.map((w, j) => (
            <TableCell key={j}>
              <div className="h-3.5 rounded-md bg-muted" style={{ width: w }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function TeacherAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary select-none">
      {initials}
    </span>
  );
}

function getMondayOfWeek(offsetWeeks: number): Date {
  const today = new Date();
  const day = today.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = parseLocalDateTime(iso) ?? new Date(iso);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "IN":
      return <Badge variant="success">Active</Badge>;
    case "MANUAL_OUT":
      return <Badge variant="outline">Manual Out</Badge>;
    case "AUTO_OUT":
      return <Badge variant="default">Auto Out</Badge>;
    case "CASCADE_OUT":
      return <Badge variant="secondary">Cascade Out</Badge>;
    case "INVALID":
      return <Badge variant="destructive">Invalid</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function ScheduleWeekPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [entries, setEntries] = useState<WeeklyScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monday = useMemo(() => getMondayOfWeek(weekOffset), [weekOffset]);
  const sunday = useMemo(() => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + 6);
    return d;
  }, [monday]);
  const weekStart = toISODate(monday);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    apiService
      .getWeeklySchedule(weekStart)
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load schedule")
      )
      .finally(() => setIsLoading(false));
  }, [weekStart]);

  const grouped = useMemo(() => {
    const map = new Map<number, WeeklyScheduleEntry[]>();
    for (const entry of entries) {
      const arr = map.get(entry.day_of_week) ?? [];
      arr.push(entry);
      map.set(entry.day_of_week, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [entries]);

  const summary = useMemo(() => {
    const attended = entries.filter(
      (e) => e.session && e.session.status !== "INVALID"
    );
    return {
      totalSlots: entries.length,
      attended: attended.length,
      totalKwh: attended.reduce((sum, e) => sum + (e.session?.total_kwh ?? 0), 0),
      totalMinutes: attended.reduce(
        (sum, e) => sum + (e.session?.duration_minutes ?? 0),
        0
      ),
    };
  }, [entries]);

  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Weekly Schedule</h1>
          <p className="text-sm text-muted-foreground">
            Teacher schedules with actual attendance and electricity usage.
          </p>
        </div>

        {/* Week Navigation */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset((o) => o - 1)}
            className="gap-1"
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>

          <div className="flex min-w-50 flex-col items-center rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-center">
            <span className="text-xs font-semibold text-foreground">
              {formatDisplayDate(monday)} – {formatDisplayDate(sunday)}
            </span>
            {isCurrentWeek && (
              <span className="mt-0.5 text-[10px] font-medium text-primary">
                Current week
              </span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset((o) => o + 1)}
            className="gap-1"
          >
            Next
            <ChevronRight className="size-4" />
          </Button>

          {!isCurrentWeek && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekOffset(0)}
              className="text-primary"
            >
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "Total Slots",
            value: summary.totalSlots,
            icon: <LayoutList className="size-4" />,
            iconClass: "bg-muted text-muted-foreground",
            valueClass: "text-foreground",
          },
          {
            label: "Attended",
            value: summary.attended,
            icon: <UserCheck className="size-4" />,
            iconClass:
              "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
            valueClass: "text-green-600 dark:text-green-400",
          },
          {
            label: "Total kWh",
            value: summary.totalKwh.toFixed(3),
            icon: <Zap className="size-4" />,
            iconClass:
              "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
            valueClass: "text-yellow-600 dark:text-yellow-400",
          },
          {
            label: "Total Duration",
            value: formatDuration(summary.totalMinutes),
            icon: <Clock className="size-4" />,
            iconClass:
              "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
            valueClass: "text-blue-600 dark:text-blue-400",
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <span
                className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${card.iconClass}`}
              >
                {card.icon}
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {card.label}
                </p>
                <p className={`text-xl font-bold leading-tight ${card.valueClass}`}>
                  {card.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Schedule Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4 text-muted-foreground" />
              Schedule Details
            </CardTitle>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {entries.length} slot{entries.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          {error && (
            <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          {isLoading ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Classroom</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Time In</TableHead>
                  <TableHead>Time Out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Excess</TableHead>
                  <TableHead>kWh</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableSkeleton />
              </TableBody>
            </Table>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted">
                <CalendarDays className="size-6 text-muted-foreground" />
              </span>
              <div>
                <p className="font-medium text-foreground">
                  No schedules this week
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  No teacher schedules found for {formatDisplayDate(monday)} –{" "}
                  {formatDisplayDate(sunday)}.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Building2 className="size-3.5" />
                      Classroom
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <BookOpen className="size-3.5" />
                      Subject
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" />
                      Scheduled
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <LogIn className="size-3.5" />
                      Time In
                    </span>
                  </TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <LogOut className="size-3.5" />
                      Time Out
                    </span>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Excess</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Zap className="size-3.5" />
                      kWh
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map(([dayOfWeek, dayEntries]) => {
                  const firstEntry = dayEntries[0];
                  const dayDate = new Date(firstEntry.date + "T00:00:00");
                  const isToday =
                    toISODate(dayDate) === toISODate(new Date());

                  return [
                    // Day header row
                    <TableRow
                      key={`day-${dayOfWeek}`}
                      className="bg-muted/40 hover:bg-muted/40"
                    >
                      <TableCell
                        colSpan={10}
                        className="py-2 font-semibold text-foreground"
                      >
                        <div className="flex items-center gap-2">
                          <CalendarDays className="size-4 text-muted-foreground" />
                          <span>{firstEntry.day_name}</span>
                          <span className="font-normal text-muted-foreground">
                            ·{" "}
                            {dayDate.toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                          {isToday && (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                              Today
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>,

                    // Entry rows for this day
                    ...dayEntries.map((entry) => {
                      const absent = entry.session === null;
                      const active = entry.session?.status === "IN";
                      return (
                        <TableRow
                          key={entry.schedule_id}
                          className={[
                            absent ? "opacity-55" : "",
                            active
                              ? "border-l-2 border-l-green-500 bg-green-50/40 dark:bg-green-900/10"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <TeacherAvatar name={entry.teacher_name} />
                              <span className="font-medium leading-tight">
                                {entry.teacher_name}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {entry.classroom_name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {entry.subject || (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums font-medium">
                            {entry.start_time} – {entry.end_time}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {entry.session ? (
                              formatTime(entry.session.time_in)
                            ) : (
                              <span className="text-xs italic text-muted-foreground/60">
                                Not attended
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {entry.session?.status === "IN" ? (
                              <span className="text-xs font-medium text-green-600 dark:text-green-400">
                                Active
                              </span>
                            ) : entry.session ? (
                              formatTime(entry.session.time_out)
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.session ? (
                              <StatusBadge status={entry.session.status} />
                            ) : (
                              <Badge variant="secondary" className="opacity-60">
                                Absent
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {formatDuration(
                              entry.session?.duration_minutes ?? null
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.session?.excess_minutes ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                +{entry.session.excess_minutes} min
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {entry.session?.total_kwh != null ? (
                              <span>
                                {entry.session.total_kwh.toFixed(4)}
                                <span className="ml-0.5 text-xs text-muted-foreground/60">
                                  kWh
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
