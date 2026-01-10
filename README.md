# IoT-Based Attendance & Energy Consumption Tracking System

A comprehensive system for tracking teacher attendance via RFID and monitoring classroom energy consumption using IoT devices.

## Project Structure

```
project/
├── backend/           # Django REST API + WebSocket server
│   ├── backend/       # Django project settings
│   ├── core/          # Main application
│   └── requirements.txt
├── aem/               # React + TypeScript frontend
│   └── src/
│       ├── components/  # UI components
│       ├── contexts/    # React contexts
│       ├── hooks/       # Custom hooks
│       ├── pages/       # Page components
│       ├── services/    # API and WebSocket services
│       └── types/       # TypeScript types
└── prd_io_t_based_attendance_energy_consumption_tracking_system.md
```

## Technology Stack

### Backend

- Django REST Framework
- Django Channels (WebSockets)
- PostgreSQL (via Supabase) or SQLite for development
- JWT Authentication

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Shadcn UI components

### IoT

- ESP32
- RFID reader
- Power consumption sensor

## Backend Setup

1. Navigate to the backend directory:

```bash
cd backend
```

2. Create a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Run migrations:

```bash
python manage.py makemigrations core
python manage.py migrate
```

5. Create a superuser:

```bash
python manage.py createsuperuser
```

6. Run the development server:

```bash
python manage.py runserver
```

The API will be available at `http://localhost:8000/api/`

## Frontend Setup

1. Navigate to the frontend directory:

```bash
cd aem
```

2. Install dependencies:

```bash
npm install
```

3. Copy the environment file:

```bash
cp .env.example .env
```

4. Run the development server:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`

## API Endpoints

### Authentication

- `POST /api/auth/login/` - User login
- `POST /api/auth/logout/` - User logout
- `POST /api/auth/token/refresh/` - Refresh JWT token

### Users

- `GET /api/users/` - List users
- `POST /api/users/` - Create user
- `GET /api/users/teachers/` - List teachers
- `POST /api/users/{id}/assign_rfid/` - Assign RFID to user

### Classrooms

- `GET /api/classrooms/` - List classrooms
- `POST /api/classrooms/` - Create classroom
- `GET /api/classrooms/{id}/current_status/` - Get current status
- `GET /api/classrooms/{id}/schedules/` - Get classroom schedules

### Schedules

- `GET /api/schedules/` - List schedules
- `POST /api/schedules/` - Create schedule
- `GET /api/schedules/today/` - Get today's schedules

### Attendance

- `GET /api/attendance/` - List attendance sessions
- `GET /api/attendance/today/` - Get today's sessions
- `GET /api/attendance/active/` - Get active sessions
- `GET /api/attendance/report/` - Generate attendance report

### Energy

- `GET /api/energy-logs/` - List energy logs
- `GET /api/energy-logs/latest/` - Get latest readings
- `GET /api/energy/report/` - Generate energy report

### Dashboard

- `GET /api/dashboard/` - Get dashboard data

## WebSocket Endpoints

### ESP32 Device Connection

```
ws://localhost:8000/ws/iot/classroom/{classroom_id}/?token={device_token}
```

Payload format:

```json
{
  "device_id": "ESP32-ROOM-01",
  "rfid_uid": "A1B2C3D4",
  "power": 245.6,
  "timestamp": "2026-01-10T09:00:00Z"
}
```

### Frontend Dashboard

```
ws://localhost:8000/ws/dashboard/
ws://localhost:8000/ws/dashboard/classroom/{classroom_id}/
```

## Auto-Timeout Background Task

Run the auto-timeout task to automatically end attendance sessions:

```bash
python manage.py auto_timeout_task
```

For production, set up a cron job or Celery Beat to run this periodically (every minute).

## Features

### Dashboard

- Real-time classroom status
- Current teacher per classroom
- Countdown timer to auto-timeout
- Live power consumption display
- Today's attendance statistics

### Attendance Reports

- Filter by date, classroom, and status
- View attendance history
- Export capabilities (TODO)

### Energy Reports

- Hourly, daily, and monthly aggregations
- Per-classroom filtering
- Consumption trends visualization

### Admin Management

- Teacher management with RFID assignment
- Classroom configuration
- Schedule management

## ESP32 Integration

The ESP32 device should:

1. Connect to WiFi
2. Establish WebSocket connection with device token
3. Send RFID scans when detected
4. Send power readings periodically (every minute recommended)

Example Arduino/PlatformIO code structure:

```cpp
// WebSocket connection
WebSocketClient ws;
ws.connect("ws://server/ws/iot/classroom/1/?token=YOUR_TOKEN");

// On RFID scan
void onRFIDScan(String uid) {
    String payload = "{\"device_id\":\"ESP32-01\",\"rfid_uid\":\"" + uid + "\",\"power\":" + String(currentPower) + "}";
    ws.send(payload);
}
```

## License

MIT License
