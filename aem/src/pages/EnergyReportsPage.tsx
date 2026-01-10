import { useState, useEffect } from "react";
import apiService from "../services/api";
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
import type { EnergyReport, Classroom } from "../types";

export function EnergyReportsPage() {
  const [reports, setReports] = useState<EnergyReport[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedClassroom, setSelectedClassroom] = useState<string>("");
  const [selectedRange, setSelectedRange] = useState<"hour" | "day" | "month">(
    "day"
  );

  useEffect(() => {
    loadClassrooms();
  }, []);

  useEffect(() => {
    loadReport();
  }, [selectedClassroom, selectedRange]);

  const loadClassrooms = async () => {
    try {
      const data = await apiService.getClassrooms();
      setClassrooms(data);
    } catch (err) {
      console.error("Failed to load classrooms:", err);
    }
  };

  const loadReport = async () => {
    try {
      setIsLoading(true);
      const params: { classroom?: number; range?: "hour" | "day" | "month" } = {
        range: selectedRange,
      };

      if (selectedClassroom) {
        params.classroom = parseInt(selectedClassroom);
      }

      const data = await apiService.getEnergyReport(params);
      setReports(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load energy report"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const formatPeriod = (period: string) => {
    const date = new Date(period);
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
      case "month":
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        });
      default:
        return period;
    }
  };

  // Calculate totals
  const totals = reports.reduce(
    (acc, r) => ({
      totalKwh: acc.totalKwh + r.total_kwh,
      avgWatts: acc.avgWatts + r.avg_watts,
      maxWatts: Math.max(acc.maxWatts, r.max_watts),
      count: acc.count + 1,
    }),
    { totalKwh: 0, avgWatts: 0, maxWatts: 0, count: 0 }
  );

  const avgWatts = totals.count > 0 ? totals.avgWatts / totals.count : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Energy Consumption Reports</h1>
        <p className="text-gray-500">
          View energy usage by classroom and time period
        </p>
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
                  setSelectedRange(e.target.value as "hour" | "day" | "month")
                }
              >
                <option value="hour">Hourly (Last 24 Hours)</option>
                <option value="day">Daily (Last 30 Days)</option>
                <option value="month">Monthly (Last Year)</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={loadReport} className="w-full">
                Generate Report
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
              {totals.totalKwh.toFixed(2)} kWh
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Average Power</p>
            <p className="text-2xl font-bold">{avgWatts.toFixed(1)} W</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Peak Power</p>
            <p className="text-2xl font-bold text-orange-600">
              {totals.maxWatts.toFixed(1)} W
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Data Points</p>
            <p className="text-2xl font-bold">{reports.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Energy Chart Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Energy Consumption Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-gray-500">
              Chart visualization would be rendered here using Recharts
            </p>
          </div>
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
