import { useState, useEffect, useMemo } from "react";
import apiService from "../services/api";
import { useEnergy } from "../hooks/useEnergy";
import { EnergyChart } from "../components/EnergyChart";
import { parseLocalDateTime, formatIsoWeekRangeLabel } from "../lib/utils";
import { exportEnergyReportsToCsv } from "../lib/exportEnergyReportCsv";
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
  const [chartType, setChartType] = useState<"area" | "bar" | "composed">(
    "composed",
  );

  // Filter state
  const [selectedClassroom, setSelectedClassroom] = useState<string>("");
  const [selectedRange, setSelectedRange] = useState<
    "hour" | "day" | "week" | "month"
  >("day");

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
    }),
    [selectedClassroom, selectedRange],
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
      })
      .then(setTeacherBreakdown)
      .catch((err) => console.error("Failed to load teacher breakdown:", err));
  }, [selectedClassroom, selectedRange]);

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
        <CardContent>
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
              <Label htmlFor="range">Time Range</Label>
              <Select
                id="range"
                value={selectedRange}
                onChange={(e) =>
                  setSelectedRange(
                    e.target.value as "hour" | "day" | "week" | "month",
                  )
                }
              >
                <option value="hour">Hourly (Last 24 Hours)</option>
                <option value="day">Daily (Last 30 Days)</option>
                <option value="week">Weekly (Last 12 Weeks)</option>
                <option value="month">Monthly (Last Year)</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleGenerateReport}
                className="w-full"
                disabled={isRefreshing}
                title="Refresh data from server and download CSV"
              >
                {isRefreshing ? "Generating…" : "Generate Report"}
              </Button>
            </div>
          </div>
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
