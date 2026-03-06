import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardData, WSMessage } from '../types';
import apiService from '../services/api';
import wsService from '../services/websocket';
import type { PowerReading } from '../components/RealtimePowerChart';

const MAX_POWER_HISTORY = 100; // Keep last 100 readings

export function useDashboard(classroomId?: number) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [powerHistory, setPowerHistory] = useState<PowerReading[]>([]);
  const classroomNamesRef = useRef<Map<number, string>>(new Map());
  const wasConnectedRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track if initial load is complete to avoid loading flash on updates
  const hasInitialLoadRef = useRef(false);

  const fetchData = useCallback(async (showLoading = true) => {
    try {
      // Only show loading spinner on initial load, not on refreshes
      if (showLoading && !hasInitialLoadRef.current) {
        setIsLoading(true);
      }
      const dashboardData = await apiService.getDashboard();
      setData(dashboardData);
      
      // Cache classroom names for power history
      dashboardData.classrooms.forEach(c => {
        classroomNamesRef.current.set(c.id, c.name);
      });
      
      setError(null);
      hasInitialLoadRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Debounced refresh to avoid race conditions with database updates
  const debouncedRefresh = useCallback((delay = 500) => {
    // Clear any pending refresh
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    
    // Schedule new refresh after delay
    refreshTimerRef.current = setTimeout(() => {
      fetchData(false);
      refreshTimerRef.current = null;
    }, delay);
  }, [fetchData]);

  useEffect(() => {
    fetchData(true);

    // Connect to WebSocket
    wsService.connect(classroomId);

    // Subscribe to updates
    const unsubscribe = wsService.subscribe((message: WSMessage) => {
      console.log('Dashboard WebSocket message:', message.type, message);
      
      switch (message.type) {
        case 'initial_data':
          const currentlyConnected = wsService.isConnected();
          const wasDisconnected = wasConnectedRef.current && !currentlyConnected;
          
          setIsConnected(true);
          setIsReconnecting(false);
          
          // If we just reconnected, refresh all data
          if (wasDisconnected) {
            console.log('WebSocket reconnected - refreshing all data');
            fetchData(false);
          } else if (message.data) {
            setData(message.data);
          }
          
          wasConnectedRef.current = true;
          break;
        case 'attendance':
          // Refresh data on attendance events with a delay to avoid race conditions
          // This allows the database transaction to complete before fetching
          console.log('Attendance event - scheduling refresh with delay');
          debouncedRefresh(500);
          break;
        case 'power':
          // Update power for specific classroom in real-time
          console.log('Power update for classroom:', message.classroom_id, message.watts, 'W', message.voltage, 'V', message.current, 'A');
          
          // Validate power data before adding to history
          if (message.classroom_id && typeof message.watts === 'number') {
            // Add to power history for real-time chart
            setPowerHistory(prev => {
              const newReading: PowerReading = {
                timestamp: message.timestamp || new Date().toISOString(),
                voltage: message.voltage ?? null,
                current: message.current ?? null,
                watts: message.watts,
                classroomId: message.classroom_id,
                classroomName: classroomNamesRef.current.get(message.classroom_id) || `Room ${message.classroom_id}`,
              };
              const updated = [...prev, newReading];
              // Keep only last MAX_POWER_HISTORY readings
              return updated.slice(-MAX_POWER_HISTORY);
            });
          }
          
          // Update dashboard data (use Number() to handle string/number mismatch from JSON)
          setData(prev => {
            if (!prev) return prev;
            const mid = Number(message.classroom_id);
            return {
              ...prev,
              classrooms: prev.classrooms.map(c => 
                Number(c.id) === mid 
                  ? { 
                      ...c, 
                      current_voltage: message.voltage ?? null,
                      current_current: message.current ?? null,
                      current_power: message.watts ?? null,
                      last_power_update: message.timestamp || new Date().toISOString()
                    }
                  : c
              )
            };
          });
          break;
        case 'auto_timeout':
          // Refresh data on auto-timeout with a delay
          console.log('Auto-timeout event - scheduling refresh with delay');
          debouncedRefresh(500);
          break;
      }
    });

    // Check connection status periodically
    const connectionCheck = setInterval(() => {
      const connected = wsService.isConnected();
      const wasConnected = wasConnectedRef.current;
      
      setIsConnected(connected);
      
      // Detect disconnection
      if (wasConnected && !connected) {
        console.log('WebSocket disconnected - entering reconnecting state');
        setIsReconnecting(true);
        wasConnectedRef.current = false;
      }
      // Detect reconnection
      else if (!wasConnected && connected) {
        console.log('WebSocket reconnected - refreshing data');
        setIsReconnecting(false);
        wasConnectedRef.current = true;
        fetchData(false);
      }
    }, 1000); // Check every second for more responsive UI

    return () => {
      unsubscribe();
      clearInterval(connectionCheck);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      wsService.disconnect();
    };
  }, [classroomId, fetchData, debouncedRefresh]);

  const refresh = () => {
    wsService.requestRefresh();
    fetchData(false);
  };

  const clearPowerHistory = () => {
    setPowerHistory([]);
  };

  return { data, isLoading, error, isConnected, isReconnecting, powerHistory, refresh, clearPowerHistory };
}

export function useCountdown(targetSeconds: number | null) {
  const [remaining, setRemaining] = useState(targetSeconds ?? 0);

  useEffect(() => {
    if (targetSeconds === null) {
      setRemaining(0);
      return;
    }

    setRemaining(targetSeconds);

    const interval = setInterval(() => {
      setRemaining(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [targetSeconds]);

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  return { remaining, formatted: formatTime(remaining) };
}
