import { useMemo, useCallback, memo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  ComposedChart,
  Line,
} from "recharts";
import type { EnergyReport, TeacherEnergyBreakdown } from "../types";
import { parseLocalDateTime, formatIsoWeekRangeLabel } from "../lib/utils";

// Memoized CustomTooltip component - defined outside to prevent recreation on each render
const CustomTooltip = memo(function CustomTooltip({
  active,
  payload,
  label,
}: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-gray-800 p-3 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">
          {label}
        </p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {entry.value}{" "}
            {entry.dataKey.includes("Kwh") || entry.dataKey.endsWith("_kwh")
              ? "kWh"
              : "W"}
          </p>
        ))}
      </div>
    );
  }
  return null;
});

interface EnergyChartProps {
  data: EnergyReport[];
  range: "hour" | "day" | "week" | "month";
  chartType?: "area" | "bar" | "composed";
  teacherBreakdown?: TeacherEnergyBreakdown[];
  hiddenTeachers?: Set<number>;
  teacherColors?: string[];
}

export const EnergyChart = memo(function EnergyChart({
  data,
  range,
  chartType = "composed",
  teacherBreakdown,
  hiddenTeachers,
  teacherColors,
}: EnergyChartProps) {
  // Memoized format period label function based on range
  const formatPeriodLabel = useCallback(
    (period: string) => {
      const date = parseLocalDateTime(period);
      if (!date) return period;
      switch (range) {
        case "hour":
          return date.toLocaleString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          });
        case "day":
          return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
        case "week":
          return formatIsoWeekRangeLabel(period);
        case "month":
          return date.toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
          });
        default:
          return period;
      }
    },
    [range],
  );

  // Derive unique teachers from breakdown
  const uniqueTeachers = useMemo(() => {
    const seen = new Set<number>();
    return (teacherBreakdown ?? []).reduce<{ id: number; name: string }[]>(
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

  // Map: formatted-period -> teacher_id -> total_kwh for O(1) lookup
  const teacherPeriodMap = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    for (const row of teacherBreakdown ?? []) {
      const label = formatPeriodLabel(row.period);
      if (!map.has(label)) map.set(label, new Map());
      map.get(label)!.set(row.teacher_id, row.total_kwh);
    }
    return map;
  }, [teacherBreakdown, formatPeriodLabel]);

  // Memoized chart data transformation - merges teacher kWh values into each period
  const chartData = useMemo(
    () =>
      data.map((item) => {
        const label = formatPeriodLabel(item.period);
        const byTeacher =
          teacherPeriodMap.get(label) ?? new Map<number, number>();
        const teacherEntries = Object.fromEntries(
          uniqueTeachers.map((t) => [
            `t_${t.id}_kwh`,
            byTeacher.get(t.id) ?? null,
          ]),
        );
        return {
          period: label,
          fullPeriod: item.period,
          totalKwh: Number(item.total_kwh.toFixed(4)),
          avgWatts: Number(item.avg_watts.toFixed(1)),
          maxWatts: Number(item.max_watts.toFixed(1)),
          minWatts: Number(item.min_watts.toFixed(1)),
          readings: item.reading_count,
          ...teacherEntries,
        };
      }),
    [data, formatPeriodLabel, teacherPeriodMap, uniqueTeachers],
  );

  // Helper: render a grouped Bar per visible teacher
  const renderTeacherBars = (yAxisId?: string) =>
    uniqueTeachers
      .filter((t) => !(hiddenTeachers ?? new Set()).has(t.id))
      .map((t, i) => (
        <Bar
          key={t.id}
          {...(yAxisId ? { yAxisId } : {})}
          dataKey={`t_${t.id}_kwh`}
          name={`${t.name} (kWh)`}
          fill={teacherColors?.[i % (teacherColors?.length ?? 20)] ?? "#8b5cf6"}
          radius={[4, 4, 0, 0]}
        />
      ));

  if (data.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center bg-gray-50 dark:bg-gray-800 rounded-lg">
        <p className="text-gray-500">
          No data available for the selected period
        </p>
      </div>
    );
  }

  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorKwh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-gray-200 dark:stroke-gray-700"
          />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 12 }}
            className="text-gray-600 dark:text-gray-400"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="text-gray-600 dark:text-gray-400"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Area
            type="monotone"
            dataKey="totalKwh"
            name="Total (kWh)"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#colorKwh)"
          />
          <Area
            type="monotone"
            dataKey="avgWatts"
            name="Avg Power (W)"
            stroke="#10b981"
            fillOpacity={1}
            fill="url(#colorAvg)"
          />
          {renderTeacherBars()}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-gray-200 dark:stroke-gray-700"
          />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 12 }}
            className="text-gray-600 dark:text-gray-400"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            className="text-gray-600 dark:text-gray-400"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar
            dataKey="totalKwh"
            name="Total (kWh)"
            fill="#3b82f6"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="avgWatts"
            name="Avg Power (W)"
            fill="#10b981"
            radius={[4, 4, 0, 0]}
          />
          {renderTeacherBars()}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Default: Composed chart with bars and lines
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart
        data={chartData}
        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-gray-200 dark:stroke-gray-700"
        />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 12 }}
          className="text-gray-600 dark:text-gray-400"
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 12 }}
          className="text-gray-600 dark:text-gray-400"
          label={{
            value: "kWh",
            angle: -90,
            position: "insideLeft",
            style: { textAnchor: "middle" },
          }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 12 }}
          className="text-gray-600 dark:text-gray-400"
          label={{
            value: "Watts",
            angle: 90,
            position: "insideRight",
            style: { textAnchor: "middle" },
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar
          yAxisId="left"
          dataKey="totalKwh"
          name="Total (kWh)"
          fill="#3b82f6"
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="avgWatts"
          name="Avg Power (W)"
          stroke="#10b981"
          strokeWidth={2}
          dot={{ fill: "#10b981", strokeWidth: 2 }}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="maxWatts"
          name="Peak Power (W)"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
        {renderTeacherBars("left")}
      </ComposedChart>
    </ResponsiveContainer>
  );
});
