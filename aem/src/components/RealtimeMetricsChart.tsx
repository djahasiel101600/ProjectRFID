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

export interface MetricReading {
  timestamp: string;
  voltage?: number | null;
  current?: number | null;
  watts: number;
  classroomId: number;
  classroomName?: string;
}

interface RealtimeMetricsChartProps {
  data: MetricReading[];
  metric: "voltage" | "current" | "power";
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

const METRIC_CONFIG = {
  voltage: {
    title: "Voltage",
    unit: "V",
    color: "#3b82f6",
    dataKey: "voltage",
    decimals: 1,
  },
  current: {
    title: "Current",
    unit: "A",
    color: "#10b981",
    dataKey: "current",
    decimals: 3,
  },
  power: {
    title: "Power",
    unit: "W",
    color: "#f59e0b",
    dataKey: "watts",
    decimals: 1,
  },
};

// Memoized CustomTooltip component
const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
  config,
}: any) {
  if (active && payload && payload.length) {
    const total = payload.reduce(
      (sum: number, entry: any) => sum + (entry.value || 0),
      0,
    );
    return (
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">
          {label}
        </p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex justify-between gap-4 text-sm">
            <span style={{ color: entry.color }}>{entry.name}:</span>
            <span className="font-mono">
              {entry.value?.toFixed(config.decimals) || 0} {config.unit}
            </span>
          </div>
        ))}
        {payload.length > 1 && (
          <div className="flex justify-between gap-4 text-sm font-bold border-t mt-2 pt-2">
            <span>Total:</span>
            <span className="font-mono">
              {total.toFixed(config.decimals)} {config.unit}
            </span>
          </div>
        )}
      </div>
    );
  }
  return null;
});

export const RealtimeMetricsChart = memo(function RealtimeMetricsChart({
  data,
  metric,
  title,
  maxPoints = 30,
}: RealtimeMetricsChartProps) {
  const config = METRIC_CONFIG[metric];
  const displayTitle = title || `Real-Time ${config.title}`;

  // Group data by classroom and prepare for multi-line chart
  const { chartData, classrooms } = useMemo(() => {
    // Get unique classrooms
    const classroomMap = new Map<number, string>();
    data.forEach((reading) => {
      if (!classroomMap.has(reading.classroomId)) {
        classroomMap.set(
          reading.classroomId,
          reading.classroomName || `Room ${reading.classroomId}`,
        );
      }
    });

    const classrooms = Array.from(classroomMap.entries()).map(
      ([id, name], index) => ({
        id,
        name,
        color: CLASSROOM_COLORS[index % CLASSROOM_COLORS.length],
      }),
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
      const value =
        metric === "voltage"
          ? reading.voltage
          : metric === "current"
            ? reading.current
            : reading.watts;

      if (value !== null && value !== undefined) {
        group[`room_${reading.classroomId}`] = value;
      }
    });

    // Convert to array and take last N points
    const chartData = Array.from(timeGroups.values()).slice(-maxPoints);

    return { chartData, classrooms };
  }, [data, maxPoints, metric]);

  // Calculate current total/average
  const currentValue = useMemo(() => {
    if (chartData.length === 0) return 0;
    const lastPoint = chartData[chartData.length - 1];
    const values = Object.entries(lastPoint)
      .filter(([key]) => key.startsWith("room_"))
      .map(([, value]) => value as number);

    if (values.length === 0) return 0;

    // For current, show average; for voltage and power, show total
    if (metric === "current") {
      return values.reduce((sum, val) => sum + val, 0) / values.length;
    }
    return values.reduce((sum, val) => sum + val, 0);
  }, [chartData, metric]);

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{displayTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[200px] text-gray-400">
            Waiting for {config.title.toLowerCase()} data...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg">{displayTitle}</CardTitle>
          <div className="text-right">
            <p className="text-sm text-gray-500">
              {metric === "current" ? "Avg" : "Total"} {config.title}
            </p>
            <p
              className="text-2xl font-bold font-mono"
              style={{ color: config.color }}
            >
              {currentValue.toFixed(config.decimals)} {config.unit}
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
                tickFormatter={(value) => `${value}${config.unit}`}
                width={60}
              />
              <Tooltip content={<CustomTooltip config={config} />} />
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
