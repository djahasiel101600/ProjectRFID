import { useState, useEffect, useCallback, useRef } from 'react';
import type { EnergyReport, WSMessage } from '../types';
import apiService from '../services/api';
import wsService from '../services/websocket';

interface EnergyFilters {
  classroom?: number;
  range?: 'hour' | 'day' | 'month';
}

export function useEnergy(filters: EnergyFilters = {}) {
  const [reports, setReports] = useState<EnergyReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Store filters in ref to access latest value in WebSocket callback
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch energy data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [filters.classroom, filters.range, fetchData]);

  useEffect(() => {
    // Connect to WebSocket
    wsService.connect(filters.classroom);
    setIsConnected(wsService.isConnected());

    // Subscribe to updates
    const unsubscribe = wsService.subscribe((message: WSMessage) => {
      switch (message.type) {
        case 'power':
          // New power reading received - refresh energy data
          console.log('Power update received:', message);
          fetchData();
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
    };
  }, [filters.classroom, fetchData]);

  const refresh = useCallback(() => {
    wsService.requestRefresh();
    fetchData();
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
