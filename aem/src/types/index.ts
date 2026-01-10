// API Types for IoT Attendance & Energy Tracking System

export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: 'admin' | 'teacher';
  rfid_uid: string | null;
  is_active: boolean;
}

export interface Classroom {
  id: number;
  name: string;
  device_id: string;
  device_token: string;
  is_active: boolean;
  current_teacher: User | null;
  current_power: number | null;
  created_at: string;
  updated_at: string;
}

export interface Schedule {
  id: number;
  teacher: number;
  teacher_name: string;
  classroom: number;
  classroom_name: string;
  day_of_week: number;
  day_name: string;
  start_time: string;
  end_time: string;
  subject: string;
}

export interface AttendanceSession {
  id: number;
  teacher: number;
  teacher_name: string;
  classroom: number;
  classroom_name: string;
  schedule: number | null;
  date: string;
  time_in: string;
  time_out: string | null;
  expected_out: string | null;
  status: 'IN' | 'AUTO_OUT' | 'INVALID';
  status_display: string;
  rfid_uid_used: string;
  created_at: string;
}

export interface EnergyLog {
  id: number;
  classroom: number;
  classroom_name: string;
  watts: number;
  timestamp: string;
  created_at: string;
}

export interface EnergyReport {
  period: string;
  total_kwh: number;
  avg_watts: number;
  max_watts: number;
  min_watts: number;
  reading_count: number;
}

export interface DashboardClassroom {
  id: number;
  name: string;
  current_teacher: { id: number; name: string } | null;
  time_in: string | null;
  countdown_seconds: number | null;
  current_power: number | null;
  last_power_update: string | null;
}

export interface DashboardStats {
  total_today: number;
  active: number;
  completed: number;
  invalid: number;
}

export interface DashboardData {
  classrooms: DashboardClassroom[];
  stats: DashboardStats;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface AttendanceReport {
  date: string;
  total_sessions: number;
  valid_sessions: number;
  invalid_sessions: number;
  auto_timeout_sessions: number;
}

// WebSocket message types
export interface WSAttendanceEvent {
  type: 'attendance';
  event: 'attendance_in' | 'attendance_duplicate' | 'attendance_invalid' | 'attendance_error';
  data: {
    session_id?: number;
    teacher?: string;
    teacher_id?: number;
    classroom?: string;
    classroom_id?: number;
    time?: string;
    expected_out?: string | null;
    status?: string;
    schedule_subject?: string | null;
    message?: string;
    rfid_uid?: string;
  };
}

export interface WSPowerEvent {
  type: 'power';
  classroom_id: number;
  watts: number;
  timestamp: string;
}

export interface WSAutoTimeoutEvent {
  type: 'auto_timeout';
  data: {
    session_id: number;
    teacher: string;
    teacher_id: number;
    classroom: string;
    classroom_id: number;
    time_out: string;
  };
}

export interface WSInitialDataEvent {
  type: 'initial_data';
  data: DashboardData;
}

export type WSMessage = WSAttendanceEvent | WSPowerEvent | WSAutoTimeoutEvent | WSInitialDataEvent;
