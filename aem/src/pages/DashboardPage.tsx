import { useDashboard, useCountdown } from "../hooks/useDashboard";
import { RealtimePowerChart } from "../components/RealtimePowerChart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import type { DashboardClassroom } from "../types";

function ClassroomCard({ classroom }: { classroom: DashboardClassroom }) {
  const { remaining, formatted } = useCountdown(classroom.countdown_seconds);

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-lg">{classroom.name}</CardTitle>
          <Badge variant={classroom.current_teacher ? "success" : "secondary"}>
            {classroom.current_teacher ? "Occupied" : "Available"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Current Teacher */}
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Current Teacher
          </p>
          <p className="font-medium text-lg">
            {classroom.current_teacher?.name || "None"}
          </p>
        </div>

        {/* Countdown Timer */}
        {classroom.current_teacher && classroom.countdown_seconds !== null && (
          <div className="mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Time Remaining
            </p>
            <p
              className={`font-mono text-2xl font-bold ${
                remaining < 300 ? "text-red-500" : "text-green-600"
              }`}
            >
              {formatted}
            </p>
          </div>
        )}

        {/* Power Usage */}
        <div className="mt-4 pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Current Power
            </span>
            <span className="font-mono text-xl font-bold text-blue-600">
              {classroom.current_power !== null
                ? `${classroom.current_power.toFixed(1)} W`
                : "N/A"}
            </span>
          </div>
          {classroom.last_power_update && (
            <p className="text-xs text-gray-400 mt-1">
              Updated:{" "}
              {new Date(classroom.last_power_update).toLocaleTimeString()}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatsCard({
  title,
  value,
  subtitle,
  variant = "default",
}: {
  title: string;
  value: number | string;
  subtitle?: string;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  const colorClasses = {
    default: "text-gray-900 dark:text-gray-100",
    success: "text-green-600",
    warning: "text-yellow-600",
    danger: "text-red-600",
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
        <p className={`text-3xl font-bold ${colorClasses[variant]}`}>{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data, isLoading, error, isConnected, powerHistory, refresh } =
    useDashboard();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg text-gray-500">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <p className="text-lg text-red-500">Error: {error}</p>
        <Button onClick={refresh}>Retry</Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-lg text-gray-500">No data available</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Real-Time Dashboard</h1>
          <p className="text-gray-500">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-500">
            {isConnected ? "Live" : "Disconnected"}
          </span>
          <Button variant="outline" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          title="Total Sessions Today"
          value={data.stats?.total_today ?? 0}
        />
        <StatsCard
          title="Active Sessions"
          value={data.stats?.active ?? 0}
          variant="success"
        />
        <StatsCard
          title="Completed Sessions"
          value={data.stats?.completed ?? 0}
        />
        <StatsCard
          title="Invalid Sessions"
          value={data.stats?.invalid ?? 0}
          variant={(data.stats?.invalid ?? 0) > 0 ? "danger" : "default"}
        />
      </div>

      {/* Real-Time Power Chart */}
      <RealtimePowerChart
        data={powerHistory}
        title="Real-Time Power Consumption"
        maxPoints={30}
      />

      {/* Classroom Grid */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Classrooms</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data.classrooms ?? []).map((classroom) => (
            <ClassroomCard key={classroom.id} classroom={classroom} />
          ))}
        </div>
        {(data.classrooms ?? []).length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-gray-500">
              No classrooms configured. Add classrooms in the Admin section.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
