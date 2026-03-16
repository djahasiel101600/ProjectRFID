# System Architecture: IoT-Based Attendance & Energy Consumption Tracking System

This document describes how the project works—its architecture, components, data flow, and interactions.

---

## 1. Overview

The system automatically tracks **teacher attendance** via RFID and **classroom energy consumption** via IoT sensors. Each classroom has an ESP32 device that reads RFID cards and power sensors, sends data in real time to a Django backend over WebSockets, and a React frontend displays dashboards and reports.

**High-level flow:** `ESP32 → Django Backend (WebSocket + REST) → Redis/Celery → React Frontend`

---

## 2. System Components

### 2.1 ESP32 Device (Per Classroom)

| Hardware | Purpose |
|----------|---------|
| **MFRC522 RFID Reader** | Read teacher RFID cards for attendance |
| **Power measurement** | **Option A (default):** ZMPT101B (voltage) + ACS724 (current) on ADC. **Option B:** PZEM-004T v3 over UART. See [Power Sensors & PZEM](POWER_SENSORS_AND_PZEM.md). |
| **I2C 16x2 LCD** | Display status, time, teacher name, power |
| **LEDs (Red/Green)** | Feedback (scan mode, success, error) |
| **Passive Buzzer** | Audio feedback |
| **5V Relay** | Control classroom lights (on when teacher present) |

**Behavior:**

1. Connects to WiFi and NTP for time sync.
2. Opens WebSocket to `/ws/iot/classroom/{id}/?token={device_token}`.
3. Reads RFID every 50 ms and power (V, I, P) every 1 second (interval configurable).
4. Sends RFID scans and power readings as JSON over WebSocket.
5. Receives attendance responses and scan-mode commands.
6. Turns lights ON when a teacher times in, OFF on manual checkout only (no auto-timeout).

**Payload formats sent to backend:**
- RFID: `{ device_id, rfid_uid, voltage, current, power }`
- Power-only: `{ device_id, voltage, current, power }`
- Scan mode result: `{ type: "scan_result", device_id, rfid_uid }`
- Heartbeat: `{ device_id, type: "heartbeat" }`

---

### 2.2 Backend (Django)

| Technology | Role |
|------------|------|
| **Django REST Framework** | REST API for CRUD, auth, reports |
| **Django Channels** | WebSocket consumers (IoT, Dashboard, Admin) |
| **Redis** | Channel layer and Celery broker |
| **Celery + Celery Beat** | Optional periodic tasks (auto-timeout disabled; teachers must manually tap out) |
| **SQLite / PostgreSQL** | Persistent data |

**Main modules:**

- **`core/models.py`** – User, Classroom, Schedule, RoomAvailability (open room windows), AttendanceSession, EnergyLog, EnergyAggregation, TeacherEnergyUsage
- **`core/consumers.py`** – IoTConsumer, DashboardConsumer, AdminConsumer
- **`core/views.py`** – REST views for users, classrooms, schedules, attendance, energy
- **`core/tasks.py`** – Celery tasks for session timeouts and cleanup
- **`core/services/energy_calculation.py`** – Per-session energy aggregation for teachers

---

### 2.3 Frontend (React + TypeScript)

| Technology | Role |
|------------|------|
| **React 19** | UI framework |
| **Vite** | Build and dev server |
| **Tailwind CSS 4** | Styling |
| **Shadcn UI** | Components |
| **Custom WebSocket service** | Real-time updates |

**Pages:**

- **Login** – JWT authentication
- **Dashboard** – Real-time classroom status, power, attendance
- **Attendance Reports** – Filter/sort attendance history
- **Energy Reports** – Hourly/daily/monthly energy aggregation
- **Teacher Energy** – Per-teacher energy usage
- **Admin** – Teachers, RFID, classrooms, schedules, Override Cards, Maintenance Cards (staff light control), RFID scan mode

---

## 3. Data Flow

### 3.1 Attendance Flow (RFID Time-In)

```
User taps RFID card
    ↓
ESP32 reads UID → sends JSON over WebSocket
    ↓
IoTConsumer.receive() → process_rfid()
    ↓
1. Check MaintenanceRFID first → if match: no attendance. If teacher IN → maintenance_blocked. Else → maintenance_toggle (relay)
2. Else: Look up teacher: User by rfid_uid, OR OverrideRFID by rfid_uid (override mode)
    ↓
If already IN → manual checkout (MANUAL_OUT)
    ↓
Check Schedule: teacher's own schedule (day, time, 15-min window)
If no match AND override mode → look for VACANT slot (another teacher's slot with no one timed in)
If no vacant slot AND another teacher IN → EARLY TAKEOVER: use teacher's next schedule in this room
    ↓
Before creating session: CASCADE any other teacher IN in this classroom → CASCADE_OUT (broadcast to dashboard only, not ESP32)
    ↓
If valid schedule or vacant slot or early takeover → create AttendanceSession (status=IN, is_override if override)
If no schedule → create AttendanceSession (status=INVALID)
    ↓
Broadcast to DashboardConsumer (attendance_event)
    ↓
ESP32 receives response → LCD, LED, buzzer, relay
```

