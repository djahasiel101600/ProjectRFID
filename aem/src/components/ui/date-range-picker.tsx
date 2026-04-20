import * as React from "react";
import { Input } from "./input";
import { Label } from "./label";
import { cn } from "@/lib/utils";

export interface DateRangePickerProps {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onClear: () => void;
  className?: string;
}

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
  className,
}: DateRangePickerProps) {
  const hasValues = !!from || !!to;
  const hasError = !!from && !!to && from > to;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="date-from" className="mb-1 block">
            From
          </Label>
          <Input
            id="date-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFromChange(e.target.value)}
            className={hasError ? "border-red-500 focus-visible:ring-red-400" : ""}
          />
        </div>
        <div className="flex-1">
          <Label htmlFor="date-to" className="mb-1 block">
            To
          </Label>
          <Input
            id="date-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onToChange(e.target.value)}
            className={hasError ? "border-red-500 focus-visible:ring-red-400" : ""}
          />
        </div>
        {hasValues && (
          <button
            type="button"
            onClick={onClear}
            title="Clear date range"
            className="h-9 shrink-0 rounded-md border border-input px-3 text-sm text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Clear
          </button>
        )}
      </div>
      {hasError && (
        <p className="text-xs text-red-500">Start date must be before end date.</p>
      )}
      {!hasValues && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Leave blank to use the default rolling window for the selected grouping.
        </p>
      )}
    </div>
  );
}
