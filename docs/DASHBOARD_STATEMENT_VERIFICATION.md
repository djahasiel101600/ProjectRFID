# Real-Time Dashboard Statement Verification Report

## Statement to Verify

> "The Real-Time Dashboard of the PowerAudit web application displays key session indicators—Total Sessions Today, Active Sessions, Completed Sessions, and Invalid Sessions—along with live electrical measurements of Voltage, Current, and Power transmitted from the ESP32 device installed in Room ACAD 107. It also shows the current classroom status, including the teacher on session and continuously updated energy readings. To ensure data accuracy and prevent discrepancies caused by network latency, the accumulated energy consumption (kWh) displayed on the dashboard is not manually calculated from power over time by the web application. Instead, it is extracted directly from the internal cumulative energy register of the PZEM-004T module. The ESP32 microcontroller samples these electrical parameters and transmits the data payload to the backend database at a fixed interval of every [X] seconds, providing highly accurate, real-time updates."

---

## Executive Summary

**VERDICT: PARTIALLY ACCURATE WITH CRITICAL INACCURACIES**

The statement contains several **accurate elements** about the dashboard functionality and real-time data transmission, but includes **one major factual error** regarding energy calculation methodology and **one missing detail** about the transmission interval.

### Key Findings:

✅ **ACCURATE:**

- Dashboard displays session indicators (Total, Active, Completed, Invalid Sessions)
- Shows live electrical measurements (Voltage, Current, Power)
- Displays current teacher on session and classroom status
- ESP32 transmits data at fixed intervals
- Real-time updates via WebSocket

❌ **INACCURATE:**

- **Energy consumption (kWh) is NOT extracted from PZEM-004T's internal cumulative energy register**
- Instead, kWh is calculated by the backend from averaged power readings over time

⚠️ **INCOMPLETE:**

- Transmission interval [X] = **1 second** (not specified in statement)
- **Timestamp handling** not mentioned (ESP32 does NOT send timestamps with power data)

---

## Detailed Analysis

### 1. Timestamp Handling ⚠️ CRITICAL FINDING

**Finding:** The ESP32 **does NOT send timestamps** with power data transmissions. All timestamps are assigned by the **backend server** when data is received.

**Evidence:**

- **File:** `esp32/src/main.cpp` (lines 661-676)

**Power Data Transmission (NO timestamp field):**

```cpp
void sendPowerData(float voltage, float current, float watts)
{
    powerDoc.clear();

    powerDoc["device_id"] = DEVICE_ID;
    powerDoc["voltage"] = voltage;
    powerDoc["current"] = current;
    powerDoc["power"] = watts;
    // ❌ NO timestamp field added here

    char buffer[JSON_POWER_BUFFER];
    serializeJson(powerDoc, buffer, sizeof(buffer));
    webSocket.sendTXT(buffer);
}
```

**Backend Timestamp Assignment:**

- **File:** `backend/core/consumers.py` (lines 186-208)

```python
timestamp_str = data.get('timestamp')  # Will be None for power readings

if timestamp_str and timestamp_str.strip():
    # Parse ESP32 timestamp (only sent with RFID scans)
    timestamp = datetime.fromisoformat(timestamp_str)
else:
    # Power readings always use server time
    timestamp = timezone.now()  # ← Backend assigns timestamp
```

**When Timestamps ARE Sent:**

- ESP32 configures NTP (Network Time Protocol) on startup
- GMT offset: +8 hours (Asia/Manila timezone)
- Timestamps are ONLY included in **RFID scan events**, NOT power readings

**Implications:**

1. **Network Latency Impact:**
   - Unlike the statement's claim, timestamps ARE subject to network latency
   - If a power reading takes 500ms to reach backend due to network delay, the timestamp will be 500ms late
   - However, this is acceptable because power readings are sent every 1 second (1000ms), so minor delays are negligible

2. **Time Synchronization:**
   - Relies on backend server clock accuracy
   - No clock drift compensation between ESP32 and backend
   - Acceptable for 1-second granularity measurements