### 3.2 Power Flow

```
ESP32 reads voltage & current every 5s
    ↓
Computes watts, sends { device_id, voltage, current, power }
    ↓
IoTConsumer.save_energy_log() → EnergyLog
    ↓
Broadcast to DashboardConsumer (power_update)
    ↓
Frontend updates power display in real time
```

### 3.3 Manual Checkout & Cascade (No Auto-Timeout)

**Design:** Teachers must manually tap out to turn off lights and end attendance. This ensures accountability and avoids leaving students in the dark when the schedule ends.

**Checkout types:**
- **MANUAL_OUT** – Teacher taps their card again during an active session.
- **CASCADE_OUT** – Next teacher taps in; previous teacher (who forgot to tap out) is automatically checked out. Energy and time_out are set at cascade moment. Dashboard is notified; ESP32 is not (lights stay on; next teacher gets attendance_in).

**Energy calculation:** Triggered on MANUAL_OUT and CASCADE_OUT. `TeacherEnergyUsage` is computed when a session has `time_out` and status in (AUTO_OUT, MANUAL_OUT, CASCADE_OUT).

**Excess time:** When a session is IN and `now > expected_out`, the system computes and displays `excess_minutes` (classroom card and session table) for accountability.

---

## 4. WebSocket Architecture

### 4.1 Channel Groups

| Group | Consumers | Purpose |
|-------|-----------|---------|
| `iot_classroom_{id}` | IoTConsumer | ESP32 connection for that classroom |
| `dashboard_classroom_{id}` | DashboardConsumer | Dashboard clients for one classroom |
| `dashboard_all` | DashboardConsumer | Dashboard clients for all classrooms |
| `admin_rfid_scan` | AdminConsumer | Admin scan mode for RFID registration |

### 4.2 WebSocket Endpoints

| Endpoint | Client | Auth |
|----------|--------|------|
| `ws://host/ws/iot/classroom/{id}/?token={device_token}` | ESP32 | Device token |
| `ws://host/ws/dashboard/` | Frontend | None (JWT for REST) |
| `ws://host/ws/dashboard/classroom/{id}/` | Frontend | None |
| `ws://host/ws/admin/rfid-scan/` | Admin frontend | None |

### 4.3 Message Types (Backend → Frontend)

- **initial_data** – Full dashboard state on connect
- **attendance** – Time-in, time-out, invalid, error
- **power** – voltage, current, watts, timestamp
- **auto_timeout** – (Legacy) Session ended by auto-timeout; no longer used

---

## 5. Data Models

### 5.1 Core Entities

- **User** – Admin or teacher; teachers have `rfid_uid`
- **Classroom** – `name`, `device_id`, `device_token`
- **Schedule** – `teacher`, `classroom`, `day_of_week`, `start_time`, `end_time`, `subject`
- **MaintenanceRFID** – `rfid_uid`, `label`; staff cards for lights control only, no attendance. Blocked when teacher IN.
- **OverrideRFID** – `rfid_uid`, `teacher`; cards that enable substitute/override mode (teacher can take vacant slots)
- **AttendanceSession** – `teacher`, `classroom`, `schedule`, `date`, `time_in`, `time_out`, `expected_out`, `status` (IN, MANUAL_OUT, AUTO_OUT, CASCADE_OUT, INVALID), `is_override`
- **EnergyLog** – `classroom`, `voltage`, `current`, `watts`, `timestamp`
- **EnergyAggregation** – Pre-aggregated kWh by hour/day/month
- **TeacherEnergyUsage** – Energy attributed to each attendance session (computed after MANUAL_OUT, CASCADE_OUT, or AUTO_OUT)

### 5.2 Attendance Rules

