import { useState, useEffect, useCallback, useRef } from 'react';

interface RFIDScannerHook {
  isScanning: boolean;
  scannedRFID: string | null;
  scanError: string | null;
  startScan: (classroomId: number) => void;
  clearScan: () => void;
}

export function useRFIDScanner(): RFIDScannerHook {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedRFID, setScannedRFID] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectingRef = useRef(false);

  const connect = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      // Prevent multiple connection attempts
      if (connectingRef.current) {
        resolve(false);
        return;
      }

      // If already connected, return success
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve(true);
        return;
      }

      connectingRef.current = true;
      const wsBase = (() => {
        const envUrl = import.meta.env.VITE_WS_URL;
        if (envUrl) return envUrl.replace(/\/$/, '');
        if (typeof window !== 'undefined') {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          return `${protocol}//${window.location.host}`;
        }
        return 'ws://localhost:8000';
      })();
      const fullUrl = `${wsBase}/ws/admin/rfid-scan/`;
      
      console.log(`Connecting to RFID scan WebSocket: ${fullUrl}`);

      try {
        const ws = new WebSocket(fullUrl);

        const timeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket connection timeout');
            ws.close();
            connectingRef.current = false;
            setScanError('Connection timeout. Is the backend running?');
            resolve(false);
          }
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          console.log('Admin RFID scan WebSocket connected successfully');
          connectingRef.current = false;
          resolve(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('RFID scan message:', data);

            if (data.type === 'scan_result') {
              setScannedRFID(data.rfid_uid);
              setIsScanning(false);
              setScanError(null);
            } else if (data.type === 'scan_timeout') {
              setScanError('Scan timeout. Please try again.');
              setIsScanning(false);
            }
          } catch (err) {
            console.error('Error parsing RFID scan message:', err);
          }
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          console.error('RFID scan WebSocket error:', error);
          connectingRef.current = false;
          setScanError('Connection failed. Please check if the backend is running.');
          setIsScanning(false);
          resolve(false);
        };

        ws.onclose = (event) => {
          clearTimeout(timeout);
          console.log('Admin RFID scan WebSocket disconnected', event.code, event.reason);
          connectingRef.current = false;
          if (isScanning) {
            setScanError('Connection lost. Please try again.');
            setIsScanning(false);
          }
        };

        wsRef.current = ws;
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
        connectingRef.current = false;
        setScanError('Failed to create connection. Please check your network.');
        resolve(false);
      }
    });
  }, [isScanning]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      console.log('Disconnecting RFID scan WebSocket');
      wsRef.current.close();
      wsRef.current = null;
    }
    connectingRef.current = false;
  }, []);

  const startScan = useCallback(
    async (classroomId: number) => {
      console.log(`Starting RFID scan for classroom ${classroomId}`);
      setIsScanning(true);
      setScannedRFID(null);
      setScanError(null);

      // Ensure connection is established
      const isConnected = await connect();
      
      if (!isConnected) {
        console.error('Failed to establish WebSocket connection');
        setIsScanning(false);
        return;
      }

      // Wait a bit for connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send scan command
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          const message = JSON.stringify({
            action: 'start_scan',
            classroom_id: classroomId,
          });
          console.log('Sending scan command:', message);
          wsRef.current.send(message);
        } catch (err) {
          console.error('Failed to send scan command:', err);
          setScanError('Failed to send scan command. Please try again.');
          setIsScanning(false);
        }
      } else {
        console.error('WebSocket not open, state:', wsRef.current?.readyState);
        setScanError('Connection not ready. Please try again.');
        setIsScanning(false);
      }
    },
    [connect]
  );

  const clearScan = useCallback(() => {
    setScannedRFID(null);
    setScanError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { isScanning, scannedRFID, scanError, startScan, clearScan };
}