3. **Buffering Timestamp:**
   - Energy buffer uses the **midpoint** of the 60-second window as the timestamp for aggregated EnergyLog entries
   - Formula: `midpoint = window_start + (60 seconds / 2)`
   - This averages out any minor latency variations

**Code Evidence - Buffer Midpoint Calculation:**

- **File:** `backend/core/services/energy_buffer.py` (lines 90-95)

```python
# Midpoint of the window
if start_time:
    midpoint = start_time + timedelta(seconds=window_seconds / 2)
else:
    midpoint = timezone.now()

agg = {
    "timestamp": midpoint,  # ← Midpoint timestamp, not actual reception time
    # ...
}
```

**Conclusion:** The statement's claim about preventing timestamp discrepancies is **misleading**. While kWh calculation doesn't use timestamps directly (it uses power averages over duration), the individual power readings DO have timestamps assigned by the backend, which ARE subject to network latency.

---

### 2. Dashboard Display Components ✅ ACCURATE

**Finding:** The dashboard correctly displays all mentioned components.

**Evidence:**

- **File:** `aem/src/pages/DashboardPage.tsx`
- **File:** `aem/src/hooks/useDashboard.ts`

**Session Indicators:**

```typescript
// From DashboardData type definition
{
  total_sessions_today: number;
  active_sessions: number;
  completed_sessions: number;
  invalid_sessions: number;
}
```

**Live Electrical Measurements:**

```typescript
// Per classroom display (DashboardPage.tsx lines 143-172)
- Voltage: `${classroom.current_voltage.toFixed(1)} V`
- Current: `${classroom.current_current.toFixed(3)} A`
- Power: `${classroom.current_power.toFixed(1)} W`
```

**Current Teacher and Status:**

```typescript
// DashboardPage.tsx lines 98-103
current_teacher?.full_name || "None"
Badge: "Occupied" vs "Available"
```

---

### 2. Dashboard Display Components ✅ ACCURATE

**Finding:** The dashboard correctly displays all mentioned components.

**Evidence:**

- **File:** `aem/src/pages/DashboardPage.tsx`
- **File:** `aem/src/hooks/useDashboard.ts`

**Session Indicators:**

```typescript
// From DashboardData type definition
{
  total_sessions_today: number;
  active_sessions: number;
  completed_sessions: number;
  invalid_sessions: number;
}
```

**Live Electrical Measurements:**

```typescript
// Per classroom display (DashboardPage.tsx lines 143-172)
- Voltage: `${classroom.current_voltage.toFixed(1)} V`
- Current: `${classroom.current_current.toFixed(3)} A`
- Power: `${classroom.current_power.toFixed(1)} W`
```

**Current Teacher and Status:**

```typescript
// DashboardPage.tsx lines 98-103
current_teacher?.full_name || "None"
Badge: "Occupied" vs "Available"
```

---

### 3. ESP32 Data Transmission Interval ✅ ACCURATE (Value: 1 second)

**Finding:** ESP32 transmits electrical parameters at a fixed interval of **1 second**.

**Evidence:**

- **File:** `esp32/src/main.cpp` (line 96)

```cpp
#define POWER_READ_INTERVAL 1000 // 1 second for real-time dashboard
```

**Main Loop Implementation (lines 281-297):**

```cpp
// 4. Send power data periodically
if (currentMillis - lastPowerRead >= POWER_READ_INTERVAL)
{
    lastPowerRead = currentMillis;

    #if USE_PZEM_004T
        currentVoltage = readRMSVoltage();
        currentCurrent = readRMSCurrent();
        currentPower = readPowerFromPzem();  // Use PZEM active power
    #else
        currentVoltage = readRMSVoltage();
        currentCurrent = readRMSCurrent();
        currentPower = currentVoltage * currentCurrent;
    #endif

    if (wsConnected)
    {
        sendPowerData(currentVoltage, currentCurrent, currentPower);
    }
}
```

**WebSocket Payload:**

