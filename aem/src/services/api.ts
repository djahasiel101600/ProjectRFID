// API Service for IoT Attendance & Energy Tracking System

import type { 
  User, Classroom, Schedule, AttendanceSession, 
  EnergyLog, EnergyReport, DashboardData, LoginResponse,
  TeacherEnergyUsage, TeacherEnergySummary, TeacherEnergyByClassroom, TeacherEnergyByDate,
  TeacherEnergyBreakdown,
  OverrideRFID,
  MaintenanceRFID,
  SystemConfig,
  ClassroomCalibration,
  WeeklyScheduleEntry
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
  async getSetupStatus(): Promise<{ needs_setup: boolean }> {
    const response = await fetch(`${API_BASE_URL}/auth/setup-status/`);
    return response.json();
  }

  async register(data: {
    username: string;
    email: string;
    password: string;
    first_name?: string;
    last_name?: string;
  }): Promise<LoginResponse> {
    const result = await fetch(`${API_BASE_URL}/auth/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await result.json();
    if (!result.ok) {
      throw new Error(json.error || 'Registration failed');
    }
    this.accessToken = json.access;
    this.refreshToken = json.refresh;
    localStorage.setItem('access_token', json.access);
    localStorage.setItem('refresh_token', json.refresh);
    localStorage.setItem('user', JSON.stringify(json.user));
    return json;
  }

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

  /** Create teacher: first_name, last_name, email only (no username/password). */
  async createTeacher(data: { first_name: string; last_name: string; email: string; rfid_uid?: string }): Promise<User> {
    return this.request<User>('/users/', {
      method: 'POST',
      body: JSON.stringify({ ...data, role: 'teacher' }),
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

  // Override RFID (substitute cards)
  async getOverrideRFIDs(): Promise<OverrideRFID[]> {
    const response = await this.request<{ results: OverrideRFID[] } | OverrideRFID[]>('/override-rfids/');
    return Array.isArray(response) ? response : (response.results || []);
  }

  async createOverrideRFID(data: { rfid_uid: string; teacher: number }): Promise<OverrideRFID> {
    return this.request<OverrideRFID>('/override-rfids/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteOverrideRFID(id: number): Promise<void> {
    await this.request(`/override-rfids/${id}/`, { method: 'DELETE' });
  }

  // Maintenance RFID (staff - lights control only)
  async getMaintenanceRFIDs(): Promise<MaintenanceRFID[]> {
    const response = await this.request<{ results: MaintenanceRFID[] } | MaintenanceRFID[]>('/maintenance-rfids/');
    return Array.isArray(response) ? response : (response.results || []);
  }

  async createMaintenanceRFID(data: { rfid_uid: string; label?: string }): Promise<MaintenanceRFID> {
    return this.request<MaintenanceRFID>('/maintenance-rfids/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteMaintenanceRFID(id: number): Promise<void> {
    await this.request(`/maintenance-rfids/${id}/`, { method: 'DELETE' });
  }

  // System config (auto-timeout)
  async getSystemConfig(): Promise<SystemConfig> {
    return this.request<SystemConfig>('/system-config/');
  }

  async updateSystemConfig(data: Partial<Pick<SystemConfig, 'auto_timeout_enabled' | 'auto_timeout_time'>>): Promise<SystemConfig> {
    return this.request<SystemConfig>('/system-config/', {
      method: 'PATCH',
      body: JSON.stringify(data),
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

  // Classroom calibration (voltage/current sensors)
  async getClassroomCalibration(classroomId: number): Promise<ClassroomCalibration> {
    return this.request<ClassroomCalibration>(`/classrooms/${classroomId}/calibration/`);
  }

  async updateClassroomCalibration(
    classroomId: number,
    data: Partial<Pick<ClassroomCalibration, 'voltage_sensitivity' | 'current_sensitivity' | 'quiescent_voltage' | 'nominal_voltage' | 'add_ampere'>>
  ): Promise<ClassroomCalibration> {
    return this.request<ClassroomCalibration>(`/classrooms/${classroomId}/calibration/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async calibrateNow(classroomId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/classrooms/${classroomId}/calibrate-now/`, {
      method: 'POST',
    });
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

  async getWeeklySchedule(weekStart: string): Promise<WeeklyScheduleEntry[]> {
    return this.request<WeeklyScheduleEntry[]>(`/schedules/weekly/?week_start=${weekStart}`);
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
  async getAttendance(params?: {
    date?: string;
    start_date?: string;
    end_date?: string;
    classroom?: number;
    teacher?: number;
    status?: string;
  }): Promise<AttendanceSession[]> {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.append('date', params.date);
    if (params?.start_date) searchParams.append('start_date', params.start_date);
    if (params?.end_date) searchParams.append('end_date', params.end_date);
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

  async exportAttendance(params?: {
    date?: string;
    start_date?: string;
    end_date?: string;
    classroom?: number;
    teacher?: number;
    status?: string;
  }): Promise<AttendanceSession[]> {
    const searchParams = new URLSearchParams();
    if (params?.date) searchParams.append('date', params.date);
    if (params?.start_date) searchParams.append('start_date', params.start_date);
    if (params?.end_date) searchParams.append('end_date', params.end_date);
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.teacher) searchParams.append('teacher', params.teacher.toString());
    if (params?.status) searchParams.append('status', params.status);
    searchParams.append('no_page', '1');

    const query = searchParams.toString();
    const response = await this.request<{ results?: AttendanceSession[] } | AttendanceSession[]>(`/attendance/?${query}`);
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

  async getEnergyReport(params?: { classroom?: number; range?: 'hour' | 'day' | 'week' | 'month'; start?: string; end?: string }): Promise<EnergyReport[]> {
    const searchParams = new URLSearchParams();
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.range) searchParams.append('range', params.range);
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    return this.request<EnergyReport[]>(`/energy/report/${query ? `?${query}` : ''}`);
  }

  // Teacher Energy Usage
  async getTeacherEnergy(params?: { 
    teacher?: number; 
    classroom?: number; 
    start?: string; 
    end?: string 
  }): Promise<TeacherEnergyUsage[]> {
    const searchParams = new URLSearchParams();
    if (params?.teacher) searchParams.append('teacher', params.teacher.toString());
    if (params?.classroom) searchParams.append('classroom', params.classroom.toString());
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    const response = await this.request<{ results?: TeacherEnergyUsage[] } | TeacherEnergyUsage[]>(
      `/teacher-energy/${query ? `?${query}` : ''}`
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    return response.results || [];
  }

  async getTeacherEnergySummary(params?: { 
    start?: string; 
    end?: string 
  }): Promise<TeacherEnergySummary[]> {
    const searchParams = new URLSearchParams();
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    return this.request<TeacherEnergySummary[]>(
      `/teacher-energy/summary/${query ? `?${query}` : ''}`
    );
  }

  async getTeacherEnergyByClassroom(teacherId: number, params?: {
    start?: string;
    end?: string;
  }): Promise<TeacherEnergyByClassroom[]> {
    const searchParams = new URLSearchParams();
    searchParams.append('teacher', teacherId.toString());
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    return this.request<TeacherEnergyByClassroom[]>(
      `/teacher-energy/by_classroom/?${query}`
    );
  }

  async getTeacherEnergyByDate(params?: {
    teacher?: number;
    start?: string;
    end?: string;
  }): Promise<TeacherEnergyByDate[]> {
    const searchParams = new URLSearchParams();
    if (params?.teacher) searchParams.append('teacher', params.teacher.toString());
    if (params?.start) searchParams.append('start', params.start);
    if (params?.end) searchParams.append('end', params.end);

    const query = searchParams.toString();
    return this.request<TeacherEnergyByDate[]>(
      `/teacher-energy/by_date/${query ? `?${query}` : ''}`
    );
  }

  async recalculateTeacherEnergy(): Promise<{ message: string }> {
    return this.request<{ message: string }>('/teacher-energy/recalculate/', {
      method: 'POST',
    });
  }

  // Data export
  async exportAllData(params?: { start_date?: string; end_date?: string }): Promise<void> {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.append('start_date', params.start_date);
    if (params?.end_date)   searchParams.append('end_date',   params.end_date);

    const query = searchParams.toString();
    const response = await fetch(
      `${API_BASE_URL}/export/${query ? `?${query}` : ''}`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } },
    );

    if (response.status === 401 && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        const retry = await fetch(
          `${API_BASE_URL}/export/${query ? `?${query}` : ''}`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } },
        );
        if (!retry.ok) throw new Error('Export failed');
        await this._downloadBlob(retry);
        return;
      }
    }

    if (!response.ok) throw new Error('Export failed');
    await this._downloadBlob(response);
  }

  private async _downloadBlob(response: Response): Promise<void> {
    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href     = url;
    a.download = `export_${stamp}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async getTeacherEnergyBreakdown(params?: {
    classroom?: number;
    range?: 'hour' | 'day' | 'week' | 'month';
    start?: string;
    end?: string;
  }): Promise<TeacherEnergyBreakdown[]> {
    const sp = new URLSearchParams();
    if (params?.classroom) sp.append('classroom', params.classroom.toString());
    if (params?.range)     sp.append('range',     params.range);
    if (params?.start)     sp.append('start',     params.start);
    if (params?.end)       sp.append('end',       params.end);
    const q = sp.toString();
    return this.request<TeacherEnergyBreakdown[]>(
      `/energy/teacher-breakdown/${q ? `?${q}` : ''}`
    );
  }
}

export const apiService = new ApiService();
export default apiService;
