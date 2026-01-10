// WebSocket Service for real-time updates

import type { WSMessage } from '../types';

type MessageHandler = (message: WSMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private handlers: Set<MessageHandler> = new Set();
  private classroomId: number | null = null;
  private isConnecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(classroomId?: number): void {
    // Prevent multiple simultaneous connections
    if (this.isConnecting) {
      return;
    }

    // If already connected to the same endpoint, don't reconnect
    if (this.ws?.readyState === WebSocket.OPEN && this.classroomId === (classroomId ?? null)) {
      return;
    }

    // Close existing connection if any
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }

    // Clear any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.classroomId = classroomId ?? null;
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
    const endpoint = classroomId 
      ? `${wsUrl}/ws/dashboard/classroom/${classroomId}/`
      : `${wsUrl}/ws/dashboard/`;

    try {
      this.ws = new WebSocket(endpoint);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.handlers.forEach(handler => handler(message));
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.isConnecting = false;
        this.ws = null;
        // Only reconnect on unexpected close
        if (event.code !== 1000) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.isConnecting = false;
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already attempting to reconnect
    }
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect(this.classroomId ?? undefined);
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  requestRefresh(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'refresh' }));
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();
export default wsService;