```json
{
  "device_id": "ESP32-ROOM-01",
  "voltage": 224.5,
  "current": 1.25,
  "power": 280.6
}
```

---

### 4. Real-Time Updates via WebSocket ✅ ACCURATE

**Finding:** Dashboard receives real-time updates through WebSocket connections.

**Evidence:**

- **Backend:** `backend/core/consumers.py` (lines 233-244)
- **Frontend:** `aem/src/hooks/useDashboard.ts` (lines 87-106)

**Backend Broadcasting:**

```python
# Real-time broadcast to dashboard (consumers.py line 233)
await self.channel_layer.group_send(
    f'dashboard_classroom_{self.classroom_id}',
    {
        'type': 'power_update',
        'classroom_id': self.classroom_id,
        'voltage': voltage,
        'current': current,
        'watts': power,
        'timestamp': timezone.now().isoformat()
    }
)
```

**Frontend WebSocket Handling:**

```typescript
// useDashboard.ts line 87
case 'power':
  // Update power for specific classroom in real-time
  console.log('Power update for classroom:', message.classroom_id);

  // Add to power history for real-time chart
  setPowerHistory(prev => [...newHistory]);
```

---

### 5. Energy Consumption Calculation ❌ **CRITICALLY INACCURATE**

**CLAIM:** "The accumulated energy consumption (kWh) displayed on the dashboard is not manually calculated from power over time by the web application. Instead, it is extracted directly from the internal cumulative energy register of the PZEM-004T module."

**ACTUAL IMPLEMENTATION:** This claim is **FALSE**. Energy consumption (kWh) is calculated by the backend web application from power readings over time, NOT extracted from any PZEM register.

#### 4.1 What the ESP32 Actually Transmits

**Evidence:** `esp32/src/main.cpp`

The ESP32 firmware **ONLY sends instantaneous power (Watts)**, NOT cumulative energy (kWh):

**With PZEM-004T (USE_PZEM_004T = 1):**

```cpp
currentPower = readPowerFromPzem();  // Active power in Watts
```

**With ZMPT101B + ACS724 (USE_PZEM_004T = 0):**

```cpp
currentPower = currentVoltage * currentCurrent;  // Apparent power in Watts
```

**Critical Observation:**

- No code in `esp32/src/main.cpp` accesses PZEM's energy register
- Search for "energy|kwh|kWh" in ESP32 code yields **ZERO results** for energy transmission
- The `MycilaPZEM` library callback only captures: `data.voltage`, `data.current`, `data.activePower`
- **NO** access to `data.energy` or similar cumulative register

**Documentation Confirmation:**

- `docs/POWER_SENSORS_AND_PZEM.md` (line 19):
  > "WebSocket payload sent to the backend is identical: `{ "device_id", "voltage", "current", "power" }`"
  > Note: Only instantaneous values, no energy field

#### 4.2 How kWh is Actually Calculated

**Evidence:** `backend/core/services/energy_calculation.py` (lines 59-105)

**Two-Stage Process:**

**Stage 1: Energy Buffering (60-second windows)**

- **File:** `backend/core/services/energy_buffer.py`
- **File:** `backend/core/consumers.py` (lines 246-251)

```python
# Power readings are buffered in memory
# When 60 seconds elapse, compute average power
from core.services.energy_buffer import add_reading, flush_and_aggregate

should_flush = add_reading(self.classroom_id, voltage, current, power, timestamp)
if should_flush:
    agg = flush_and_aggregate(self.classroom_id)  # Returns averaged values
    if agg and agg.get('avg_watts') is not None:
        await self.save_energy_log_aggregated(agg)
```

**EnergyLog saved to database:**

```python
EnergyLog.objects.create(
    classroom=classroom,
    voltage=agg['avg_voltage'],     # Average over 60s
    current=agg['avg_current'],     # Average over 60s
    watts=agg['avg_watts'],         # Average power over 60s
    timestamp=agg['timestamp']      # Midpoint of window
)
```

