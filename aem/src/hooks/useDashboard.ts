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
  const [powerHistory, setPowerHistory] = useState<PowerReading[]>([]);
  const classroomNamesRef = useRef<Map<number, string>>(new Map());
  
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

  useEffect(() => {
    fetchData(true);

    // Connect to WebSocket
    wsService.connect(classroomId);

    // Subscribe to updates
    const unsubscribe = wsService.subscribe((message: WSMessage) => {
      console.log('Dashboard WebSocket message:', message.type, message);
      
      switch (message.type) {
        case 'initial_data':
          setIsConnected(true);
          if (message.data) {
            setData(message.data);
          }
          break;
        case 'attendance':
          // Refresh data on attendance events to update classroom cards
          console.log('Attendance event - refreshing dashboard data');
          fetchData(false);
          break;
        case 'power':
          // Update power for specific classroom in real-time
          console.log('Power update for classroom:', message.classroom_id, message.watts, 'W');
          
          // Add to power history for real-time chart
          setPowerHistory(prev => {
            const newReading: PowerReading = {
              timestamp: message.timestamp || new Date().toISOString(),
              watts: message.watts,
              classroomId: message.classroom_id,
              classroomName: classroomNamesRef.current.get(message.classroom_id) || `Room ${message.classroom_id}`,
            };
            const updated = [...prev, newReading];
            // Keep only last MAX_POWER_HISTORY readings
            return updated.slice(-MAX_POWER_HISTORY);
          });
          
          // Update dashboard data
          setData(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              classrooms: prev.classrooms.map(c => 
                c.id === message.classroom_id 
                  ? { ...c, current_power: message.watts, last_power_update: message.timestamp }
                  : c
              )
            };
          });
          break;
        case 'auto_timeout':
          // Refresh data on auto-timeout
          console.log('Auto-timeout event - refreshing dashboard data');
          fetchData(false);
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
      wsService.disconnect();
    };
  }, [classroomId, fetchData]);

  const refresh = () => {
    wsService.requestRefresh();
    fetchData(false);
  };

  const clearPowerHistory = () => {
    setPowerHistory([]);
  };

  return { data, isLoading, error, isConnected, powerHistory, refresh, clearPowerHistory };
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
