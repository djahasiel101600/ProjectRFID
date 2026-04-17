import { useState, useEffect, useMemo, useCallback } from "react";
import {
  RefreshCw,
  Download,
  X,
  Users,
  Building2,
  CalendarRange,
  Wifi,
  WifiOff,
  UserCheck,
  TrendingUp,
  AlertTriangle,
  LayoutList,
  Zap,
  Clock,
  LogIn,
  LogOut,
} from "lucide-react";
import apiService from "../services/api";
import { useAttendance } from "../hooks/useAttendance";
import { parseLocalDateTime } from "../lib/utils";
import { exportAttendanceToCsv } from "../lib/exportAttendanceCsv";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type { Classroom, User } from "../types";

const STATUS_LABELS: Record<string, string> = {
  IN: "Active",
  MANUAL_OUT: "Manual Out",
  AUTO_OUT: "Auto Out",
  CASCADE_OUT: "Cascade Out",
  INVALID: "Invalid",
};

/** Fixed skeleton cell widths — deterministic, avoids random flicker. */
const SKELETON_WIDTHS = ["72%", "58%", "52%", "48%", "48%", "64%", "38%", "44%", "40%"];

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
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

export function AttendanceReportsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Filter state
  const [selectedStartDate, setSelectedStartDate] = useState("");
  const [selectedEndDate, setSelectedEndDate] = useState("");
  const [selectedClassroom, setSelectedClassroom] = useState<string>("");
  const [selectedTeacher, setSelectedTeacher] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  // Create memoized filter object to prevent unnecessary re-renders
  const filters = useMemo(
    () => ({
      start_date: selectedStartDate || undefined,
      end_date: selectedEndDate || undefined,
      classroom: selectedClassroom ? parseInt(selectedClassroom) : undefined,
      teacher: selectedTeacher ? parseInt(selectedTeacher) : undefined,
      status: selectedStatus || undefined,
    }),
    [
      selectedStartDate,
      selectedEndDate,
      selectedClassroom,
      selectedTeacher,
      selectedStatus,
    ],
  );

  // Use the real-time attendance hook
  const {
    sessions,
    stats,
    isLoading,
    error,
    isConnected,
    lastUpdate,
    refresh,
  } = useAttendance(filters);

  useEffect(() => {
    apiService.getClassrooms().then(setClassrooms).catch(console.error);
    apiService.getTeachers().then(setTeachers).catch(console.error);
  }, []);

  const clearAllFilters = () => {
    setSelectedStartDate("");
    setSelectedEndDate("");
    setSelectedClassroom("");
    setSelectedTeacher("");
    setSelectedStatus("");
  };

  const hasActiveFilters =
    selectedStartDate ||
    selectedEndDate ||
    selectedClassroom ||
    selectedTeacher ||
    selectedStatus;

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const allSessions = await apiService.exportAttendance(filters);
      const classroomLabel =
        classrooms.find((c) => String(c.id) === selectedClassroom)?.name ??
        "All Classrooms";
      const teacherLabel =
        teachers.find((t) => String(t.id) === selectedTeacher)?.full_name ??
        "All Teachers";
      const statusLabel = selectedStatus
        ? (STATUS_LABELS[selectedStatus] ?? selectedStatus)
        : "All Statuses";
      exportAttendanceToCsv(allSessions, {
        classroomLabel,
        teacherLabel,
        startDate: selectedStartDate,
        endDate: selectedEndDate,
        statusLabel,
        formatTime,
      });
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  }, [
    filters,
    classrooms,
    teachers,
    selectedClassroom,
    selectedTeacher,
    selectedStatus,
    selectedStartDate,
    selectedEndDate,
  ]);

  const getStatusBadge = (status: string) => {
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
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return "-";
    const date = parseLocalDateTime(dateString);
    if (!date) return "-";
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (minutes: number | null) => {
    if (minutes == null) return "-";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  };

  const getExcessMinutes = (session: {
    status: string;
    expected_out: string | null;
    time_out: string | null;
    date: string;
  }) => {
    if (!session.expected_out) return null;
    const expected =
      parseLocalDateTime(session.expected_out) ??
      new Date(
        session.expected_out.includes("T")
          ? session.expected_out
          : `${session.date}T${session.expected_out}`,
      );
    if (isNaN(expected.getTime())) return null;
    // For IN sessions: use current time. For completed (MANUAL_OUT, CASCADE_OUT, AUTO_OUT): use time_out
    const endTime =
      session.status === "IN"
        ? new Date()
        : session.time_out
          ? (parseLocalDateTime(session.time_out) ?? new Date(session.time_out))
          : null;
    if (!endTime || isNaN(endTime.getTime()) || endTime <= expected)
      return null;
    return Math.floor((endTime.getTime() - expected.getTime()) / 60000);
  };

  const activeFilterChips = (
    [
      selectedStartDate && {
        label: `From: ${selectedStartDate}`,
        icon: <CalendarRange className="size-3" />,
        onClear: () => setSelectedStartDate(""),
      },
      selectedEndDate && {
        label: `To: ${selectedEndDate}`,
        icon: <CalendarRange className="size-3" />,
        onClear: () => setSelectedEndDate(""),
      },
      selectedClassroom && {
        label:
          classrooms.find((c) => String(c.id) === selectedClassroom)?.name ??
          selectedClassroom,
        icon: <Building2 className="size-3" />,
        onClear: () => setSelectedClassroom(""),
      },
      selectedTeacher && {
        label:
          teachers.find((t) => String(t.id) === selectedTeacher)?.full_name ??
          selectedTeacher,
        icon: <Users className="size-3" />,
        onClear: () => setSelectedTeacher(""),
      },
      selectedStatus && {
        label: STATUS_LABELS[selectedStatus] ?? selectedStatus,
        onClear: () => setSelectedStatus(""),
      },
    ] as (
      | { label: string; icon?: React.ReactNode; onClear: () => void }
      | false
    )[]
  ).filter(
    Boolean,
  ) as { label: string; icon?: React.ReactNode; onClear: () => void }[];

  const statCards = [
    {
      label: "Total Sessions",
      value: stats.total,
      icon: <LayoutList className="size-4" />,
      valueClass: "text-foreground",
      iconClass: "bg-muted text-muted-foreground",
    },
    {
      label: "Active",
      value: stats.active,
      icon: <UserCheck className="size-4" />,
      valueClass: "text-green-600 dark:text-green-400",
      iconClass: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
    },
    {
      label: "Completed",
      value: stats.completed,
      icon: <TrendingUp className="size-4" />,
      valueClass: "text-blue-600 dark:text-blue-400",
      iconClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
    },
    {
      label: "Invalid",
      value: stats.invalid,
      icon: <AlertTriangle className="size-4" />,
      valueClass: "text-red-600 dark:text-red-400",
      iconClass: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Attendance Reports
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                isConnected
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
              }`}
            >
              {isConnected ? (
                <Wifi className="size-3" />
              ) : (
                <WifiOff className="size-3" />
              )}
              {isConnected ? "Live" : "Offline"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            View, filter, and export teacher attendance sessions.
            {lastUpdate && (
              <span className="ml-1 text-muted-foreground/60">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={refresh}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button
            onClick={handleExport}
            variant="outline"
            size="sm"
            disabled={isExporting || sessions.length === 0}
            className="gap-1.5"
          >
            <Download className="size-3.5" />
            {isExporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              Filters
              {activeFilterChips.length > 0 && (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {activeFilterChips.length}
                </span>
              )}
            </CardTitle>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
                Clear all
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* Start Date */}
            <div className="space-y-1.5">
              <Label htmlFor="start-date" className="flex items-center gap-1.5 text-xs font-medium">
                <CalendarRange className="size-3.5 text-muted-foreground" />
                Start Date
              </Label>
              <div className="flex gap-1">
                <Input
                  id="start-date"
                  type="date"
                  value={selectedStartDate}
                  onChange={(e) => setSelectedStartDate(e.target.value)}
                  max={selectedEndDate || undefined}
                  className="flex-1 text-sm"
                />
                {selectedStartDate && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSelectedStartDate("")}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* End Date */}
            <div className="space-y-1.5">
              <Label htmlFor="end-date" className="flex items-center gap-1.5 text-xs font-medium">
                <CalendarRange className="size-3.5 text-muted-foreground" />
                End Date
              </Label>
              <div className="flex gap-1">
                <Input
                  id="end-date"
                  type="date"
                  value={selectedEndDate}
                  onChange={(e) => setSelectedEndDate(e.target.value)}
                  min={selectedStartDate || undefined}
                  className="flex-1 text-sm"
                />
                {selectedEndDate && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSelectedEndDate("")}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Classroom */}
            <div className="space-y-1.5">
              <Label htmlFor="classroom" className="flex items-center gap-1.5 text-xs font-medium">
                <Building2 className="size-3.5 text-muted-foreground" />
                Classroom
              </Label>
              <Select
                id="classroom"
                value={selectedClassroom}
                onChange={(e) => setSelectedClassroom(e.target.value)}
                className="text-sm"
              >
                <option value="">All Classrooms</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Teacher */}
            <div className="space-y-1.5">
              <Label htmlFor="teacher" className="flex items-center gap-1.5 text-xs font-medium">
                <Users className="size-3.5 text-muted-foreground" />
                Teacher
              </Label>
              <Select
                id="teacher"
                value={selectedTeacher}
                onChange={(e) => setSelectedTeacher(e.target.value)}
                className="text-sm"
              >
                <option value="">All Teachers</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-xs font-medium">
                Status
              </Label>
              <Select
                id="status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="text-sm"
              >
                <option value="">All Statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Active filter chips */}
          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
              {activeFilterChips.map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-foreground"
                >
                  {chip.icon}
                  {chip.label}
                  <button
                    onClick={chip.onClear}
                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {!selectedStartDate && !selectedEndDate && activeFilterChips.length === 0 && (
            <p className="text-xs text-muted-foreground/70">
              Showing all dates — use Start/End Date to narrow the range.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label} className="relative overflow-hidden">
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
                <p className={`text-2xl font-bold leading-tight ${card.valueClass}`}>
                  {card.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Attendance Records</CardTitle>
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {sessions.length === 0
                  ? "No records"
                  : `${sessions.length} record${sessions.length !== 1 ? "s" : ""}`}
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
                  <TableHead>Date</TableHead>
                  <TableHead>Time In</TableHead>
                  <TableHead>Time Out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Excess</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>kWh</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableSkeleton />
              </TableBody>
            </Table>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted">
                <LayoutList className="size-6 text-muted-foreground" />
              </span>
              <div>
                <p className="font-medium text-foreground">No records found</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {hasActiveFilters
                    ? "Try adjusting or clearing the active filters."
                    : "No attendance sessions have been recorded yet."}
                </p>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAllFilters}
                  className="mt-1 gap-1.5"
                >
                  <X className="size-3.5" />
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Classroom</TableHead>
                  <TableHead>Date</TableHead>
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
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" />
                      Excess
                    </span>
                  </TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>
                    <span className="flex items-center gap-1">
                      <Zap className="size-3.5" />
                      kWh
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const excess = getExcessMinutes(session);
                  return (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TeacherAvatar name={session.teacher_name} />
                          <span className="font-medium leading-tight">
                            {session.teacher_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {session.classroom_name}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {new Date(session.date + "T00:00:00").toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatTime(session.time_in)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatTime(session.time_out)}
                      </TableCell>
                      <TableCell>{getStatusBadge(session.status)}</TableCell>
                      <TableCell>
                        {excess != null ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                            +{excess} min
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDuration(session.duration_minutes)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {session.total_kwh != null ? (
                          <span>
                            {session.total_kwh.toFixed(4)}
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
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