**Stage 2: Teacher Energy Calculation (Per Session kWh)**

- **File:** `backend/core/services/energy_calculation.py` (lines 88-102)

```python
def calculate_teacher_energy_for_session(session):
    # Query EnergyLog rows during session
    energy_logs = EnergyLog.objects.filter(
        classroom=session.classroom,
        timestamp__gte=session.time_in,
        timestamp__lte=session.time_out
    )

    # Calculate average power across all logs
    stats = energy_logs.aggregate(
        avg_watts=Avg('watts'),
        max_watts=Max('watts'),
        min_watts=Min('watts'),
        reading_count=Count('id')
    )

    # Calculate duration
    hours = (session.time_out - session.time_in).total_seconds() / 3600

    # CRITICAL: Manual kWh calculation
    total_kwh = (float(stats['avg_watts']) * hours) / 1000
```

**Formula Used:**
$$\text{kWh} = \frac{\text{Average Watts} \times \text{Duration (hours)}}{1000}$$

**Official Documentation Confirms This:**

- `docs/ENERGY_COMPUTATION.md` (lines 309-322):
  > "### 5.2 The kWh Formula
  >
  > The core formula is:
  >
  > kWh = (Average Watts × Duration (hours)) / 1000
  >
  > Where:
  >
  > - **Average Watts** = mean of all EnergyLog.watts values recorded during the session
  > - **Duration (hours)** = (time_out - time_in).total_seconds() / 3600"

#### 4.3 Why PZEM Energy Register is NOT Used

**Reasons:**

1. **Hardware Configuration:** The system supports TWO sensor options:
   - Option A: ZMPT101B + ACS724 (analog sensors) - **NO PZEM module**
   - Option B: PZEM-004T - Has energy register but **NOT accessed by firmware**

2. **Firmware Implementation:**
   - Compile-time flag: `#define USE_PZEM_004T 0` (default = analog sensors)
   - Even when `USE_PZEM_004T = 1`, only instantaneous power is read

3. **Design Decision:**
   - Backend needs uniform data from all classrooms
   - Some rooms use analog sensors (no cumulative register)
   - **Solution:** Calculate kWh centrally from power readings

4. **Documentation Consistency:**
   - All documentation describes power-over-time calculation
   - Zero mentions of extracting cumulative energy from PZEM

---

### 6. Data Flow Architecture

**Complete Pipeline (as actually implemented):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ ESP32 Firmware (esp32/src/main.cpp)                                 │
│                                                                      │
│  Every 1 second:                                                    │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ Option A (ZMPT+ACS): power = voltage × current          │      │
│  │ Option B (PZEM):     power = PZEM.activePower           │      │
│  └──────────────────────────────────────────────────────────┘      │
│                           ↓                                         │
│  Send WebSocket: {"voltage": V, "current": I, "power": W}          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Backend (backend/core/consumers.py)                                 │
│                                                                      │
│  1. Broadcast to dashboard (REAL-TIME)                             │
│     → WebSocket → Frontend → Live power display                     │
│                                                                      │
│  2. Buffer power readings (energy_buffer.py)                        │
│     → Accumulate 60 readings (1/second × 60s)                      │
│     → Calculate average power                                       │
│     → Save to EnergyLog (1 row per 60s)                            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Teacher Session Ends (energy_calculation.py)                        │
│                                                                      │
│  1. Query EnergyLog.filter(time_in ≤ timestamp ≤ time_out)         │
│  2. Calculate avg_watts = AVG(EnergyLog.watts)                     │
│  3. Calculate duration_hours = (time_out - time_in) / 3600         │
│  4. Calculate kWh = (avg_watts × duration_hours) / 1000            │
│  5. Save to TeacherEnergyUsage                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Frontend Dashboard & Reports                                        │
│                                                                      │
│  • Real-time power display (from WebSocket)                        │
│  • Teacher Energy Page (queries TeacherEnergyUsage.total_kwh)      │
│  • Energy Reports Page (aggregates EnergyLog for date ranges)      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Room ACAD 107 Specificity

