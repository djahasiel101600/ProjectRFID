import { useState, useEffect, useCallback, useRef } from 'react';
import type { EnergyReport, WSMessage } from '../types';
import apiService from '../services/api';
import wsService from '../services/websocket';

interface EnergyFilters {
  classroom?: number;
  range?: 'hour' | 'day' | 'month';
}

// Debounce delay for power updates (ms)
const POWER_UPDATE_DEBOUNCE = 2000;

export function useEnergy(filters: EnergyFilters = {}) {
  const [reports, setReports] = useState<EnergyReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Track if initial load is complete to avoid loading flash on updates
  const hasInitialLoadRef = useRef(false);
  // Debounce timer ref for power updates
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store filters in ref to access latest value in WebSocket callback
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchData = useCallback(async (showLoading = true) => {
    try {
      // Only show loading spinner on initial load, not on refreshes
      if (showLoading && !hasInitialLoadRef.current) {
        setIsLoading(true);
      }
      const params: { classroom?: number; range?: 'hour' | 'day' | 'month' } = {
        range: filtersRef.current.range || 'day',
      };

      if (filtersRef.current.classroom) {
        params.classroom = filtersRef.current.classroom;
      }

      const data = await apiService.getEnergyReport(params);
      setReports(data);
      setError(null);
      setLastUpdate(new Date());
      hasInitialLoadRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch energy data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced fetch for power updates to prevent excessive API calls
  const debouncedFetchData = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchData(false);
    }, POWER_UPDATE_DEBOUNCE);
  }, [fetchData]);

  useEffect(() => {
    // Reset initial load flag when filters change
    hasInitialLoadRef.current = false;
    fetchData(true);
  }, [filters.classroom, filters.range, fetchData]);

  useEffect(() => {
    // Connect to WebSocket
    wsService.connect(filters.classroom);
    setIsConnected(wsService.isConnected());

    // Subscribe to updates
    const unsubscribe = wsService.subscribe((message: WSMessage) => {
      switch (message.type) {
        case 'power':
          // New power reading received - debounce refresh to avoid excessive updates
          console.log('Power update received:', message);
          debouncedFetchData();
          break;
        case 'initial_data':
          // Connection established, mark as connected
          setIsConnected(true);
          break;
      }
    });

    // Check connection status periodically
    const connectionCheck = setInterval(() => {
      setIsConnected(wsService.isConnected());
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(connectionCheck);
      // Clear any pending debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filters.classroom, debouncedFetchData]);

  const refresh = useCallback(() => {
    wsService.requestRefresh();
    fetchData(false);
  }, [fetchData]);

  // Calculate totals from reports
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

  const stats = {
    totalKwh: totals.totalKwh,
    avgWatts,
    maxWatts: totals.maxWatts,
    dataPoints: reports.length,
  };

  return { 
    reports, 
    stats,
    isLoading, 
    error, 
    isConnected, 
    lastUpdate,
    refresh 
  };
}
