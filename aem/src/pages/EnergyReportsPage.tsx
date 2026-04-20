import { useState, useEffect, useMemo } from "react";
import apiService from "../services/api";
import { useEnergy } from "../hooks/useEnergy";
import { EnergyChart } from "../components/EnergyChart";
import { parseLocalDateTime, formatIsoWeekRangeLabel } from "../lib/utils";
import { exportEnergyReportsToCsv } from "../lib/exportEnergyReportCsv";
import { DateRangePicker } from "../components/ui/date-range-picker";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type { Classroom, TeacherEnergyBreakdown } from "../types";

const TEACHER_COLORS = [
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#a855f7",
  "#ef4444",
  "#84cc16",
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#e11d48",
  "#0ea5e9",
  "#d946ef",
  "#22c55e",
  "#fb923c",
  "#6366f1",
  "#f43f5e",
  "#2dd4bf",
  "#facc15",
];

export function EnergyReportsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [chartType, setChartType] = useState<
    "area" | "bar" | "composed" | "stacked"
  >("composed");

  // Filter state
  const [selectedClassroom, setSelectedClassroom] = useState<string>("");
  const [selectedRange, setSelectedRange] = useState<
    "hour" | "day" | "week" | "month"
  >("day");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const dateRangeError =
    dateFrom && dateTo && dateFrom > dateTo
      ? "Start date must be before end date"
      : undefined;

  // Teacher breakdown state
  const [teacherBreakdown, setTeacherBreakdown] = useState<
    TeacherEnergyBreakdown[]
  >([]);
  const [hiddenTeachers, setHiddenTeachers] = useState<Set<number>>(new Set());

  // Create memoized filter object to prevent unnecessary re-renders
  const filters = useMemo(
    () => ({
      classroom: selectedClassroom ? parseInt(selectedClassroom) : undefined,
      range: selectedRange,
      start: dateFrom && !dateRangeError ? dateFrom : undefined,
      end: dateTo && !dateRangeError ? dateTo : undefined,
    }),
    [selectedClassroom, selectedRange, dateFrom, dateTo, dateRangeError],
  );

  // Use the real-time energy hook
  const {
    reports,
    stats,
    isLoading,
    isRefreshing,
    error,
    isConnected,
    lastUpdate,
    refresh,
  } = useEnergy(filters);

  useEffect(() => {
    loadClassrooms();
  }, []);

  // Fetch teacher breakdown whenever filters change
  useEffect(() => {
    setTeacherBreakdown([]);
    apiService
      .getTeacherEnergyBreakdown({
        classroom: selectedClassroom ? parseInt(selectedClassroom) : undefined,
        range: selectedRange,
        start: dateFrom && !dateRangeError ? dateFrom : undefined,
        end: dateTo && !dateRangeError ? dateTo : undefined,
      })
      .then(setTeacherBreakdown)
      .catch((err) => console.error("Failed to load teacher breakdown:", err));
  }, [selectedClassroom, selectedRange, dateFrom, dateTo, dateRangeError]);

  const uniqueTeachers = useMemo(() => {
    const seen = new Set<number>();
    return teacherBreakdown.reduce<{ id: number; name: string }[]>(
      (acc, row) => {
        if (!seen.has(row.teacher_id)) {
          seen.add(row.teacher_id);
          acc.push({ id: row.teacher_id, name: row.teacher_name });
        }
        return acc;
      },
      [],
    );
  }, [teacherBreakdown]);

  const teacherInsights = useMemo(() => {
    if (!teacherBreakdown.length) return [];

    const map = new Map<
      number,
      {
        id: number;
        name: string;
        colorIndex: number;
        totalKwh: number;
        sessionCount: number;
        avgWattsSum: number;
        periodCount: number;
      }
    >();

    teacherBreakdown.forEach((row) => {
      const existing = map.get(row.teacher_id);
      if (existing) {
        existing.totalKwh += row.total_kwh;
        existing.sessionCount += row.session_count;
        existing.avgWattsSum += row.avg_watts;
        existing.periodCount += 1;
      } else {
        const colorIndex = uniqueTeachers.findIndex(
          (t) => t.id === row.teacher_id,
        );
        map.set(row.teacher_id, {
          id: row.teacher_id,
          name: row.teacher_name,
          colorIndex: colorIndex >= 0 ? colorIndex : 0,
          totalKwh: row.total_kwh,
          sessionCount: row.session_count,
          avgWattsSum: row.avg_watts,
          periodCount: 1,
        });
      }
    });

    const grandTotal = Array.from(map.values()).reduce(
      (s, r) => s + r.totalKwh,
      0,
    );

    return Array.from(map.values())
      .map((r) => ({
        id: r.id,
        name: r.name,
        colorIndex: r.colorIndex,
        totalKwh: r.totalKwh,
        sessionCount: r.sessionCount,
        avgWatts: r.periodCount > 0 ? r.avgWattsSum / r.periodCount : 0,
        pct: grandTotal > 0 ? (r.totalKwh / grandTotal) * 100 : 0,
      }))
      .sort((a, b) => b.totalKwh - a.totalKwh);
  }, [teacherBreakdown, uniqueTeachers]);

  const toggleTeacher = (id: number) =>
    setHiddenTeachers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const loadClassrooms = async () => {
    try {
      const data = await apiService.getClassrooms();
      setClassrooms(data);
    } catch (err) {
      console.error("Failed to load classrooms:", err);
    }
  };

  const formatPeriod = (period: string) => {
    const date = parseLocalDateTime(period);
    if (!date) return period;
    switch (selectedRange) {
      case "hour":
        return date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      case "day":
        return date.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
      case "week":
        return formatIsoWeekRangeLabel(period);
      case "month":
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        });
      default:
        return period;
    }
  };

  const handleGenerateReport = async () => {
    const data = await refresh();
    if (!data.length) return;
    const classroomLabel = selectedClassroom
      ? (classrooms.find((c) => String(c.id) === selectedClassroom)?.name ??
        `classroom-${selectedClassroom}`)
      : "All classrooms";
    exportEnergyReportsToCsv(data, {
      range: selectedRange,
      classroomLabel,
      formatPeriod: (p) => formatPeriod(p),
      start: dateFrom || undefined,
      end: dateTo || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Energy Consumption Reports</h1>
          <p className="text-gray-500">
            View energy usage by classroom and time period
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            ></span>
            <span className="text-xs text-gray-400">
              {isConnected ? "Real-time updates active" : "Connecting..."}
              {lastUpdate &&
                ` • Last updated: ${lastUpdate.toLocaleTimeString()}`}
            </span>
          </div>
        </div>
        <Button onClick={refresh} variant="outline" size="sm">
          ↻ Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="classroom">Classroom</Label>
              <Select
                id="classroom"
                value={selectedClassroom}
                onChange={(e) => setSelectedClassroom(e.target.value)}
              >
                <option value="">All Classrooms</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="range">Group By</Label>
              <Select
                id="range"
                value={selectedRange}
                onChange={(e) =>
                  setSelectedRange(
                    e.target.value as "hour" | "day" | "week" | "month",
                  )
                }
              >
                <option value="hour">Hourly</option>
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </Select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={isRefreshing || !!dateRangeError}
                title="Refresh data from server and download CSV"
                className="w-full h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRefreshing ? "Generating…" : "Generate Report"}
              </button>
            </div>
          </div>
          <DateRangePicker
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onClear={() => { setDateFrom(""); setDateTo(""); }}
          />
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total Consumption</p>
            <p className="text-2xl font-bold text-blue-600">
              {stats.totalKwh.toFixed(2)} kWh
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Average Power</p>
            <p className="text-2xl font-bold">{stats.avgWatts.toFixed(1)} W</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Peak Power</p>
            <p className="text-2xl font-bold text-orange-600">
              {stats.maxWatts.toFixed(1)} W
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Data Points</p>
            <p className="text-2xl font-bold">{stats.dataPoints}</p>
          </CardContent>
        </Card>
      </div>

      {/* Energy Chart */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start flex-wrap gap-2">
            <CardTitle>Energy Consumption Over Time</CardTitle>
            <div className="flex gap-2">
              <Button
                variant={chartType === "composed" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartType("composed")}
              >
                Combined
              </Button>
              <Button
                variant={chartType === "bar" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartType("bar")}
              >
                Bar
              </Button>
              <Button
                variant={chartType === "area" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartType("area")}
              >
                Area
              </Button>
              <Button
                variant={chartType === "stacked" ? "default" : "outline"}
                size="sm"
                onClick={() => setChartType("stacked")}
              >
                Stacked
              </Button>
            </div>
          </div>

          {/* Per-teacher toggle buttons */}
          {uniqueTeachers.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {uniqueTeachers.map((t, i) => {
                const color = TEACHER_COLORS[i % TEACHER_COLORS.length];
                const hidden = hiddenTeachers.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTeacher(t.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-opacity ${
                      hidden ? "opacity-35" : "opacity-100"
                    }`}
                    style={{
                      borderColor: color,
                      color: hidden ? undefined : color,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    {t.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Info banner when main data is present but teacher breakdown is empty */}
          {!isLoading &&
            reports.length > 0 &&
            teacherBreakdown.length === 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 rounded px-3 py-2 mt-2">
                Teacher breakdown is unavailable. Go to the{" "}
                <a href="/teacher-energy" className="underline font-medium">
                  Teacher Energy page
                </a>{" "}
                and click <strong>Recalculate</strong> to populate it.
              </p>
            )}
        </CardHeader>
        <CardContent>
          <EnergyChart
            data={reports}
            range={selectedRange}
            chartType={chartType}
            teacherBreakdown={teacherBreakdown}
            hiddenTeachers={hiddenTeachers}
            teacherColors={TEACHER_COLORS}
          />
        </CardContent>
      </Card>

      {/* Teacher Consumption Breakdown */}
      {teacherInsights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Teacher Consumption Breakdown</CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {dateFrom || dateTo
                ? `Custom range: ${dateFrom || "…"} to ${dateTo || "…"}`
                : `Aggregated over the selected ${
                    { hour: "hourly", day: "daily", week: "weekly", month: "monthly" }[selectedRange]
                  } range`}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Top / Least consumer mini-cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(() => {
                const top = teacherInsights[0];
                const topColor =
                  TEACHER_COLORS[top.colorIndex % TEACHER_COLORS.length];
                const least = teacherInsights[teacherInsights.length - 1];
                const leastColor =
                  TEACHER_COLORS[least.colorIndex % TEACHER_COLORS.length];
                return (
                  <>
                    <div
                      className="rounded-lg border p-4 flex flex-col gap-1"
                      style={{ borderColor: topColor }}
                    >
                      <span
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color: topColor }}
                      >
                        Highest Usage
                      </span>
                      <span className="text-base font-bold text-gray-900 dark:text-white">
                        {top.name}
                      </span>
                      <span
                        className="text-2xl font-bold"
                        style={{ color: topColor }}
                      >
                        {top.totalKwh.toFixed(4)} kWh
                      </span>
                      <span className="text-xs text-gray-500">
                        {top.pct.toFixed(1)}% of total &bull; {top.sessionCount}{" "}
                        session
                        {top.sessionCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {teacherInsights.length > 1 && (
                      <div
                        className="rounded-lg border p-4 flex flex-col gap-1"
                        style={{ borderColor: leastColor }}
                      >
                        <span
                          className="text-xs font-semibold uppercase tracking-wide"
                          style={{ color: leastColor }}
                        >
                          Lowest Usage
                        </span>
                        <span className="text-base font-bold text-gray-900 dark:text-white">
                          {least.name}
                        </span>
                        <span
                          className="text-2xl font-bold"
                          style={{ color: leastColor }}
                        >
                          {least.totalKwh.toFixed(4)} kWh
                        </span>
                        <span className="text-xs text-gray-500">
                          {least.pct.toFixed(1)}% of total &bull;{" "}
                          {least.sessionCount} session
                          {least.sessionCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Ranked progress-bar list */}
            <div className="space-y-1">
              {teacherInsights.map((t, i) => {
                const color =
                  TEACHER_COLORS[t.colorIndex % TEACHER_COLORS.length];
                const hidden = hiddenTeachers.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTeacher(t.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-opacity text-left ${
                      hidden ? "opacity-40" : "opacity-100"
                    }`}
                  >
                    <span className="w-5 text-xs text-gray-400 shrink-0 text-right">
                      {i + 1}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: color }}
                    />
                    <span className="w-32 text-sm font-medium truncate text-gray-900 dark:text-white">
                      {t.name}
                    </span>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${t.pct}%`, background: color }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-24 text-right shrink-0">
                      {t.totalKwh.toFixed(4)} kWh
                    </span>
                    <span
                      className="text-xs font-medium w-12 text-right shrink-0"
                      style={{ color }}
                    >
                      {t.pct.toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-400 w-20 text-right shrink-0">
                      {t.sessionCount} session
                      {t.sessionCount !== 1 ? "s" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Data</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-4 text-red-600 bg-red-50 rounded-md mb-4">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="py-8 text-center text-gray-500">Loading...</div>
          ) : reports.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No energy data available for the selected filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Total (kWh)</TableHead>
                  <TableHead className="text-right">Avg (W)</TableHead>
                  <TableHead className="text-right">Max (W)</TableHead>
                  <TableHead className="text-right">Min (W)</TableHead>
                  <TableHead className="text-right">Readings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                      {formatPeriod(report.period)}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.total_kwh.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.avg_watts.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.max_watts.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.min_watts.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      {report.reading_count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