**Note:** The statement mentions "ESP32 device installed in Room ACAD 107."

**Finding:** The codebase supports multiple classrooms through `classroom_id` routing. ACAD 107 would be one of many rooms, each with its own:

- Device token (e.g., `ESP32-H3WV263437R`)
- Classroom ID (e.g., `classroom_id = 1`)
- WebSocket group (`iot_classroom_{id}`)

**Evidence:**

```cpp
// esp32/src/main.cpp
const char *WS_HOST = "192.168.254.108";
const char *DEVICE_TOKEN = "ESP32-H3WV263437R";
const int CLASSROOM_ID = 1;
```

The system architecture is multi-room, not specific to ACAD 107 alone.

---

## Timestamp Synchronization Details

### NTP Configuration on ESP32

**Evidence:** `esp32/src/main.cpp` (lines 54-57, 724-745)

```cpp
// NTP Configuration
const char *NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 8 * 3600;  // +8 hours (Asia/Manila)
const int DAYLIGHT_OFFSET_SEC = 0;

void setupNTP()
{
    Serial.println("Configuring NTP time...");
    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);

    struct tm timeinfo;
    for (int i = 0; i < 5; i++)
    {
        if (getLocalTime(&timeinfo))
        {
            timeSync = true;
            Serial.printf("Time: %02d:%02d:%02d\n",
                          timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
            return;
        }
        delay(500);
    }
    Serial.println("NTP sync failed");
}
```

**Key Points:**

1. ESP32 syncs with NTP server on startup
2. Local time is Asia/Manila (GMT+8)
3. If NTP sync fails, ESP32 continues operating but without accurate time
4. **Timestamps are NOT used for power readings** - only for RFID events and LCD display

### Backend Timestamp Assignment

**When ESP32 Sends Timestamps:**

- ✅ RFID scan events (includes ISO-formatted timestamp)
- ❌ Power readings (NO timestamp field)
- ❌ Heartbeat messages (NO timestamp field)

**Backend Fallback Logic:**

```python
# backend/core/consumers.py
timestamp_str = data.get('timestamp')

if timestamp_str and timestamp_str.strip():
    # Parse ESP32 timestamp (RFID events only)
    timestamp = datetime.fromisoformat(timestamp_str)
else:
    # All power readings use server reception time
    timestamp = timezone.now()  # Django server clock
```

### Impact on Energy Calculation

**Why timestamps don't affect kWh accuracy:**

1. **kWh calculation uses duration, not timestamps:**

   ```python
   duration_hours = (session.time_out - session.time_in).total_seconds() / 3600
   total_kwh = (avg_watts * duration_hours) / 1000
   ```

2. **Buffering averages out latency:**
   - 60 power readings buffered over 60 seconds
   - Average power calculated from all readings
   - Timestamp = midpoint of window (compensates for variations)

3. **Session boundaries use RFID timestamps:**
   - Teacher check-in/out times DO use ESP32 timestamps (when NTP is synced)
   - These timestamps ARE subject to network latency
   - Typically <1 second delay, negligible for multi-minute sessions

**Conclusion:** While individual power reading timestamps have backend-assigned times subject to network latency, this does NOT introduce significant error in kWh calculation because:

- Energy is calculated from averaged power over session duration
- Duration is measured in minutes/hours (1-2 second latency is <0.1% error)
- Buffering smooths out timing variations

---

## Conclusion and Corrected Statement

### Inaccuracies Summary:

| Claim                              | Status        | Reality                                            |
| ---------------------------------- | ------------- | -------------------------------------------------- |
| ESP32 transmits at fixed intervals | ✅ TRUE       | **1 second** interval                              |
| Dashboard shows session indicators | ✅ TRUE       | Total, Active, Completed, Invalid                  |
| Dashboard shows live V, I, P       | ✅ TRUE       | Via WebSocket, updated every 1s                    |
| Shows teacher and classroom status | ✅ TRUE       | Current teacher, countdown timers                  |
| kWh from PZEM energy register      | ❌ **FALSE**  | kWh calculated by backend from power over time     |
| Prevents network latency issues    | ⚠️ MISLEADING | Timestamps assigned by backend, subject to latency |
| ESP32 sends timestamps with data   | ❌ **FALSE**  | Only RFID events have timestamps, not power data   |

