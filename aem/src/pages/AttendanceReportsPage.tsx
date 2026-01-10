import { useState, useEffect } from "react";
import apiService from "../services/api";
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
import type { AttendanceSession, Classroom } from "../types";

export function AttendanceReportsPage() {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [selectedClassroom, setSelectedClassroom] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  useEffect(() => {
    loadClassrooms();
  }, []);

  useEffect(() => {
    loadAttendance();
  }, [selectedDate, selectedClassroom, selectedStatus]);

  const loadClassrooms = async () => {
    try {
      const data = await apiService.getClassrooms();
      setClassrooms(data);
    } catch (err) {
      console.error("Failed to load classrooms:", err);
    }
  };

  const loadAttendance = async () => {
    try {
      setIsLoading(true);
      const params: { date?: string; classroom?: number; status?: string } = {};

      if (selectedDate) params.date = selectedDate;
      if (selectedClassroom) params.classroom = parseInt(selectedClassroom);
      if (selectedStatus) params.status = selectedStatus;

      const data = await apiService.getAttendance(params);
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load attendance"
      );
    } finally {
      setIsLoading(false);
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
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculate summary stats
  const stats = {
    total: sessions.length,
    active: sessions.filter((s) => s.status === "IN").length,
    completed: sessions.filter((s) => s.status === "AUTO_OUT").length,
    invalid: sessions.filter((s) => s.status === "INVALID").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Attendance Reports</h1>
        <p className="text-gray-500">View and filter attendance records</p>
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
              <Input
                id="date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
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
              <Button onClick={loadAttendance} className="w-full">
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
