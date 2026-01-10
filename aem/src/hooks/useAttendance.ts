import { useState, useEffect, useCallback, useRef } from 'react';
import type { AttendanceSession, WSMessage } from '../types';
import apiService from '../services/api';
import wsService from '../services/websocket';

interface AttendanceFilters {
  date?: string;
  classroom?: number;
  status?: string;
}

export function useAttendance(filters: AttendanceFilters = {}) {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
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
      const params: { date?: string; classroom?: number; status?: string } = {};

      if (filtersRef.current.date) params.date = filtersRef.current.date;
      if (filtersRef.current.classroom) params.classroom = filtersRef.current.classroom;
      if (filtersRef.current.status) params.status = filtersRef.current.status;

      const data = await apiService.getAttendance(params);
      setSessions(data);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch attendance data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [filters.date, filters.classroom, filters.status, fetchData]);

  useEffect(() => {
    // Connect to WebSocket
    wsService.connect(filters.classroom);
    setIsConnected(wsService.isConnected());

    // Subscribe to updates
    const unsubscribe = wsService.subscribe((message: WSMessage) => {
      switch (message.type) {
        case 'attendance':
          // Refresh attendance data on attendance events
          console.log('Attendance event received:', message);
          fetchData();
          break;
        case 'auto_timeout':
          // Refresh on auto-timeout (session ended)
          console.log('Auto-timeout event received:', message);
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

  // Calculate stats from sessions
  const stats = {
    total: sessions.length,
    active: sessions.filter(s => s.status === 'IN').length,
    completed: sessions.filter(s => s.status === 'AUTO_OUT').length,
    invalid: sessions.filter(s => s.status === 'INVALID').length,
  };

  return { 
    sessions, 
    stats,
    isLoading, 
    error, 
    isConnected, 
    lastUpdate,
    refresh 
  };
}
