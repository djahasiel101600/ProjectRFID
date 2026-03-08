import { memo } from "react";
import {
  useDashboard,
  useCountdown,
  useRunningSession,
  formatSeconds,
} from "../hooks/useDashboard";
import { RealtimeMetricsChart } from "../components/RealtimeMetricsChart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import type { DashboardClassroom } from "../types";

// Threshold for considering ESP32 device offline (no power data)
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

type PowerReading = { timestamp: string; classroomId: number };
function hasRecentPowerReading(
  classroomId: number,
  powerHistory: PowerReading[]
): boolean {
  const cutoff = Date.now() - OFFLINE_THRESHOLD_MS;
  return powerHistory.some(
    (r) =>
      Number(r.classroomId) === Number(classroomId) &&
      new Date(r.timestamp).getTime() > cutoff
  );
}

function isDeviceOffline(
  lastPowerUpdate: string | null,
  classroomId: number,
  powerHistory: PowerReading[]
): boolean {
  // Use powerHistory as source of truth when available (real-time WebSocket data)
  if (hasRecentPowerReading(classroomId, powerHistory)) return false;
  if (!lastPowerUpdate) return true;
  try {
    const last = new Date(lastPowerUpdate).getTime();
    return Date.now() - last > OFFLINE_THRESHOLD_MS;
  } catch {
    return true;
  }
}

// Memoized ClassroomCard - only re-renders when its props change
const ClassroomCard = memo(function ClassroomCard({
  classroom,
  powerHistory,
}: {
  classroom: DashboardClassroom;
  powerHistory: PowerReading[];
}) {
  const { remaining, formatted } = useCountdown(classroom.countdown_seconds);
  const {
    formattedElapsed,
    formattedExcess,
    isExcess,
    expectedDurationSeconds,
  } = useRunningSession(classroom.time_in, classroom.expected_out);
  const deviceOffline = isDeviceOffline(
    classroom.last_power_update,
    classroom.id,
    powerHistory
  );

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <CardTitle className="text-lg">{classroom.name}</CardTitle>
          <div className="flex flex-col items-end gap-1">
            {deviceOffline && (
              <Badge variant="destructive" className="text-xs">
                Device Off
              </Badge>
            )}
            <Badge
              variant={
                classroom.current_teacher?.full_name ? "success" : "secondary"
              }
            >
              {classroom.current_teacher?.full_name ? "Occupied" : "Available"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Current Teacher */}
        <div className="mb-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Current {classroom.current_teacher?.role || "Teacher"}
          </p>
          <p className="font-medium text-lg">
            {classroom.current_teacher?.full_name || "None"}
          </p>
        </div>

        {/* Session Time: running elapsed with excess highlighted */}
        {classroom.current_teacher && (
          <div className="mb-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isExcess ? "Session Time (excess)" : "Session Time"}
            </p>
            <p className="font-mono text-2xl font-bold">
              {isExcess && expectedDurationSeconds != null ? (
                <>
                  <span className="text-foreground">
                    {formatSeconds(expectedDurationSeconds)}
                  </span>
                  <span className="text-amber-600"> + {formattedExcess}</span>
                </>
              ) : (
                <span
                  className={
                    classroom.countdown_seconds != null && remaining < 300
                      ? "text-red-500"
                      : "text-green-600"
                  }
                >
                  {formattedElapsed}
                </span>
              )}
            </p>
            {!isExcess && classroom.countdown_seconds != null && (
              <p className="text-xs text-gray-400 mt-0.5">
                {remaining < 300 ? "Ends soon" : "Remaining"}: {formatted}
              </p>
            )}
          </div>
        )}

        {/* Power Usage */}
        <div className="mt-4 pt-4 border-t space-y-2">
          {/* Voltage */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Voltage
            </span>
            <span className="font-mono text-lg font-bold text-blue-600">
              {classroom.current_voltage !== null &&
              classroom.current_voltage !== undefined
                ? `${classroom.current_voltage.toFixed(1)} V`
                : "N/A"}
            </span>
          </div>
          {/* Current */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Current
            </span>
            <span className="font-mono text-lg font-bold text-green-600">
              {classroom.current_current !== null &&
              classroom.current_current !== undefined
                ? `${classroom.current_current.toFixed(3)} A`
                : "N/A"}
            </span>
          </div>
          {/* Power */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Power
            </span>
            <span className="font-mono text-xl font-bold text-amber-600">
              {classroom.current_power !== null &&
              classroom.current_power !== undefined
                ? `${classroom.current_power.toFixed(1)} W`
                : "N/A"}
            </span>
          </div>
          {classroom.last_power_update &&
            (() => {
              try {
                const date = new Date(classroom.last_power_update);
                return !isNaN(date.getTime()) ? (
                  <p className="text-xs text-gray-400 mt-1">
                    Updated: {date.toLocaleTimeString()}
                  </p>
                ) : null;
              } catch {
                return null;
              }
            })()}
        </div>
      </CardContent>
    </Card>
  );
});

// Memoized StatsCard - only re-renders when its props change
const StatsCard = memo(function StatsCard({
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
});

export function DashboardPage() {
  const {
    data,
    isLoading,
    error,
    isConnected,
    isReconnecting,
    powerHistory,
    refresh,
  } = useDashboard();

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

  const offlineClassrooms = (data.classrooms ?? []).filter((c) =>
    isDeviceOffline(c.last_power_update, c.id, powerHistory)
  );
  const hasOfflineDevices = offlineClassrooms.length > 0 && isConnected;

  return (
    <div className="space-y-6">
      {/* ESP32 Device Offline Warning */}
      {hasOfflineDevices && (
        <div className="p-4 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-600">
          <p className="font-semibold text-amber-800 dark:text-amber-200">
            ESP32 Device Offline
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            The following ESP32 device(s) appear to be turned off or disconnected:{" "}
            <span className="font-medium">
              {offlineClassrooms.map((c) => c.name).join(", ")}
            </span>
            . Please ensure the device is powered on and connected to the network.
          </p>
        </div>
      )}

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
              isConnected
                ? "bg-green-500"
                : isReconnecting
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-red-500"
            }`}
          />
          <span className="text-sm text-gray-500">
            {isConnected
              ? "Live"
              : isReconnecting
                ? "Reconnecting..."
                : "Disconnected"}
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

      {/* Real-Time Metrics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RealtimeMetricsChart
          data={powerHistory}
          metric="voltage"
          maxPoints={30}
        />
        <RealtimeMetricsChart
          data={powerHistory}
          metric="current"
          maxPoints={30}
        />
        <RealtimeMetricsChart
          data={powerHistory}
          metric="power"
          maxPoints={30}
        />
      </div>

      {/* Classroom Grid */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Classrooms</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data.classrooms ?? []).map((classroom) => (
            <ClassroomCard
              key={classroom.id}
              classroom={classroom}
              powerHistory={powerHistory}
            />
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