- **Maintenance RFID**: Staff card. Control lights only (toggle relay). No attendance created. **Blocked** when a teacher has an active session (status=IN) in that classroom. ESP32 receives `maintenance_toggle` or `maintenance_blocked`.
- Attendance is **time-in only**; no explicit RFID time-out.
- **Valid** if RFID scanned during schedule or within 15 minutes of `start_time`.
- **Override/Substitute mode**: When an **Override RFID** card is used, if the teacher has no matching schedule, the system checks for **vacant slots** (another teacher's scheduled slot in that classroom where no one has timed in). If found, the teacher can take that slot; session is created with `is_override=True`. If no vacant slot but another teacher is IN, **early takeover** allows the tapping teacher to use their next schedule in that room (e.g. B taps at 8:30 for 9:00–10:00; A is cascaded; B gets in).
- **Invalid** if scanned outside schedule and (no override card or no vacant slot or no early takeover); still logged.
- **Manual checkout**: second RFID tap during active session → MANUAL_OUT. Lights turn off.
- **Cascade checkout**: when a new teacher taps in and another teacher is IN, the previous teacher is set to CASCADE_OUT (time_out=now). Dashboard notified; ESP32 not (lights stay on; next teacher gets attendance_in).
- One active session per teacher per classroom per day.

---

## 6. REST API Summary

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login/`, `POST /api/auth/logout/` |
| Override RFID | `GET/POST /api/override-rfids/`, `DELETE /api/override-rfids/{id}/` |
| Maintenance RFID | `GET/POST /api/maintenance-rfids/`, `DELETE /api/maintenance-rfids/{id}/` |
| Users | CRUD, `POST /api/users/{id}/assign_rfid/` |
| Classrooms | CRUD, `GET /api/classrooms/{id}/current_status/` |
| Schedules | CRUD, `GET /api/schedules/today/` |
| Attendance | List, filter, `GET /api/attendance/report/` |
| Energy | `GET /api/energy-logs/`, `GET /api/energy/report/` |
| Dashboard | `GET /api/dashboard/` |
| Teacher Energy | `GET /api/teacher-energy/` |

---

## 7. Docker Deployment

| Service | Port | Role |
|---------|------|------|
| redis | 6379 | Channel layer and Celery broker |
| backend | 8081 (→8000) | Django + Daphne ASGI |
| frontend | 80 | React build served by Nginx |
| celery_worker | - | Runs Celery tasks |
| celery_beat | - | Schedules periodic tasks (e.g. auto-timeout) |

Shared volumes: `backend_data` for SQLite, `backend_static` for static files.

---

## 8. Energy Calculation

- **EnergyLog**: raw readings (V, I, P) stored per classroom.
- **TeacherEnergyUsage** (after MANUAL_OUT, CASCADE_OUT, or AUTO_OUT):  
  - Filter `EnergyLog` by `time_in`–`time_out`  
  - Aggregate avg/max/min watts, count readings  
  - Compute `total_kwh = avg_watts * hours / 1000`  
  - Store per session for reporting.

---

## 9. Admin RFID Scan Mode

1. Admin connects to `ws://host/ws/admin/rfid-scan/`.
2. Admin sends `{ action: "start_scan", classroom_id: N }`.
3. Backend sends `start_scan` command to ESP32 in that classroom.
4. ESP32 enters scan mode: red LED on, LCD "Present tag now".
5. Teacher taps RFID → ESP32 sends `scan_result` to backend.
6. Backend forwards `scan_result` to AdminConsumer.
7. Admin UI shows UID and can assign it to a teacher.
8. Scan mode times out after 30 seconds if no scan.

---

## 10. Admin Maintenance Cards (Staff Light Control)

Staff RFID cards that control classroom lights only. No attendance is recorded.

1. Admin goes to **Admin → Maintenance Cards** tab.
2. Add card: scan or type RFID UID, optional label (e.g. "Janitor").
3. When staff taps the card:
   - **If no teacher is IN** → Relay toggles (lights on/off). ESP32 shows "Lights ON" or "Lights OFF".
   - **If a teacher is IN** → Blocked. ESP32 shows "Teacher present", red LED, error beep.
4. No dashboard broadcast (maintenance does not affect attendance).

---

## 11. Admin Override Cards (Substitute Mode)

Override RFID cards allow teachers to take **vacant slots** when the scheduled teacher doesn't show up.

1. Admin goes to **Admin → Override Cards** tab.
2. Click **+ Add Override Card**, select a teacher, and scan or type the RFID UID.
3. That physical card is now an "override" card for that teacher.
4. When the teacher uses this card (instead of their normal RFID) and they have no matching schedule, the system looks for vacant slots in the classroom. A vacant slot = a schedule where no one has timed in today.
5. If found, the teacher can take the slot; session is created with `is_override=True` for reporting.

**Example (vacant slot):** Teacher A (8:00–9:00) doesn't show. Teacher B (9:00–10:30) has an override card. Teacher B scans at 8:15 → system finds vacant 8:00–9:00 slot → Teacher B gets in, `expected_out` = 9:00.

**Example (early takeover):** Teacher A (8:00–9:00) taps in, leaves at 8:30, forgets to tap out. Teacher B (9:00–10:00) uses override at 8:30 → A is CASCADE_OUT; B gets in early with `expected_out` = 10:00.

---

## 12. Security

- ESP32: authenticated via `device_token` on WebSocket connect.
- Web app: JWT login; REST API uses Bearer token.
- Roles: admin (full), teacher (RFID only, no web UI required).

---

## 13. Directory Structure

```
project/
├── backend/           # Django API + WebSocket server
│   ├── backend/       # Settings, ASGI, Celery
│   ├── core/          # Models, views, consumers, tasks
│   └── requirements.txt
├── aem/               # React frontend
│   └── src/
│       ├── components/
│       ├── contexts/
│       ├── hooks/
│       ├── pages/
│       ├── services/   # API, WebSocket
│       └── types/
├── esp32/             # PlatformIO firmware
│   └── src/main.cpp
├── docs/              # Project documentation
│   ├── README.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DOCKER.md
│   ├── PRD.md
│   └── RFID_SCAN_TROUBLESHOOTING.md
├── docker-compose.yml
├── README.md
└── toDO.md
```
