import { useState, useEffect, useMemo } from "react";
import apiService from "../services/api";
import { useAttendance } from "../hooks/useAttendance";
import { parseLocalDateTime } from "../lib/utils";
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
import type { Classroom } from "../types";

export function AttendanceReportsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);

  // Filter state - start with empty date to show all records
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedClassroom, setSelectedClassroom] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  // Create memoized filter object to prevent unnecessary re-renders
  const filters = useMemo(
    () => ({
      date: selectedDate || undefined,
      classroom: selectedClassroom ? parseInt(selectedClassroom) : undefined,
      status: selectedStatus || undefined,
    }),
    [selectedDate, selectedClassroom, selectedStatus]
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
    loadClassrooms();
  }, []);

  const loadClassrooms = async () => {
    try {
      const data = await apiService.getClassrooms();
      setClassrooms(data);
    } catch (err) {
      console.error("Failed to load classrooms:", err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "IN":
        return <Badge variant="success">Active</Badge>;
      case "AUTO_OUT":
        return <Badge variant="default">Completed</Badge>;
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Attendance Reports</h1>
          <p className="text-gray-500">View and filter attendance records</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <div className="flex gap-2">
                <Input
                  id="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="flex-1"
                />
                {selectedDate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedDate("")}
                    title="Clear date filter"
                  >
                    ✕
                  </Button>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {selectedDate ? "" : "Showing all dates"}
              </p>
            </div>
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
              <Label htmlFor="status">Status</Label>
              <Select
                id="status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="">All Statuses</option>
                <option value="IN">Active</option>
                <option value="AUTO_OUT">Completed</option>
                <option value="INVALID">Invalid</option>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={refresh} className="w-full">
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Active</p>
            <p className="text-2xl font-bold text-green-600">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Completed</p>
            <p className="text-2xl font-bold">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Invalid</p>
            <p className="text-2xl font-bold text-red-600">{stats.invalid}</p>
          </CardContent>
        </Card>
      </div>

      {/* Attendance Table */}
      <Card>
        <CardHeader>
          <CardTitle>Attendance Records</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-4 text-red-600 bg-red-50 rounded-md mb-4">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="py-8 text-center text-gray-500">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No attendance records found for the selected filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Classroom</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time In</TableHead>
                  <TableHead>Time Out</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium">
                      {session.teacher_name}
                    </TableCell>
                    <TableCell>{session.classroom_name}</TableCell>
                    <TableCell>{session.date}</TableCell>
                    <TableCell>{formatTime(session.time_in)}</TableCell>
                    <TableCell>{formatTime(session.time_out)}</TableCell>
                    <TableCell>{getStatusBadge(session.status)}</TableCell>
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
