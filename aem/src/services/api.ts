// API Service for IoT Attendance & Energy Tracking System

import type { 
  User, Classroom, Schedule, AttendanceSession, 
  EnergyLog, EnergyReport, DashboardData, LoginResponse 
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

class ApiService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    // Load tokens from localStorage on init
    this.accessToken = localStorage.getItem('access_token');
    this.refreshToken = localStorage.getItem('refresh_token');
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.accessToken) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && this.refreshToken) {
      // Try to refresh the token
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
        });
        if (!retryResponse.ok) {
          throw new Error(`HTTP error! status: ${retryResponse.status}`);
        }
        return retryResponse.json();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'An error occurred' }));
      throw new Error(error.detail || error.error || 'An error occurred');
    }

    return response.json();
  }

  private async refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: this.refreshToken }),
      });

      if (response.ok) {
        const data = await response.json();
        this.accessToken = data.access;
        localStorage.setItem('access_token', data.access);
        return true;
      }
    } catch {
      // Refresh failed, clear tokens
    }

    this.logout();
    return false;
  }

  // Auth
  async login(username: string, password: string): Promise<LoginResponse> {
    const data = await this.request<LoginResponse>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    this.accessToken = data.access;
    this.refreshToken = data.refresh;
    localStorage.setItem('access_token', data.access);
    localStorage.setItem('refresh_token', data.refresh);
    localStorage.setItem('user', JSON.stringify(data.user));

    return data;
  }

  logout(): void {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getUser(): User | null {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  }

  // Dashboard
  async getDashboard(): Promise<DashboardData> {
    return this.request<DashboardData>('/dashboard/');
  }

  // Users
  async getUsers(): Promise<User[]> {
    const response = await this.request<{ results: User[] }>('/users/');
    return response.results || response as unknown as User[];
  }

  async getTeachers(): Promise<User[]> {
    return this.request<User[]>('/users/teachers/');
  }

  async createUser(user: Partial<User> & { password: string }): Promise<User> {
    return this.request<User>('/users/', {
      method: 'POST',
      body: JSON.stringify(user),
    });
  }

  async updateUser(id: number, user: Partial<User>): Promise<User> {
    return this.request<User>(`/users/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(user),
    });
  }

  async deleteUser(id: number): Promise<void> {
    await this.request(`/users/${id}/`, { method: 'DELETE' });
  }

  async assignRfid(userId: number, rfidUid: string): Promise<User> {
    return this.request<User>(`/users/${userId}/assign_rfid/`, {
      method: 'POST',
      body: JSON.stringify({ rfid_uid: rfidUid }),
    });
  }

  // Classrooms
  async getClassrooms(): Promise<Classroom[]> {
    const response = await this.request<{ results: Classroom[] }>('/classrooms/');
    return response.results || response as unknown as Classroom[];
  }

  async getClassroom(id: number): Promise<Classroom> {
    return this.request<Classroom>(`/classrooms/${id}/`);
  }

  async createClassroom(classroom: Partial<Classroom> & { device_token: string }): Promise<Classroom> {
    return this.request<Classroom>('/classrooms/', {
      method: 'POST',
      body: JSON.stringify(classroom),
    });
  }

  async updateClassroom(id: number, classroom: Partial<Classroom>): Promise<Classroom> {
    return this.request<Classroom>(`/classrooms/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(classroom),
    });
  }

  async deleteClassroom(id: number): Promise<void> {
    await this.request(`/classrooms/${id}/`, { method: 'DELETE' });
  }

  // Schedules
  async getSchedules(params?: { teacher?: number; classroom?: number; day?: number }): Promise<Schedule[]> {
    const searchParams = new URLSearchParams();
    if (params?.teacher) searchParams.append('teacher', params.teacher.toString());
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.day !== undefined) searchParams.append('day', params.day.toString());

    const query = searchParams.toString();
    const response = await this.request<{ results: Schedule[] }>(`/schedules/${query ? `?${query}` : ''}`);
    return response.results || response as unknown as Schedule[];
  }

  async getTodaySchedules(): Promise<Schedule[]> {
    return this.request<Schedule[]>('/schedules/today/');
  }

  async createSchedule(schedule: Partial<Schedule>): Promise<Schedule> {
    return this.request<Schedule>('/schedules/', {
      method: 'POST',
      body: JSON.stringify(schedule),
    });
  }

  async updateSchedule(id: number, schedule: Partial<Schedule>): Promise<Schedule> {
    return this.request<Schedule>(`/schedules/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(schedule),
    });
  }

  async deleteSchedule(id: number): Promise<void> {
    await this.request(`/schedules/${id}/`, { method: 'DELETE' });
  }

  // Attendance
  async getAttendance(params?: { date?: string; classroom?: number; teacher?: number; status?: string }): Promise<AttendanceSession[]> {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.append('date', params.date);
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.teacher) searchParams.append('teacher', params.teacher.toString());
    if (params?.status) searchParams.append('status', params.status);

    const query = searchParams.toString();
    const response = await this.request<{ results?: AttendanceSession[] } | AttendanceSession[]>(`/attendance/${query ? `?${query}` : ''}`);
    
    // Handle both paginated response (with results) and direct array response
    if (Array.isArray(response)) {
      return response;
    }
    return response.results || [];
  }

  async getTodayAttendance(): Promise<AttendanceSession[]> {
    return this.request<AttendanceSession[]>('/attendance/today/');
  }

  async getActiveAttendance(): Promise<AttendanceSession[]> {
    return this.request<AttendanceSession[]>('/attendance/active/');
  }

  async getAttendanceReport(startDate?: string, endDate?: string): Promise<AttendanceSession[]> {
    const searchParams = new URLSearchParams();
    if (startDate) searchParams.append('start_date', startDate);
    if (endDate) searchParams.append('end_date', endDate);

    const query = searchParams.toString();
    return this.request<AttendanceSession[]>(`/attendance/report/${query ? `?${query}` : ''}`);
  }

  // Energy
  async getEnergyLogs(params?: { classroom?: number; start?: string; end?: string }): Promise<EnergyLog[]> {
    const searchParams = new URLSearchParams();
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    const response = await this.request<{ results: EnergyLog[] }>(`/energy-logs/${query ? `?${query}` : ''}`);
    return response.results || response as unknown as EnergyLog[];
  }

  async getLatestEnergy(): Promise<{ classroom_id: number; classroom_name: string; watts: number; timestamp: string }[]> {
    return this.request('/energy-logs/latest/');
  }

  async getEnergyReport(params?: { classroom?: number; range?: 'hour' | 'day' | 'month'; start?: string; end?: string }): Promise<EnergyReport[]> {
    const searchParams = new URLSearchParams();
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.range) searchParams.append('range', params.range);
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    return this.request<EnergyReport[]>(`/energy/report/${query ? `?${query}` : ''}`);
  }
}

export const apiService = new ApiService();
export default apiService;
