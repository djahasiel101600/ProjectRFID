# Schedule Logic, Decision-Making & Real-World Scenarios

This document describes how the IoT-Based Attendance & Energy Consumption Tracking System reacts to real-world scenarios involving teacher schedules, substitutes, overtime, maintenance, and other common classroom events.

---

## 1. System Overview & Core Design

The system uses **RFID time-in only** (no RFID time-out). Teachers tap in to start a session; they must **manually tap out** to end it. Auto-timeout is **disabled by default** (no Celery Beat schedule); accountability is enforced by requiring manual checkout. Energy consumption is attributed to teachers based on their attendance sessions.

**Key data flow:** ESP32 (RFID + power) → Django IoTConsumer → `process_rfid()` → Schedule validation → AttendanceSession creation/update.

---

## 2. RFID Card Types & Processing Order

When an RFID card is scanned, the backend processes it in this order:

| Order | Card Type          | Purpose                                   | Attendance Created? |
|-------|--------------------|-------------------------------------------|---------------------|
| 1     | **Maintenance RFID** | Staff light control (toggle relay)       | No                  |
| 2     | **Override RFID**    | Teacher substitute/override mode         | Yes (when valid)    |
| 3     | **Normal Teacher RFID** | Standard teacher attendance           | Yes (when valid)    |

---

## 3. Decision-Making Algorithm (process_rfid)

### 3.1 Maintenance Card Logic

```
IF rfid_uid matches MaintenanceRFID (is_active=True):
    IF any teacher has status=IN in this classroom today:
        → maintenance_blocked (ESP32 shows "Teacher present", relay not toggled)
    ELSE:
        → maintenance_toggle (relay toggles, lights on/off)
    EXIT (no attendance record)
```

### 3.2 Teacher Identification

- **Normal card:** `User.objects.get(rfid_uid=rfid_uid, role='teacher')`
- **Override card:** `OverrideRFID.objects.get(rfid_uid=rfid_uid)` → linked teacher. Sets `is_override_mode=True`.

### 3.3 Manual Checkout

```
IF teacher already has AttendanceSession (classroom, date=today, status='IN'):
    → Set time_out=now, status=MANUAL_OUT
    → Calculate TeacherEnergyUsage for session
    → Return attendance_out (ESP32 turns lights OFF)
    EXIT
```

### 3.4 Schedule Matching (Normal Mode)

The system looks for a matching schedule in this order:

1. **During class time:**  
   `start_time <= current_time <= end_time` (same teacher, classroom, day_of_week)

2. **Within 15 minutes of start:**  
   `current_time <= start_time <= current_time + 15 min`  
   (Allows early tap-in before class begins.)

If found → valid schedule. If not found and **override mode** → proceed to vacant slot / early takeover logic.

### 3.5 Override Mode: Vacant Slot

When `is_override_mode=True` and no matching schedule:

- Find schedules in this classroom, same day, where:
  - `start_time <= current_time + 15 min`
  - `end_time >= current_time`
- For each candidate, check if slot is **vacant**:
  - No `AttendanceSession` with `schedule=cand`, `date=today`, `status='IN'`
- Use first vacant slot found. Session is created with `is_override=True`, `expected_out` from that schedule’s `end_time`.

### 3.6 Override Mode: Early Takeover

When `is_override_mode=True`, no vacant slot, but another teacher is IN:

- If the tapping teacher has a **next schedule** in this classroom today (`start_time > current_time`):
  - Use that schedule (early takeover).
  - Previous teacher is **CASCADE_OUT**; tapping teacher gets IN with `expected_out` from their next schedule.

### 3.7 Cascade Checkout

Before creating a new valid session, the system checks for any other teacher IN in this classroom:

- All such sessions are set to `time_out=now`, `status=CASCADE_OUT`.
- Energy is calculated for each cascaded session.
- Dashboard is notified (CASCADE_OUT); ESP32 is **not** told to turn lights off (next teacher receives attendance_in; lights stay on).

### 3.8 Invalid Scan

If no schedule is found (and no override/vacant/early takeover applies):

- `AttendanceSession` is still created with `status=INVALID`, `schedule=None`, `expected_out=None`.
- Event `attendance_invalid` is returned.
- Session is logged for audit; energy is not attributed.

---

## 4. Scenarios the System Handles Well

### 4.1 Teacher Takes Over Vacant Schedule (Substitute)

**Scenario:** Teacher A (8:00–9:00) is absent. Teacher B (has override card) scans at 8:15 in that classroom.

| Step | System Behavior |
|------|-----------------|
| B scans override card | Teacher B identified, `is_override_mode=True` |
| B has no schedule 8:00–9:00 | No matching schedule |
| Vacant slot check | Finds 8:00–9:00 slot (Teacher A’s schedule) with no one IN |
| Result | Session created for B, `expected_out=9:00`, `is_override=True` |

**Outcome:** Substitute attendance recorded with correct `expected_out`.

