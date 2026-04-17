# Energy Computation — Full Pipeline Documentation

> How the system computes kWh consumption from raw sensor readings to what you see on the Energy Reports Page and Teacher Energy Consumption Page.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Stage 1 — Sensor Hardware & Raw Data Collection (ESP32)](#2-stage-1--sensor-hardware--raw-data-collection-esp32)
   - [2.1 Supported Sensor Configurations](#21-supported-sensor-configurations)
   - [2.2 Option A: ZMPT101B + ACS724 (Analog Sensors)](#22-option-a-zmpt101b--acs724-analog-sensors)
   - [2.3 Option B: PZEM-004T (UART Module)](#23-option-b-pzem-004t-uart-module)
   - [2.4 Power Calculation on ESP32](#24-power-calculation-on-esp32)
   - [2.5 Sending Data via WebSocket](#25-sending-data-via-websocket)
3. [Stage 2 — Backend Receives Power Data (Django Consumers)](#3-stage-2--backend-receives-power-data-django-consumers)
   - [3.1 WebSocket Connection Flow](#31-websocket-connection-flow)
   - [3.2 Processing the Power Reading](#32-processing-the-power-reading)
4. [Stage 3 — Energy Buffering & Aggregation](#4-stage-3--energy-buffering--aggregation)
   - [4.1 Why Buffer?](#41-why-buffer)
   - [4.2 How the Buffer Works](#42-how-the-buffer-works)
   - [4.3 Flushing and Computing Averages](#43-flushing-and-computing-averages)
   - [4.4 Saving the Aggregated `EnergyLog`](#44-saving-the-aggregated-energylog)
5. [Stage 4 — Teacher Energy Calculation (Per-Session kWh)](#5-stage-4--teacher-energy-calculation-per-session-kwh)
   - [5.1 When Is It Triggered?](#51-when-is-it-triggered)
   - [5.2 The kWh Formula](#52-the-kwh-formula)
   - [5.3 Step-by-Step Computation](#53-step-by-step-computation)
   - [5.4 Worked Example](#54-worked-example)
   - [5.5 Where the Result is Stored](#55-where-the-result-is-stored)
6. [Stage 5 — Energy Reports Page (Classroom-Level kWh)](#6-stage-5--energy-reports-page-classroom-level-kwh)
   - [6.1 API Endpoint](#61-api-endpoint)
   - [6.2 kWh Calculation in Energy Reports](#62-kwh-calculation-in-energy-reports)
   - [6.3 What the Frontend Displays](#63-what-the-frontend-displays)
7. [Stage 6 — Teacher Energy Page (Per-Teacher kWh)](#7-stage-6--teacher-energy-page-per-teacher-kwh)
   - [7.1 API Endpoints](#71-api-endpoints)
   - [7.2 What the Frontend Displays](#72-what-the-frontend-displays)
8. [Data Flow Diagram](#8-data-flow-diagram)
9. [Database Models Involved](#9-database-models-involved)
10. [Key Configuration Values](#10-key-configuration-values)
11. [Important Notes & Caveats](#11-important-notes--caveats)

---

## 1. High-Level Overview

```
ESP32 Sensor → WebSocket → Django Consumer → Energy Buffer → EnergyLog (DB)
                                                                  ↓
                                            Teacher checks out → calculate kWh from EnergyLog → TeacherEnergyUsage (DB)
                                                                  ↓
                                            Frontend fetches → Energy Reports Page / Teacher Energy Page
```

The system measures **real-time electrical power (Watts)** from a classroom's circuit using either analog sensors (ZMPT101B + ACS724) or a dedicated PZEM-004T power module connected to an ESP32. The ESP32 sends power readings every **1 second** to the Django backend over WebSocket. The backend **buffers** these readings and saves an **averaged value** to the database every **60 seconds** (configurable). When a teacher's attendance session ends, the system queries all `EnergyLog` entries during that session's time range, computes the average wattage, and converts it to **kWh**.

---

## 2. Stage 1 — Sensor Hardware & Raw Data Collection (ESP32)

**Source file:** `esp32/src/main.cpp`

### 2.1 Supported Sensor Configurations

The firmware supports two hardware options, selected at compile time with `#define USE_PZEM_004T`:

| Setting             | Hardware                              | How It Measures                                |
| ------------------- | ------------------------------------- | ---------------------------------------------- |
| `USE_PZEM_004T = 0` | ZMPT101B (voltage) + ACS724 (current) | Analog ADC sampling with RMS math              |
| `USE_PZEM_004T = 1` | PZEM-004T v3 module                   | Digital UART — module reports V, I, P directly |

### 2.2 Option A: ZMPT101B + ACS724 (Analog Sensors)

#### Voltage Measurement (ZMPT101B → GPIO 34)

1. The ZMPT101B transformer outputs an AC-proportional voltage signal on GPIO 34.
2. The `readRMSVoltage()` function calls the ZMPT101B library: `voltageSensor.getRmsVoltage(3)` — reading 3 AC cycles for accuracy.
3. **Sensitivity** (default `483.5`) converts the raw ADC output to actual voltage. This is calibrated with a multimeter.
4. **Sanity check:** Capped at `nominalVoltage` (default 230V); negative values set to 0.

#### Current Measurement (ACS724 → GPIO 35)

1. The ACS724 Hall-effect sensor outputs a voltage proportional to current, centered at a **quiescent voltage** (≈2.5V at zero current).
2. `readRMSCurrent()` takes 150 samples (30 samples/cycle × 5 cycles) synchronized with the 60Hz AC waveform:
   ```
   sampleIntervalUs = 1,000,000 / 60 / 30 = ~555.5 µs per sample
   ```
3. For each sample:
   - Read 12-bit ADC value (0–4095)
   - Convert to voltage: `voltage = (adcValue / 4095) × 3.3V`
   - Remove DC offset: `acVoltage = voltage - quiescentVoltage`
   - Square for RMS: `sumSquares += acVoltage²`
4. Compute RMS: `rmsVoltage = √(sumSquares / totalSamples)`
5. Convert to current: `current = rmsVoltage / currentSensitivity`
   - Default `currentSensitivity = 0.040` (40mV/A for ACS724-25A model)
6. Add optional offset: `current += addAmpere`
7. **Noise filter:** Values below 10mA → 0; values above 50A → 0.

#### Zero-Point Calibration

On startup (or when triggered remotely via `calibrate_now`), the ESP32 measures the current sensor ADC for 50 samples with no load to determine the `quiescentVoltage` (DC offset). This is critical for accurate current readings:

```cpp
avgAdc = sum_of_50_ADC_readings / 50.0;
quiescentVoltage = (avgAdc / 4095.0) * 3.3;  // Typically ~2.43V
```

### 2.3 Option B: PZEM-004T (UART Module)

When `USE_PZEM_004T = 1`:

- The PZEM-004T module measures voltage, current, and **active power** directly from the AC line.
- It communicates over UART (RX=GPIO16, TX=GPIO17) at 19200 baud.
- A callback receives data events and stores:
  - `lastPzemVoltage` = voltage in V
  - `lastPzemCurrent` = current in A
  - `lastPzemPower` = active power in W (true power, not apparent)
- `readRMSVoltage()` and `readRMSCurrent()` simply return the last known PZEM values.
- `readPowerFromPzem()` returns the PZEM's built-in active power reading.

> **Key difference:** With PZEM, the power is measured by the module (accounts for power factor). With ZMPT+ACS, power = V × I (apparent power, assumes power factor ≈ 1).

### 2.4 Power Calculation on ESP32

In the main loop, every **1 second** (`POWER_READ_INTERVAL = 1000ms`):

```cpp
// Option A (ZMPT + ACS):
currentVoltage = readRMSVoltage();     // Volts
currentCurrent = readRMSCurrent();     // Amps
currentPower   = currentVoltage * currentCurrent;  // Watts (apparent power)

// Option B (PZEM):
currentVoltage = readRMSVoltage();     // from PZEM
currentCurrent = readRMSCurrent();     // from PZEM + addAmpere
currentPower   = readPowerFromPzem();  // Active power from PZEM module
```

### 2.5 Sending Data via WebSocket

The ESP32 sends a JSON message over WebSocket:

```json
{
  "device_id": "ESP32-ROOM-01",
  "voltage": 224.5,
  "current": 1.25,
  "power": 280.6
}
```

This is sent every 1 second to `ws://<backend-host>:8000/ws/iot/<classroom_id>/?token=<device_token>`.

---

## 3. Stage 2 — Backend Receives Power Data (Django Consumers)

**Source file:** `backend/core/consumers.py` → `IoTConsumer.receive()`

### 3.1 WebSocket Connection Flow

1. ESP32 connects to `ws://host:8000/ws/iot/{classroom_id}/?token=ESP32-H3WV263437R`
2. Backend verifies the device token against the `Classroom.device_token` field.
3. On connect, the backend pushes calibration config (sensitivity, quiescent voltage, etc.) to the ESP32.

### 3.2 Processing the Power Reading

When a message with `power` field arrives:

```python
if power is not None:
    # 1. Broadcast to dashboard in REAL-TIME (for live charts)
    await self.channel_layer.group_send(
        f'dashboard_classroom_{self.classroom_id}',
        {
            'type': 'power_update',
            'voltage': voltage,
            'current': current,
            'watts': power,
            'timestamp': timezone.now().isoformat()
        }
    )

    # 2. Add to buffer; save aggregated row when window completes
    from core.services.energy_buffer import add_reading, flush_and_aggregate
    should_flush = add_reading(self.classroom_id, voltage, current, power, timestamp)
    if should_flush:
        agg = flush_and_aggregate(self.classroom_id)
        if agg and agg.get('avg_watts') is not None:
            await self.save_energy_log_aggregated(agg)
```

**Two things happen:**

1. **Real-time broadcast** — Every 1-second reading is pushed to the frontend dashboard immediately (for live power display).
2. **Buffered save** — The reading is added to an in-memory buffer. Only when the buffer window expires (60 seconds) is an averaged value saved to the database.

---

## 4. Stage 3 — Energy Buffering & Aggregation

**Source file:** `backend/core/services/energy_buffer.py`

### 4.1 Why Buffer?

The ESP32 sends readings every 1 second. Saving each one to the database would create ~86,400 rows/day per classroom. Instead, the system buffers readings in memory and saves one averaged row every **60 seconds**.

### 4.2 How the Buffer Works

The buffer is an in-memory Python dictionary keyed by `classroom_id`:

```python
_buffer = {
    1: [
        {"timestamp": ..., "voltage": 224.5, "current": 1.25, "watts": 280.6},
        {"timestamp": ..., "voltage": 224.3, "current": 1.24, "watts": 278.1},
        # ... up to ~60 readings (1 per second for 60 seconds)
    ]
}
_window_start = { 1: <datetime of first reading in this window> }
```

**`add_reading(classroom_id, voltage, current, watts, timestamp)`:**

1. Appends the reading to the buffer for that classroom.
2. Records `_window_start` when the first reading arrives.
3. Checks if elapsed time since `_window_start` ≥ `ENERGY_SAVE_WINDOW_SECONDS` (default: 60).
4. Returns `True` when the window is complete (time to flush).

### 4.3 Flushing and Computing Averages

**`flush_and_aggregate(classroom_id)`:**

1. Takes all buffered readings for that classroom.
2. Computes averages, **excluding null values** (e.g., if some readings lack voltage):
   ```python
   avg_voltage = sum(non_null_voltages) / count(non_null_voltages)
   avg_current = sum(non_null_currents) / count(non_null_currents)
   avg_watts   = sum(non_null_watts) / count(non_null_watts)
   ```
3. Calculates the **midpoint timestamp** of the window:
   ```python
   midpoint = window_start + (ENERGY_SAVE_WINDOW_SECONDS / 2)
   ```
4. Clears the buffer so the next reading starts a new window.
5. Returns:
   ```python
   {
       "avg_voltage": 224.4,
       "avg_current": 1.245,
       "avg_watts": 279.3,
       "reading_count": 60,
       "timestamp": <window midpoint datetime>
   }
   ```

### 4.4 Saving the Aggregated `EnergyLog`

**`IoTConsumer.save_energy_log_aggregated(agg)`:**

```python
EnergyLog.objects.create(
    classroom=classroom,
    voltage=agg['avg_voltage'],     # Average voltage over 60s
    current=agg['avg_current'],     # Average current over 60s
    watts=agg['avg_watts'],         # Average power over 60s
    timestamp=agg['timestamp']      # Midpoint of the 60s window
)
```

**Result:** One `EnergyLog` row is created per classroom per 60-second window (≈1,440 rows/day per classroom instead of 86,400).

---

## 5. Stage 4 — Teacher Energy Calculation (Per-Session kWh)

**Source file:** `backend/core/services/energy_calculation.py`

### 5.1 When Is It Triggered?

The function `calculate_teacher_energy_for_session(session)` is called **whenever an attendance session ends**:

| Trigger Event                                    | Status Set    | Where Called                         |
| ------------------------------------------------ | ------------- | ------------------------------------ |
| Teacher taps RFID to check out                   | `MANUAL_OUT`  | `IoTConsumer.process_rfid()`         |
| Next teacher taps in (previous auto-checked out) | `CASCADE_OUT` | `IoTConsumer.process_rfid()`         |
| Daily auto-timeout (e.g., 10 PM)                 | `AUTO_OUT`    | `auto_timeout_task.py`               |
| Admin triggers "Recalculate All"                 | All completed | `TeacherEnergyViewSet.recalculate()` |

### 5.2 The kWh Formula

The core formula is:

$$\text{kWh} = \frac{\text{Average Watts} \times \text{Duration (hours)}}{1000}$$

Where:

- **Average Watts** = mean of all `EnergyLog.watts` values recorded during the session
- **Duration (hours)** = `(time_out - time_in).total_seconds() / 3600`

### 5.3 Step-by-Step Computation

```python
def calculate_teacher_energy_for_session(session):
    # 1. Only process completed sessions
    if not session.time_out or session.status not in ['AUTO_OUT', 'MANUAL_OUT', 'CASCADE_OUT']:
        return None

    # 2. Query EnergyLog rows that fall within the session's time range
    energy_logs = EnergyLog.objects.filter(
        classroom=session.classroom,
        timestamp__gte=session.time_in,    # From check-in time
        timestamp__lte=session.time_out     # To check-out time
    )

    if not energy_logs.exists():
        return None

    # 3. Calculate aggregate statistics from the energy logs
    stats = energy_logs.aggregate(
        avg_watts=Avg('watts'),     # Average power during session
        max_watts=Max('watts'),     # Peak power during session
        min_watts=Min('watts'),     # Minimum power during session
        reading_count=Count('id')   # Number of EnergyLog rows
    )

    # 4. Calculate duration
    duration = session.time_out - session.time_in
    duration_minutes = int(duration.total_seconds() / 60)
    hours = duration.total_seconds() / 3600

    # 5. Calculate kWh
    total_kwh = (float(stats['avg_watts']) * hours) / 1000

    # 6. Save to TeacherEnergyUsage
    usage, created = TeacherEnergyUsage.objects.update_or_create(
        attendance_session=session,
        defaults={
            'teacher': session.teacher,
            'classroom': session.classroom,
            'start_time': session.time_in,
            'end_time': session.time_out,
            'duration_minutes': duration_minutes,
            'avg_watts': stats['avg_watts'],
            'max_watts': stats['max_watts'],
            'min_watts': stats['min_watts'],
            'total_kwh': round(total_kwh, 4),
            'reading_count': stats['reading_count']
        }
    )
    return usage
```

### 5.4 Worked Example

**Scenario:** Teacher "Juan Dela Cruz" is in Room 101 from 8:00 AM to 9:30 AM.

1. **Session duration:** 1.5 hours (90 minutes)
2. **EnergyLog entries during 8:00–9:30 AM:** 90 rows (one per minute from the 60-second buffer)
3. **Each EnergyLog.watts value** represents the average power over its 60-second window:
   ```
   Row 1:  275.3 W
   Row 2:  280.1 W
   Row 3:  278.6 W
   ...
   Row 90: 282.0 W
   ```
4. **avg_watts** = average of all 90 watt values = **279.5 W**
5. **max_watts** = highest value = **310.2 W**
6. **min_watts** = lowest value = **245.8 W**
7. **kWh calculation:**
   $$\text{kWh} = \frac{279.5 \times 1.5}{1000} = 0.4193 \text{ kWh}$$
8. **Stored in `TeacherEnergyUsage`:**
   - `total_kwh = 0.4193`
   - `avg_watts = 279.5`
   - `duration_minutes = 90`
   - `reading_count = 90`

### 5.5 Where the Result is Stored

**Model: `TeacherEnergyUsage`** (`backend/core/models.py`)

| Field                | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `teacher`            | FK → the teacher (User)                                |
| `attendance_session` | One-to-one → the attendance session that was completed |
| `classroom`          | FK → the classroom                                     |
| `start_time`         | `session.time_in`                                      |
| `end_time`           | `session.time_out`                                     |
| `duration_minutes`   | Total minutes of the session                           |
| `avg_watts`          | Average power (W) during the session                   |
| `max_watts`          | Peak power (W) during the session                      |
| `min_watts`          | Minimum power (W) during the session                   |
| `total_kwh`          | **The computed kWh for this session**                  |
| `reading_count`      | Number of EnergyLog rows used in the calculation       |

---

## 6. Stage 5 — Energy Reports Page (Classroom-Level kWh)

**Source files:** `backend/core/views.py` → `EnergyReportView`, `aem/src/pages/EnergyReportsPage.tsx`

### 6.1 API Endpoint

```
GET /api/energy/report/?classroom=1&range=day
```

Parameters:

- `classroom` (optional): Filter by classroom ID
- `range`: `hour` | `day` | `week` | `month` — determines time grouping
- `start` / `end` (optional): Custom date range

### 6.2 kWh Calculation in Energy Reports

The Energy Reports Page computes kWh **differently** from the per-teacher calculation. It uses a time-based estimation from aggregated EnergyLog data:

```python
# Group EnergyLog rows by period (hour/day/week/month)
data = queryset.annotate(
    period=TruncDay('timestamp')      # or TruncHour, TruncWeek, TruncMonth
).values('period').annotate(
    avg_watts=Avg('watts'),
    max_watts=Max('watts'),
    min_watts=Min('watts'),
    reading_count=Count('id')
).order_by('period')

# Calculate kWh for each period
for item in data:
    # Each reading represents ~1 minute of data (from 60-second buffer)
    hours = item['reading_count'] / 60     # Convert reading count to hours
    kwh = (float(item['avg_watts']) * hours) / 1000
```

**How it works:**

1. EnergyLog rows are grouped by the selected time period (e.g., per day).
2. For each period, `avg_watts` = average of all watt readings; `reading_count` = number of EnergyLog rows.
3. Since each EnergyLog row represents ~60 seconds (1 minute) of data:
   - `hours = reading_count / 60` (convert minutes to hours)
   - `kWh = (avg_watts × hours) / 1000`

**Example — Daily report:**

- Day: March 28, 2026
- reading_count: 480 (8 hours × 60 readings/hour)
- avg_watts: 265.3 W
- hours = 480 / 60 = 8.0 hours
- kWh = (265.3 × 8.0) / 1000 = **2.1224 kWh**

### 6.3 What the Frontend Displays

The `EnergyReportsPage` shows:

| Card                  | Data Source                                 |
| --------------------- | ------------------------------------------- |
| **Total Consumption** | Sum of all `total_kwh` across periods       |
| **Average Power**     | Average of all `avg_watts` across periods   |
| **Peak Power**        | Maximum `max_watts` across periods          |
| **Data Points**       | Number of periods (not individual readings) |

Plus:

- **Energy Chart** (bar/area/combined) showing kWh and avg watts over time
- **Detailed Data Table** with columns: Period, Total kWh, Avg W, Max W, Min W, Readings

**Real-time updates:** The page subscribes to WebSocket power events. When a new power reading arrives, it debounces (2-second delay) and re-fetches the report data from the API.

---

## 7. Stage 6 — Teacher Energy Page (Per-Teacher kWh)

**Source files:** `backend/core/views.py` → `TeacherEnergyViewSet`, `aem/src/pages/TeacherEnergyPage.tsx`

### 7.1 API Endpoints

| Endpoint                                          | Purpose                                      |
| ------------------------------------------------- | -------------------------------------------- |
| `GET /api/teacher-energy/summary/`                | Aggregated kWh per teacher                   |
| `GET /api/teacher-energy/?teacher=5`              | Individual session details for a teacher     |
| `GET /api/teacher-energy/by_classroom/?teacher=5` | Breakdown by classroom                       |
| `GET /api/teacher-energy/by_date/?teacher=5`      | Breakdown by date                            |
| `POST /api/teacher-energy/recalculate/`           | Re-run calculations for all sessions (admin) |

**Summary endpoint** aggregates all `TeacherEnergyUsage` rows:

```python
summary = queryset.values(
    'teacher', 'teacher__first_name', 'teacher__last_name'
).annotate(
    total_kwh=Sum('total_kwh'),         # Sum of all session kWh
    total_minutes=Sum('duration_minutes'), # Total attendance time
    avg_watts=Avg('avg_watts'),          # Overall average power
    session_count=Count('id')            # Number of sessions
).order_by('-total_kwh')
```

### 7.2 What the Frontend Displays

**Summary Cards:**

- **Total Teachers** — Count of teachers with energy data
- **Total Energy** — Sum of all teachers' kWh
- **Total Time** — Total hours across all sessions
- **Total Sessions** — Number of completed attendance sessions

**Energy Usage by Teacher Table:**

| Column      | Source                                           |
| ----------- | ------------------------------------------------ |
| Teacher     | `teacher_name`                                   |
| Total kWh   | `total_kwh` (sum of all session kWh)             |
| Total Hours | `total_minutes / 60`                             |
| Avg Watts   | `avg_watts` (average across sessions)            |
| Sessions    | `session_count`                                  |
| kWh/Hour    | `total_kwh / total_hours` (computed in frontend) |

**Drill-down (click "Details"):**

- **Classroom Breakdown** — kWh per classroom for that teacher
- **Session History** — Individual sessions showing: Date/Time, Classroom, Duration, Avg/Max/Min Watts, kWh, Reading count

---

## 8. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ESP32 DEVICE                                │
│                                                                     │
│  ZMPT101B ──→ readRMSVoltage() ──→ currentVoltage (V)             │
│  ACS724  ──→ readRMSCurrent()  ──→ currentCurrent (A)             │
│       OR                                                            │
│  PZEM-004T ──→ Callback updates lastPzemVoltage/Current/Power      │
│                                                                     │
│  currentPower = V × I  (or PZEM active power)                     │
│                                                                     │
│  Every 1 second → sendPowerData(voltage, current, watts)           │
│                    via WebSocket                                    │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ JSON: {"voltage":224.5, "current":1.25, "power":280.6}
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     DJANGO BACKEND (IoTConsumer)                    │
│                                                                     │
│  1. Broadcast to Dashboard (real-time)  ◄── Every reading          │
│     → WebSocket → Frontend live charts                             │
│                                                                     │
│  2. energy_buffer.add_reading(classroom_id, V, I, W, timestamp)    │
│     └─ Buffers readings in memory per classroom                    │
│     └─ When elapsed ≥ 60s → returns True (flush)                   │
│                                                                     │
│  3. energy_buffer.flush_and_aggregate(classroom_id)                │
│     └─ avg_voltage = mean(non-null voltages)                       │
│     └─ avg_current = mean(non-null currents)                       │
│     └─ avg_watts   = mean(non-null watts)                          │
│     └─ timestamp   = window midpoint                               │
│     └─ Clears buffer                                               │
│                                                                     │
│  4. save_energy_log_aggregated(agg)                                │
│     └─ EnergyLog.objects.create(V, I, W, timestamp)               │
│     └─ One row per 60 seconds per classroom                       │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     DATABASE: EnergyLog Table                       │
│                                                                     │
│  | id | classroom | voltage | current | watts  | timestamp       | │
│  |----|-----------|---------|---------|--------|------------------| │
│  | 1  | Room 101  | 224.50  | 1.2450  | 279.30 | 2026-03-28 08:00| │
│  | 2  | Room 101  | 224.30  | 1.2300  | 275.89 | 2026-03-28 08:01| │
│  | ...                                                              │
│  One row ≈ average of ~60 raw sensor readings                      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌──────────────────────────┐       ┌──────────────────────────────────┐
│  ENERGY REPORTS PAGE     │       │  TEACHER ENERGY CALCULATION      │
│  (Classroom-Level kWh)   │       │  (Per-Session kWh)               │
│                          │       │                                  │
│  Group by period         │       │  Triggered on session end:       │
│  (hour/day/week/month)   │       │  MANUAL_OUT / CASCADE_OUT /      │
│                          │       │  AUTO_OUT                        │
│  For each period:        │       │                                  │
│  hours = count / 60      │       │  Query EnergyLogs where:         │
│  kWh = (avg_W × hrs)    │       │  classroom = session.classroom   │
│         / 1000           │       │  time_in ≤ timestamp ≤ time_out  │
│                          │       │                                  │
│  Frontend: chart + table │       │  avg_watts = AVG(watts)          │
│                          │       │  hours = (time_out - time_in)    │
│                          │       │           / 3600                 │
│                          │       │  kWh = (avg_watts × hours)       │
│                          │       │        / 1000                    │
│                          │       │                                  │
│                          │       │  → TeacherEnergyUsage (DB)       │
│                          │       │  → Teacher Energy Page           │
└──────────────────────────┘       └──────────────────────────────────┘
```

---

## 9. Database Models Involved

### `EnergyLog`

- **Purpose:** Stores aggregated (60-second average) power readings per classroom
- **Key fields:** `classroom`, `voltage`, `current`, `watts`, `timestamp`
- **Created by:** `IoTConsumer.save_energy_log_aggregated()` after buffer flush
- **Used by:** Energy Reports Page, Teacher Energy Calculation

### `TeacherEnergyUsage`

- **Purpose:** Stores per-session kWh for each teacher
- **Key fields:** `teacher`, `classroom`, `attendance_session`, `start_time`, `end_time`, `duration_minutes`, `avg_watts`, `max_watts`, `min_watts`, `total_kwh`, `reading_count`
- **Created by:** `calculate_teacher_energy_for_session()` on session end
- **Used by:** Teacher Energy Page

### `EnergyAggregation`

- **Purpose:** Pre-aggregated energy data for reporting (hourly/daily/monthly)
- **Key fields:** `classroom`, `period_type`, `period_start`, `total_kwh`, `avg_watts`, `max_watts`, `min_watts`, `reading_count`
- **Note:** Currently defined in models but the main reporting flow uses direct `EnergyLog` queries

### `ClassroomCalibration`

- **Purpose:** Stores per-classroom sensor calibration values
- **Key fields:** `voltage_sensitivity`, `current_sensitivity`, `quiescent_voltage`, `nominal_voltage`, `add_ampere`
- **Pushed to ESP32** on WebSocket connect and on admin update

---

## 10. Key Configuration Values

| Setting                      | Default   | Location                       | Description                                                               |
| ---------------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------- |
| `ENERGY_SAVE_WINDOW_SECONDS` | `60`      | `backend/settings.py`          | Buffer window size before saving to DB                                    |
| `POWER_READ_INTERVAL`        | `1000` ms | `esp32/src/main.cpp`           | How often ESP32 reads + sends power                                       |
| `ZMPT101B_SENSITIVITY`       | `483.5`   | ESP32 / `ClassroomCalibration` | Voltage sensor calibration factor                                         |
| `CURRENT_SENSITIVITY`        | `0.040`   | ESP32 / `ClassroomCalibration` | ACS724 sensitivity (V per A)                                              |
| `NOMINAL_VOLTAGE`            | `230.0`   | ESP32 / `ClassroomCalibration` | Expected AC voltage (cap limit)                                           |
| `ADD_AMPERE`                 | `0`       | ESP32 / `ClassroomCalibration` | Offset added to current reading                                           |
| `AC_FREQUENCY`               | `60` Hz   | ESP32                          | AC line frequency for sampling timing                                     |
| `SAMPLES_PER_CYCLE`          | `30`      | ESP32                          | ADC samples per AC cycle                                                  |
| `MEASUREMENT_CYCLES`         | `5`       | ESP32                          | Number of AC cycles per measurement                                       |
| `POWER_UPDATE_DEBOUNCE`      | `2000` ms | Frontend `useEnergy.ts`        | Debounce delay for refreshing energy reports after WebSocket power update |

---

## 11. Important Notes & Caveats

### Power Factor

- **ZMPT + ACS option:** Calculates **apparent power** (P = V × I). This assumes a power factor of 1.0 (purely resistive load like incandescent lights or heaters). For reactive loads (fans, motors, fluorescent ballasts), the actual energy consumed will be **lower** than what's reported.
- **PZEM-004T option:** Reports **active power** (true power), which correctly accounts for power factor.

### Data Granularity

- Raw sensor readings: **1 per second** (not saved to DB)
- EnergyLog rows: **1 per 60 seconds** (averaged from ~60 raw readings)
- Teacher kWh is calculated from EnergyLog averages, not raw readings

### Energy Reports kWh vs Teacher Energy kWh

These are computed differently:

- **Energy Reports Page:** `kWh = (avg_watts × reading_count / 60) / 1000` — estimates hours from the number of EnergyLog rows assuming 1 row per minute
- **Teacher Energy Page:** `kWh = (avg_watts × session_duration_hours) / 1000` — uses the actual attendance session duration from time_in to time_out

The Teacher Energy calculation is generally more precise because it uses actual timestamps rather than estimating from row counts.

### Session Overlap

- Only **one teacher** can be active (status=`IN`) in a classroom at a time.
- When a new teacher taps in while another is active, the previous teacher gets `CASCADE_OUT` and their energy is immediately calculated.

### Calibration Importance

- The accuracy of all energy readings depends on proper sensor calibration.
- **Voltage sensitivity** must be calibrated against a multimeter.
- **Quiescent voltage** should be calibrated with no load on the current sensor.
- Calibration values can be updated remotely from the admin panel and are pushed to the ESP32 in real-time.

### Recalculation

- If historical energy data seems wrong (e.g., after a calibration fix), an admin can trigger `POST /api/teacher-energy/recalculate/` to re-compute all `TeacherEnergyUsage` records from the existing `EnergyLog` data.
- This processes sessions in batches (default: 10) with delays (default: 0.5s) to avoid SQLite locking issues.

### Data Loss Scenarios

- If the backend restarts, the in-memory energy buffer is lost. Any readings in the current 60-second window that haven't been flushed will not be saved to the database.
- If WiFi disconnects, the ESP32 stops sending readings until reconnected. The missing period will have no EnergyLog rows.
- Teacher kWh will still be calculated correctly for the time period where EnergyLog data exists — it uses average watts, so gaps simply reduce the reading count but don't affect the average accuracy significantly.