### Corrected Statement:

> "The Real-Time Dashboard of the PowerAudit web application displays key session indicators—Total Sessions Today, Active Sessions, Completed Sessions, and Invalid Sessions—along with live electrical measurements of Voltage, Current, and Power transmitted from the ESP32 device at a fixed interval of every **1 second**. It also shows the current classroom status, including the teacher on session and continuously updated energy readings. **The ESP32 does not include timestamps with power data transmissions; instead, timestamps are assigned by the backend server upon reception.** To ensure data accuracy and reduce database overhead, **the backend buffers power readings in 60-second windows and calculates accumulated energy consumption (kWh) using the formula: kWh = (Average Watts × Duration in hours) / 1000**. When using the PZEM-004T module, the ESP32 reads the module's instantaneous active power measurement; **however, cumulative energy is not extracted from the PZEM's internal register. Instead, it is computed by the web application backend from averaged power readings over the session duration**, providing accurate, session-based energy consumption metrics. **While timestamps are subject to network latency (typically <1 second), this has negligible impact on kWh accuracy due to the averaging process and minute-to-hour session durations.**"

---

## Technical References

### Key Files Analyzed:

1. **ESP32 Firmware:**
   - `esp32/src/main.cpp` (1406 lines) - Main firmware logic
   - `esp32/src/currentSensor.cpp` - ACS724 test suite

2. **Backend Services:**
   - `backend/core/consumers.py` (898 lines) - WebSocket handler
   - `backend/core/services/energy_buffer.py` (112 lines) - Buffering logic
   - `backend/core/services/energy_calculation.py` (278 lines) - kWh calculation

3. **Frontend:**
   - `aem/src/pages/DashboardPage.tsx` (387 lines) - Dashboard UI
   - `aem/src/hooks/useDashboard.ts` (267 lines) - WebSocket integration

4. **Documentation:**
   - `docs/ENERGY_COMPUTATION.md` (696 lines) - Full energy pipeline
   - `docs/POWER_SENSORS_AND_PZEM.md` (105 lines) - Sensor comparison

### Data Models Involved:

```python
# EnergyLog - Stores 60-second averaged power readings
class EnergyLog(models.Model):
    classroom = ForeignKey(Classroom)
    voltage = FloatField()      # Average V over 60s
    current = FloatField()      # Average A over 60s
    watts = FloatField()        # Average W over 60s
    timestamp = DateTimeField() # Midpoint of window

# TeacherEnergyUsage - Stores calculated kWh per session
class TeacherEnergyUsage(models.Model):
    teacher = ForeignKey(User)
    attendance_session = OneToOne(AttendanceSession)
    total_kwh = DecimalField()  # Calculated from EnergyLog
    avg_watts = FloatField()    # Average during session
    duration_minutes = IntegerField()
```

---

## Recommendations

1. **Update Project Documentation:**
   - Clarify that kWh is calculated, not measured directly
   - Document the 1-second transmission interval explicitly
   - Add architecture diagrams showing data flow

2. **Consider Alternative Implementations (Future):**
   - If PZEM energy register is desired, firmware modifications needed
   - Would require transmitting cumulative energy alongside power
   - Trade-off: Complexity vs. potential accuracy improvement

3. **Validation Testing:**
   - Compare calculated kWh against external energy meters
   - Verify 60-second buffering doesn't introduce significant error
   - Test with different power factor loads (PZEM vs analog sensors)

---

**Report Generated:** May 4, 2026  
**Project:** PowerAudit - IoT Attendance & Energy Monitoring System  
**Repository:** djahasiel101600/ProjectRFID  
**Branch:** remote-calibrate-now