---

### 4.2 Teacher Exceeds Schedule (Overtime) – Display Only

**Scenario:** Teacher has 8:00–9:00 schedule, taps in at 8:00, does not tap out until 9:30.

| Step | System Behavior |
|------|-----------------|
| At 9:00 | `expected_out` passed; system computes `excess_minutes` |
| Dashboard | Shows “Session Time (excess) + 30 min” in amber |
| Attendance report | Excess minutes shown for accountability |
| Auto-timeout | **Disabled by default** – session stays IN until manual tap-out |

**Outcome:** Excess time is displayed for accountability; no automatic checkout. Teacher must tap out manually.

---

### 4.3 Staff Uses Classroom for Cleaning/Maintenance (No Teacher Present)

**Scenario:** Janitor taps maintenance card when no teacher is in the room.

| Step | System Behavior |
|------|-----------------|
| Maintenance card scanned | No teacher IN |
| Result | `maintenance_toggle` – relay toggles (lights on/off) |
| Attendance | No attendance record |

**Outcome:** Staff controls lights without affecting attendance.

---

### 4.4 Staff Tries to Use Classroom While Teacher Is Present

**Scenario:** Janitor taps maintenance card while teacher has active session (status=IN).

| Step | System Behavior |
|------|-----------------|
| Maintenance card scanned | Teacher IN in this classroom |
| Result | `maintenance_blocked` – ESP32 shows “Teacher present”, relay not toggled |

**Outcome:** Prevents staff from turning off lights while class is in progress.

---

### 4.5 Next Teacher Arrives; Previous Teacher Forgot to Tap Out (Cascade)

**Scenario:** Teacher A (8:00–9:00) taps in, leaves at 8:50 without tapping out. Teacher B (9:00–10:00) taps in at 9:05.

| Step | System Behavior |
|------|-----------------|
| B taps in | B has valid schedule 9:00–10:00 |
| Cascade | A’s session → `CASCADE_OUT`, `time_out=9:05` |
| Energy | TeacherEnergyUsage calculated for A’s session |
| Result | B gets `attendance_in`; lights stay on (ESP32 not told to turn off) |

**Outcome:** Previous teacher is checked out and energy attributed; next teacher takes over cleanly.

---

### 4.6 Early Takeover with Override Card

**Scenario:** Teacher A (8:00–9:00) is still in room at 8:45 (forgot to tap out). Teacher B (9:00–10:00) has override card and taps at 8:45.

| Step | System Behavior |
|------|-----------------|
| B scans override | B identified, `is_override_mode=True` |
| B’s 9:00 schedule | Not yet; current time 8:45 |
| Vacant slot | 8:00–9:00 is not vacant (A is IN) |
| Early takeover | B has next schedule 9:00–10:00 in this room |
| Result | A → CASCADE_OUT; B gets IN with `expected_out=10:00` |

**Outcome:** B can start early; A is cascaded out automatically.

---

### 4.7 Teacher Taps In Within 15 Minutes Before Class

**Scenario:** Schedule 9:00–10:00; teacher taps at 8:50.

| Step | System Behavior |
|------|-----------------|
| Schedule check | `start_time` 9:00 within 15 min of 8:50 |
| Result | Valid; session created with `expected_out=10:00` |

**Outcome:** Early arrival is accepted.

---

### 4.8 Teacher Manually Checks Out

**Scenario:** Teacher taps again during active session.

| Step | System Behavior |
|------|-----------------|
| Same teacher, same room, status=IN | Manual checkout |
| Result | `time_out=now`, `status=MANUAL_OUT`, lights OFF (ESP32 receives attendance_out) |

**Outcome:** Session closed; energy calculated; lights turned off.

---

## 5. Scenarios with Limitations or Gaps

### 5.1 Teacher Exceeds Schedule – No Auto Checkout

**Scenario:** Teacher remains past `expected_out` and never taps out.

| Issue | System Behavior |
|-------|-----------------|
| Auto-timeout | Disabled by default; no automatic checkout |
| Result | Session stays IN indefinitely; excess time keeps increasing on dashboard |

**Gap:** No automatic end-of-session enforcement. Requires manual tap-out or enabling periodic `auto_timeout_sessions` in Celery Beat.

---

### 5.2 Substitute Without Override Card

**Scenario:** Teacher B substitutes for absent Teacher A but uses their **normal** RFID card (no override card).

| Issue | System Behavior |
|-------|-----------------|
| B has no schedule 8:00–9:00 | No matching schedule |
| Override mode | Not active (normal card) |
| Result | `status=INVALID`; session created but marked invalid |

**Gap:** Substitute must use an override card to take vacant slots. Normal card cannot take another teacher’s slot.

---

### 5.3 Staff Wants to Use Classroom While Teacher Is Briefly Away

**Scenario:** Teacher left the room briefly; staff wants to clean. Teacher’s session is still IN.

