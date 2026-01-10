# Project Requirements Document (PRD)

## 1. Project Overview

### 1.1 Project Title

**IoT-Based Attendance & Energy Consumption Tracking System**

### 1.2 Project Description

This project is a web-based system designed to automatically track teacher attendance and classroom energy consumption using IoT devices. An ESP32 device installed in each classroom handles RFID-based attendance input and power sensor readings, which are transmitted in real time to a Django REST backend. The frontend, built with React and TypeScript, displays real-time and historical attendance and energy data.

The system is intended for **single-building deployment** and prioritizes automation, accuracy, and real-time visibility.

### 1.3 Objectives

- Automate teacher attendance using RFID with schedule-based validation
- Automatically time-out attendance sessions without manual logout
- Track total electricity consumption per classroom
- Provide real-time dashboards for attendance and energy usage
- Generate historical reports for attendance and energy consumption

---

## 2. Technology Stack

### 2.1 Backend

- **Framework:** Django REST Framework
- **Real-time:** Django Channels (WebSockets)
- **Database:** PostgreSQL (hosted via Supabase)
- **Background Jobs:** Cron / Celery Beat (for auto-timeout)

### 2.2 Frontend

- **Framework:** React
- **Language:** TypeScript
- **Build Tool:** Vite
- **State Management:** TanStack Query
- **UI:** Tailwind CSS + Shadcn UI
- **Charts:** Recharts or Chart.js

### 2.3 IoT

- **Device:** ESP32
- **Sensors:** RFID reader, power consumption sensor
- **Protocol:** WebSocket

Documentation References:
Django: https://www.django-rest-framework.org/#installation
Django Channels: https://channels.readthedocs.io/en/latest/installation.html
Tailwindcss (installation already implemented): https://tailwindcss.com/docs/installation/using-vite
Shadcn UI (installation already implemented): https://ui.shadcn.com/docs/installation/vite
Rechart:https://recharts.github.io/en-US/api/

---

## 3. System Architecture

### 3.1 High-Level Flow

ESP32 → Django Backend → PostgreSQL (Supabase) → React Frontend

- ESP32 communicates with Django via WebSocket
- Django validates and processes data, then persists to PostgreSQL
- Frontend communicates with Django via REST and WebSocket

---

## 4. Functional Requirements

### 4.1 User Roles

#### Admin

- Manage teachers
- Assign RFID tags
- Create classrooms
- Configure schedules
- View reports

#### Teacher

- Uses RFID only (no web interaction required)

---

### 4.2 Attendance Management

#### Attendance Rules

- Attendance is triggered by **RFID TIME-IN only**
- No RFID TIME-OUT
- Attendance automatically times out based on schedule end time
- Invalid attendance is logged if RFID is scanned outside schedule

#### Attendance States

- `IN`
- `AUTO_OUT`
- `INVALID`

#### Attendance Session Behavior

- One active attendance session per teacher per classroom per day
- Auto-timeout job runs periodically to close open sessions

---

### 4.3 Energy Consumption Tracking

- Energy tracking is **per classroom only**
- One ESP32 device per classroom
- Power readings are logged continuously
- Energy consumption (kWh) is calculated from watt readings
- Aggregation supported by hour, day, and month

---

### 4.4 Real-Time Updates

The system must support real-time updates for:

- Teacher time-in events
- Auto-timeout events
- Current classroom power usage

WebSockets must be used for all real-time features.

---

## 5. Data Models (Logical)

### 5.1 User (Teacher)

- id
- name
- rfid_uid
- role

### 5.2 Classroom

- id
- name
- device_id

### 5.3 Schedule

- id
- teacher_id
- classroom_id
- day_of_week
- start_time
- end_time

### 5.4 AttendanceSession

- id
- teacher_id
- classroom_id
- date
- time_in
- time_out (nullable)
- expected_out
- status

### 5.5 EnergyLog

- id
- classroom_id
- watts
- timestamp

---

## 6. API Requirements

### 6.1 REST Endpoints (Indicative)

- `POST /api/auth/login/`
- `GET /api/classrooms/`
- `GET /api/schedules/`
- `GET /api/attendance/?date=`
- `GET /api/energy/?classroom=&range=`

### 6.2 WebSocket Endpoints

#### ESP32 → Backend

- `/ws/iot/classroom/{classroom_id}/`

#### Backend → Frontend

- `/ws/dashboard/classroom/{classroom_id}/`

---

## 7. WebSocket Message Contracts

### 7.1 ESP32 Payload

```json
{
  "device_id": "ESP32-ROOM-01",
  "rfid_uid": "A1B2C3D4",
  "power": 245.6,
  "timestamp": "2026-01-10T09:00:00Z"
}
```

### 7.2 Backend Broadcast Example

```json
{
  "event": "attendance_in",
  "teacher": "Juan Dela Cruz",
  "classroom": "Room 101",
  "time": "09:00"
}
```

---

## 8. Frontend Requirements

### 8.1 Pages

- Login
- Dashboard (real-time attendance & energy)
- Attendance Reports
- Energy Reports
- Admin Management

### 8.2 Dashboard Widgets

- Current teacher per classroom
- Countdown to auto-timeout
- Live wattage display
- Energy consumption charts

---

## 9. Security Requirements

- ESP32 devices authenticated via device token or API key
- JWT authentication for frontend users
- Role-based access control
- Backend validates all RFID and energy data

---

## 10. Non-Functional Requirements

- System must support real-time updates with minimal latency
- Scalable to multiple classrooms within one building
- Fault-tolerant against temporary ESP32 disconnections
- Logs must be auditable

---

## 11. Development Phases

### Phase 1

- Core data models
- Authentication
- Classroom and schedule management

### Phase 2

- Attendance logic
- RFID ingestion
- Auto-timeout background job

### Phase 3

- Energy logging
- Aggregation logic

### Phase 4

- Real-time WebSocket dashboard
- Reports and analytics

---

## 12. Assumptions & Constraints

- Single building deployment
- One ESP32 per classroom
- Teachers use RFID only for TIME-IN
- Internet connectivity is available for ESP32 devices

---

## 13. Success Criteria

- Attendance is recorded accurately without manual timeout
- Energy consumption data is consistent and reliable
- Real-time dashboard updates without page refresh
- System operates stably under daily classroom usage

---

**End of PRD**
