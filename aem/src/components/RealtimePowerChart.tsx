import { useMemo, memo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export interface PowerReading {
  timestamp: string;
  watts: number;
  classroomId: number;
  classroomName?: string;
}

interface RealtimePowerChartProps {
  data: PowerReading[];
  title?: string;
  maxPoints?: number;
}

// Generate distinct colors for each classroom
const CLASSROOM_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

// Memoized CustomTooltip component - defined outside to prevent recreation on each render
const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
}: any) {
  if (active && payload && payload.length) {
    const total = payload.reduce(
      (sum: number, entry: any) => sum + (entry.value || 0),
      0
    );
    return (
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">
          {label}
        </p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex justify-between gap-4 text-sm">
            <span style={{ color: entry.color }}>{entry.name}:</span>
            <span className="font-mono">{entry.value?.toFixed(1) || 0} W</span>
          </div>
        ))}
        {payload.length > 1 && (
          <div className="flex justify-between gap-4 text-sm font-bold border-t mt-2 pt-2">
            <span>Total:</span>
            <span className="font-mono">{total.toFixed(1)} W</span>
          </div>
        )}
      </div>
    );
  }
  return null;
});

export const RealtimePowerChart = memo(function RealtimePowerChart({
  data,
  title = "Real-Time Power Consumption",
  maxPoints = 30,
}: RealtimePowerChartProps) {
  // Group data by classroom and prepare for multi-line chart
  const { chartData, classrooms } = useMemo(() => {
    // Get unique classrooms
    const classroomMap = new Map<number, string>();
    data.forEach((reading) => {
      if (!classroomMap.has(reading.classroomId)) {
        classroomMap.set(
          reading.classroomId,
          reading.classroomName || `Room ${reading.classroomId}`
        );
      }
    });

    const classrooms = Array.from(classroomMap.entries()).map(
      ([id, name], index) => ({
        id,
        name,
        color: CLASSROOM_COLORS[index % CLASSROOM_COLORS.length],
      })
    );

    // Group readings by timestamp (rounded to seconds)
    const timeGroups = new Map<string, Record<string, string | number>>();

    data.forEach((reading) => {
      const time = new Date(reading.timestamp);
      const timeKey = time.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      if (!timeGroups.has(timeKey)) {
        timeGroups.set(timeKey, { time: timeKey });
      }

      const group = timeGroups.get(timeKey)!;
      group[`room_${reading.classroomId}`] = reading.watts;
    });

    // Convert to array and take last N points
    const chartData = Array.from(timeGroups.values()).slice(-maxPoints);

    return { chartData, classrooms };
  }, [data, maxPoints]);

  // Calculate total current power
  const totalPower = useMemo(() => {
    if (chartData.length === 0) return 0;
    const lastPoint = chartData[chartData.length - 1];
    return Object.entries(lastPoint)
      .filter(([key]) => key.startsWith("room_"))
      .reduce((sum, [, value]) => sum + (value as number), 0);
  }, [chartData]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-gray-400">
            Waiting for power data...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg">{title}</CardTitle>
          <div className="text-right">
            <p className="text-sm text-gray-500">Total Power</p>
            <p className="text-2xl font-bold font-mono text-blue-600">
              {totalPower.toFixed(1)} W
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value) => `${value}W`}
                width={50}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              {classrooms.map((classroom) => (
                <Line
                  key={classroom.id}
                  type="monotone"
                  dataKey={`room_${classroom.id}`}
                  name={classroom.name}
                  stroke={classroom.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-gray-400 text-center mt-2">
          Showing last {maxPoints} readings • Updates in real-time
        </p>
      </CardContent>
    </Card>
  );
});