| Issue | System Behavior |
|-------|-----------------|
| Maintenance card | Blocked because teacher session is still IN |
| Result | Staff cannot toggle lights |

**Gap:** No “teacher away / break” state. Staff must wait for teacher to tap out, or admin would need another mechanism (e.g., manual override) not in the current logic.

---

### 5.4 Two Teachers Share a Slot (Team Teaching)

**Scenario:** Teachers A and B co-teach 9:00–10:00 in the same room. Only one schedule exists (e.g., A’s).

| Issue | System Behavior |
|-------|-----------------|
| B taps in | B has no schedule for that slot |
| Result | INVALID (unless B has override card and slot is “vacant” – but A is IN) |

**Gap:** No built-in support for team teaching. Each teacher would need their own schedule for that slot, or override logic would need to be extended.

---

### 5.5 Substitute in a Classroom Where They Have No Schedule

**Scenario:** Teacher B (override card) substitutes in Room 101. B has no schedule in Room 101 that day.

| System Behavior |
|-----------------|
| Vacant slot in Room 101 | B can take it (override + vacant slot) |
| Result | Valid session; `is_override=True` |

**Handled correctly.** Override allows taking vacant slots even in rooms where the substitute has no schedule.

---

### 5.6 Schedule Change Not Reflected Yet

**Scenario:** Admin changes a schedule after teacher has already tapped in.

| Issue | System Behavior |
|-------|-----------------|
| Session already created | Uses schedule at tap-in time |
| Existing session | Unchanged; `expected_out` from original schedule |

**Gap:** Mid-day schedule edits do not update active sessions. Only new tap-ins use the updated schedule.

---

### 5.7 Teacher Taps In Late (After 15-Minute Window)

**Scenario:** Schedule 9:00–10:00; teacher taps at 9:20.

| Step | System Behavior |
|------|-----------------|
| During class | 9:20 is within 9:00–10:00 |
| Result | Valid session |

**Handled correctly.** Late tap-in is accepted as long as it is within the slot.

---

### 5.8 Teacher Taps In After Schedule End

**Scenario:** Schedule 9:00–10:00; teacher taps at 10:15.

| Issue | System Behavior |
|-------|-----------------|
| No matching schedule | `end_time` 10:00 < 10:15 |
| Override + vacant | Next slot (e.g., 10:00–11:00) might be vacant; could match if within logic |
| If no override / no vacant | INVALID |

**Gap:** Post-schedule tap-in is invalid unless override logic finds a valid vacant or next slot.

---

### 5.9 Multiple Vacant Slots – Which One?

**Scenario:** Slots 8:00–9:00 and 9:00–10:00 are both vacant. Teacher B (override) taps at 8:30.

| System Behavior |
|-----------------|
| Candidates ordered by `start_time` |
| First vacant = 8:00–9:00 |
| Result | B gets 8:00–9:00 slot (`expected_out=9:00`) |

**Handled correctly.** First matching vacant slot is used. No way to choose a different slot via RFID; would need admin override or different logic.

---

### 5.10 Weekend or Holiday Schedules

**Scenario:** School has classes on a Saturday. Schedules use `day_of_week`.

| System Behavior |
|-----------------|
| `day_of_week` 0–6 supported (Mon–Sun) |
| Saturday = 5, Sunday = 6 |
| If schedule exists | Works as usual |

**Handled correctly** if schedules are created for non-standard days.

---

## 6. Summary Table

| Scenario | Handled? | Notes |
|----------|----------|-------|
| Substitute takes vacant slot (override card) | Yes | Vacant slot logic |
| Teacher exceeds schedule (overtime) | Partial | Display only; no auto checkout |
| Staff cleaning (no teacher) | Yes | Maintenance toggle |
| Staff cleaning (teacher present) | Yes | Maintenance blocked |
| Next teacher cascades previous | Yes | CASCADE_OUT |
| Early takeover (override) | Yes | Uses next schedule |
| Early tap-in (within 15 min) | Yes | Schedule window |
| Manual checkout | Yes | MANUAL_OUT |
| Substitute without override card | No | INVALID |
| Staff during teacher “break” | No | Blocked while session IN |
| Team teaching | No | Needs custom handling |
| Post-schedule tap-in | Partial | INVALID unless override/vacant |
| Schedule change mid-session | No | Active session not updated |

---

## 7. Implementation References

- **RFID processing:** `backend/core/consumers.py` → `IoTConsumer.process_rfid()`
- **Maintenance logic:** Lines 259–278
- **Schedule matching:** Lines 367–421
- **Vacant slot:** Lines 423–446
- **Early takeover:** Lines 449–466
- **Cascade:** Lines 467–508
- **Excess time:** `backend/core/consumers.py` `get_dashboard_data()` (lines 708–715)
- **Auto-timeout:** `backend/core/tasks.py` (`auto_timeout_sessions`); not in `CELERY_BEAT_SCHEDULE` by default
