import { useState, useEffect } from "react";
import apiService from "../services/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useAuth } from "../contexts/AuthContext";
import type {
  TeacherEnergySummary,
  TeacherEnergyUsage,
  TeacherEnergyByClassroom,
  User,
} from "../types";

export function TeacherEnergyPage() {
  const { user } = useAuth();
  const [summaries, setSummaries] = useState<TeacherEnergySummary[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<number | null>(null);
  const [teacherDetails, setTeacherDetails] = useState<TeacherEnergyUsage[]>(
    [],
  );
  const [classroomBreakdown, setClassroomBreakdown] = useState<
    TeacherEnergyByClassroom[]
  >([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedTeacher) {
      loadTeacherDetails(selectedTeacher);
    } else {
      setTeacherDetails([]);
      setClassroomBreakdown([]);
    }
  }, [selectedTeacher]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [summaryData, teachersData] = await Promise.all([
        apiService.getTeacherEnergySummary(),
        apiService.getTeachers(),
      ]);
      setSummaries(summaryData);
      setTeachers(teachersData);
    } catch (err) {
      console.error("Failed to load data:", err);
      setError("Failed to load teacher energy data");
    } finally {
      setIsLoading(false);
    }
  };

  const loadTeacherDetails = async (teacherId: number) => {
    try {
      const [details, breakdown] = await Promise.all([
        apiService.getTeacherEnergy({ teacher: teacherId }),
        apiService.getTeacherEnergyByClassroom(teacherId),
      ]);
      setTeacherDetails(details);
      setClassroomBreakdown(breakdown);
    } catch (err) {
      console.error("Failed to load teacher details:", err);
    }
  };

  const handleRecalculate = async () => {
    if (
      !confirm(
        "This will recalculate energy for all completed sessions. Continue?",
      )
    ) {
      return;
    }

    try {
      setIsRecalculating(true);
      const result = await apiService.recalculateTeacherEnergy();
      alert(result.message);
      await loadData();
    } catch (err) {
      console.error("Failed to recalculate:", err);
      alert("Failed to recalculate energy data");
    } finally {
      setIsRecalculating(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  };

  // Calculate totals
  const totalKwh = summaries.reduce((acc, s) => acc + s.total_kwh, 0);
  const totalHours = summaries.reduce((acc, s) => acc + s.total_hours, 0);
  const totalSessions = summaries.reduce((acc, s) => acc + s.session_count, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Teacher Energy Consumption
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Track electricity usage per teacher based on attendance sessions
          </p>
        </div>
        <div className="flex gap-2">
          {user?.role === "admin" && (
            <Button
              onClick={handleRecalculate}
              variant="outline"
              size="sm"
              disabled={isRecalculating}
            >
              {isRecalculating ? "Recalculating..." : "Recalculate All"}
            </Button>
          )}
          <Button
            onClick={loadData}
            variant="outline"
            size="sm"
            disabled={isLoading}
          >
            ↻ Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Total Teachers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {summaries.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Total Energy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {totalKwh.toFixed(4)} kWh
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Total Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {totalHours.toFixed(1)} hrs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Total Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {totalSessions}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Teacher Energy Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle>Energy Usage by Teacher</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
              Loading...
            </div>
          ) : summaries.length === 0 ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
              <p>No energy data available yet.</p>
              <p className="text-sm mt-2">
                Data is automatically calculated when attendance sessions end
                (AUTO_OUT).
              </p>
              {user?.role === "admin" && (
                <Button
                  onClick={handleRecalculate}
                  variant="outline"
                  size="sm"
                  className="mt-4"
                >
                  Recalculate from existing sessions
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead className="text-right">Total kWh</TableHead>
                  <TableHead className="text-right">Total Hours</TableHead>
                  <TableHead className="text-right">Avg Watts</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">kWh/Hour</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((summary) => (
                  <TableRow
                    key={summary.teacher_id}
                    className={
                      selectedTeacher === summary.teacher_id
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : ""
                    }
                  >
                    <TableCell className="font-medium">
                      {summary.teacher_name}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(summary.total_kwh).toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(summary.total_hours).toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(summary.avg_watts).toFixed(1)} W
                    </TableCell>
                    <TableCell className="text-right">
                      {summary.session_count}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(summary.total_hours) > 0
                        ? (
                            Number(summary.total_kwh) /
                            Number(summary.total_hours)
                          ).toFixed(4)
                        : "N/A"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedTeacher(
                            selectedTeacher === summary.teacher_id
                              ? null
                              : summary.teacher_id,
                          )
                        }
                      >
                        {selectedTeacher === summary.teacher_id
                          ? "Hide"
                          : "Details"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Teacher Details Section */}
      {selectedTeacher && (
        <>
          {/* Classroom Breakdown */}
          {classroomBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Classroom Breakdown for{" "}
                  {
                    summaries.find((s) => s.teacher_id === selectedTeacher)
                      ?.teacher_name
                  }
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Classroom</TableHead>
                      <TableHead className="text-right">Total kWh</TableHead>
                      <TableHead className="text-right">Total Hours</TableHead>
                      <TableHead className="text-right">Avg Watts</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classroomBreakdown.map((item) => (
                      <TableRow key={item.classroom_id}>
                        <TableCell className="font-medium">
                          {item.classroom_name}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(item.total_kwh).toFixed(4)}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(item.total_hours).toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(item.avg_watts).toFixed(1)} W
                        </TableCell>
                        <TableCell className="text-right">
                          {item.session_count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Session Details */}
          <Card>
            <CardHeader>
              <CardTitle>
                Session History for{" "}
                {
                  summaries.find((s) => s.teacher_id === selectedTeacher)
                    ?.teacher_name
                }
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teacherDetails.length === 0 ? (
                <div className="py-4 text-center text-gray-500 dark:text-gray-400">
                  No session details available
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date/Time</TableHead>
                        <TableHead>Classroom</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead className="text-right">Avg W</TableHead>
                        <TableHead className="text-right">Max W</TableHead>
                        <TableHead className="text-right">Min W</TableHead>
                        <TableHead className="text-right">kWh</TableHead>
                        <TableHead className="text-right">Readings</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teacherDetails.slice(0, 20).map((detail) => (
                        <TableRow key={detail.id}>
                          <TableCell className="whitespace-nowrap">
                            {formatDateTime(detail.start_time)}
                          </TableCell>
                          <TableCell>{detail.classroom_name}</TableCell>
                          <TableCell className="text-right">
                            {formatDuration(detail.duration_minutes)}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(detail.avg_watts).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(detail.max_watts).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right">
                            {Number(detail.min_watts).toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(detail.total_kwh).toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right">
                            {detail.reading_count}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {teacherDetails.length > 20 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 text-center">
                      Showing first 20 of {teacherDetails.length} sessions
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
