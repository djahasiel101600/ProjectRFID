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
  status: 'IN' | 'MANUAL_OUT' | 'AUTO_OUT' | 'CASCADE_OUT' | 'INVALID';
  status_display: string;
  rfid_uid_used: string;
  created_at: string;
  duration_minutes: number | null;
  total_kwh: number | null;
}

export interface EnergyLog {
  id: number;
  classroom: number;
  classroom_name: string;
  voltage: number | null;
  current: number | null;
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

export interface MaintenanceRFID {
  id: number;
  rfid_uid: string;
  label: string;
  is_active: boolean;
  created_at: string;
}

export interface OverrideRFID {
  id: number;
  rfid_uid: string;
  teacher: number;
  teacher_name: string;
  is_active: boolean;
  created_at: string;
}

export interface SystemConfig {
  id: number;
  auto_timeout_enabled: boolean;
  auto_timeout_time: string; // "HH:mm" e.g. "22:00"
  auto_timeout_time_display?: string;
  updated_at: string;
}

export interface ClassroomCalibration {
  id: number;
  classroom: number;
  classroom_name?: string;
  voltage_sensitivity: number;
  current_sensitivity: number;
  quiescent_voltage: number | null;
  nominal_voltage: number;
  add_ampere: number;
  updated_at: string;
}

export interface Teacher {
  id: number,
  username: string,
  email: string,
  first_name: string,
  last_name: string,
  full_name: string,
  role: string,
  rfid_uid: string,
  is_active: boolean
}

export interface DashboardClassroom {
  id: number;
  name: string;
  excess_minutes?: number | null;
  expected_out?: string | null;
  current_teacher: Teacher | null;
  time_in: string | null;
  countdown_seconds: number | null;
  current_voltage: number | null;
  current_current: number | null;
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
  classroom_id?: number;
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
  voltage: number | null;
  current: number | null;
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

// Teacher Energy Usage Types
export interface TeacherEnergyUsage {
  id: number;
  teacher: number;
  teacher_name: string;
  classroom: number;
  classroom_name: string;
  attendance_session: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  avg_watts: number;
  max_watts: number;
  min_watts: number;
  total_kwh: number;
  reading_count: number;
  created_at: string;
}

export interface TeacherEnergySummary {
  teacher_id: number;
  teacher_name: string;
  total_kwh: number;
  total_hours: number;
  avg_watts: number;
  session_count: number;
}

export interface TeacherEnergyByClassroom {
  classroom_id: number;
  classroom_name: string;
  total_kwh: number;
  total_hours: number;
  avg_watts: number;
  session_count: number;
}

export interface TeacherEnergyByDate {
  date: string;
  total_kwh: number;
  total_hours: number;
  avg_watts: number;
  session_count: number;
}

export interface TeacherEnergyBreakdown {
  period: string;
  teacher_id: number;
  teacher_name: string;
  total_kwh: number;
  avg_watts: number;
  session_count: number;
}
