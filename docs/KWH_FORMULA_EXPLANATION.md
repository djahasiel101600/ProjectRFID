# kWh Formula Explanation: Energy Consumption Calculation

## The Formula

```
kWh = (Average Watts × Duration in hours) / 1000
```

This formula is used throughout the PowerAudit system to calculate energy consumption for teacher sessions.

---

## Why This Formula Works: Mathematical Foundation

### Understanding the Units

**Energy** is the integral of **power** over **time**. Let's break down the units:

- **Power (P)** = Watts (W) = Joules per second (J/s)
- **Time (t)** = hours (h)
- **Energy (E)** = Power × Time = Watt-hours (Wh)
- **kWh** = kilowatt-hours = 1000 Watt-hours

### Basic Physics

Energy consumption is defined as:

$$E = \int P(t) \, dt$$

Where:

- $E$ = Energy consumed
- $P(t)$ = Power as a function of time
- $dt$ = infinitesimal time interval

**In simple terms:** Energy is the area under the power-time curve.

### Why Average Power Works

For a **constant power load**:
$$E = P \times t$$

For a **variable power load** (like classroom lights and equipment):
$$E = \overline{P} \times t$$

Where $\overline{P}$ is the **average power** over the time period.

This is mathematically equivalent to:
$$\overline{P} = \frac{1}{t} \int_0^t P(\tau) \, d\tau$$

**The averaging operation replaces the integral**, which is exactly what the PowerAudit system does by averaging power readings over the session duration.

---

## Unit Conversion

### Why Divide by 1000?

The formula converts **Watt-hours (Wh)** to **kilowatt-hours (kWh)**:

$$\text{kWh} = \frac{\text{Wh}}{1000} = \frac{W \times h}{1000}$$

**Example:**

- Power: 250 Watts
- Duration: 2 hours
- Energy: $250 \, \text{W} \times 2 \, \text{h} = 500 \, \text{Wh} = 0.5 \, \text{kWh}$

Using the formula:
$$\text{kWh} = \frac{250 \times 2}{1000} = 0.5 \, \text{kWh}$$

---

## Accuracy Analysis

### ✅ When This Formula is ACCURATE

1. **Constant or slowly-varying loads:**
   - Lighting systems (primary classroom load)
   - Projectors running continuously
   - Air conditioning at steady state
2. **Sufficient sampling rate:**
   - PowerAudit: 1 reading/second → 60 readings/minute
   - Captures most load variations
   - Classroom loads typically change slowly (lights on/off, projector on/off)

3. **Averaging reduces error:**
   - 60-second buffer windows smooth out instantaneous fluctuations
   - Session durations are typically 30-120 minutes
   - Short-duration power spikes average out over time

### ⚠️ Potential Sources of Error

#### 1. **Power Factor (For Analog Sensors Only)**

**Issue:** The formula assumes **active power** (real power that does work).

- **With ZMPT101B + ACS724:**
  - Power = Voltage × Current = **Apparent Power** (VA)
  - Does NOT account for power factor (PF)
  - True power = Apparent Power × PF
- **With PZEM-004T:**
  - Reports **active power** directly (Watts, not VA)
  - Power factor already accounted for by the module
  - ✅ More accurate for reactive loads

**Typical Classroom Power Factors:**

- Incandescent/LED lights: PF ≈ 0.95-1.0 (minimal error)
- Fluorescent lights: PF ≈ 0.85-0.95 (5-15% overestimation with analog sensors)
- Computers/projectors: PF ≈ 0.7-0.9 (10-30% overestimation with analog sensors)

**Impact in PowerAudit:**

- If using ZMPT+ACS with PF=0.85, calculated kWh may be **15% higher** than actual
- PZEM-004T eliminates this error

#### 2. **Sampling Gaps**

**Issue:** If the ESP32 loses connection, power data is missed.

**Mitigation in PowerAudit:**

- Session duration is based on RFID check-in/out times (independent of power readings)
- Average power is calculated only from available readings
- Missing data creates **underestimation** of energy if outage occurs during high-load periods

**Example:**

- Teacher session: 60 minutes
- ESP32 disconnected for 5 minutes during high load (projector usage)
- Result: Average power will be slightly lower → kWh underestimated

#### 3. **Timestamp Latency (Minor)**

**Issue:** Backend assigns timestamps when data arrives, not when measured.

**Impact:**

- Network latency: typically <1 second
- Session durations: 30-120 minutes (1800-7200 seconds)
- Error: <0.05% (negligible)

#### 4. **Transient Loads**

**Issue:** Very brief high-power events (e.g., motor startup) between 1-second samples.

**Impact:**

- 1-second sampling interval may miss sub-second spikes
- For classroom environments, this is minimal (no large motors)
- LED/fluorescent lights and projectors have low inrush currents

---

## How PowerAudit Implements This

### Data Collection (ESP32)

```cpp
// Every 1 second
currentPower = voltage × current;  // or PZEM active power
sendPowerData(voltage, current, currentPower);
```

### Buffering (Backend)

```python
# Collect 60 readings over 60 seconds
readings = [280W, 275W, 282W, ..., 278W]  # 60 values

# Calculate average
avg_watts = sum(readings) / len(readings)  # e.g., 279.5W

# Save to database as one EnergyLog entry
```

### Session Energy Calculation

```python
# Query all EnergyLog entries during session
energy_logs = EnergyLog.filter(
    timestamp >= session.time_in,
    timestamp <= session.time_out
)

# Average of averages (weighted equally)
avg_watts = AVG(energy_logs.watts)  # e.g., 265.3W

# Session duration
duration_hours = (time_out - time_in).total_seconds() / 3600  # e.g., 1.5 hours

# Calculate kWh
total_kwh = (avg_watts × duration_hours) / 1000
# = (265.3 × 1.5) / 1000 = 0.398 kWh
```

---

## Numerical Example

### Scenario: Math Teacher's 90-Minute Session

**Setup:**

- Classroom: ACAD 107
- Teacher: Prof. Juan Dela Cruz
- Session: 8:00 AM - 9:30 AM (1.5 hours)
- Equipment: LED lights (150W), Projector (100W), Laptop (50W)

**Power Profile:**

- 8:00-8:05: Lights only (150W) - settling in
- 8:05-9:25: Lights + Projector + Laptop (300W) - active teaching
- 9:25-9:30: Lights only (150W) - wrapping up

**Data Collection:**

- Total readings: 90 minutes × 60 readings/minute = 5,400 readings
- Buffered to: 90 EnergyLog entries (one per minute)

**Sample EnergyLog Data:**

```
Minute 1-5:   avg_watts = 150W (5 entries)
Minute 6-85:  avg_watts = 300W (80 entries)
Minute 86-90: avg_watts = 150W (5 entries)
```

**Calculation:**

```python
# Average power across all 90 entries
avg_watts = [(150×5) + (300×80) + (150×5)] / 90
          = [750 + 24,000 + 750] / 90
          = 25,500 / 90
          = 283.33 W

# Duration
duration_hours = 1.5

# Energy consumed
kWh = (283.33 × 1.5) / 1000
    = 425 / 1000
    = 0.425 kWh
```

**Validation Using Exact Integration:**

```python
# True energy (Wh) if we had continuous measurement:
energy_Wh = (150W × 5min) + (300W × 80min) + (150W × 5min)
          = 750 + 24,000 + 750
          = 25,500 Wh / 60 min/hr
          = 425 Wh
          = 0.425 kWh
```

**Result:** ✅ **Exact match!** The formula produces the correct result.

---

## Comparison with Utility Meter Approach

### How Electric Companies Measure Energy

**Mechanical Meters (Old):**

- Rotating disk driven by electromagnetic induction
- Rotation speed ∝ power consumption
- Total rotations = energy consumed
- Essentially performs continuous integration: $E = \int P(t) \, dt$

**Digital Meters (Modern):**

- Sample power at high frequency (e.g., every 100ms)
- Accumulate energy: $E_{n+1} = E_n + P_n \times \Delta t$
- Similar to PowerAudit but at higher sampling rate

**PowerAudit vs. Utility Meter:**
| Feature | Utility Meter | PowerAudit |
|---------|---------------|------------|
| Sampling Rate | 10-100 samples/sec | 1 sample/sec |
| Power Type | Active (kW) | Active (PZEM) or Apparent (Analog) |
| Accuracy | ±1-2% | ±5-15% (depending on sensor) |
| Purpose | Billing | Session tracking |
| Cost | $50-200 | ~$20 (ESP32 + sensors) |

**Conclusion:** PowerAudit's approach is fundamentally the same as utility meters, just at lower sampling rate (sufficient for classroom monitoring).

---

## Alternative Formulas (NOT Used)

### 1. Trapezoidal Integration

```python
# More accurate for rapidly changing loads
energy = 0
for i in range(len(readings)-1):
    energy += (readings[i] + readings[i+1]) / 2 * dt
```

**Why not used:** Overkill for classroom loads; simple average is sufficient.

### 2. Simpson's Rule

```python
# Even more accurate numerical integration
energy = simps(power_readings, time_readings)
```

**Why not used:** Requires evenly-spaced samples; adds complexity with minimal benefit.

### 3. Instantaneous Power × Total Time

```python
# WRONG - only accurate for constant loads
energy = current_power × duration
```

**Why wrong:** Ignores load variations over time.

---

## Accuracy Verification: Real-World Testing

### Recommended Validation Method

To verify the formula's accuracy for your specific classroom:

1. **Install calibrated reference meter** (e.g., Kill-A-Watt, energy monitoring plug)
2. **Run parallel measurement:**
   - PowerAudit records session
   - Reference meter measures same circuit
3. **Compare results:**
   ```
   Error % = |PowerAudit_kWh - Reference_kWh| / Reference_kWh × 100
   ```

**Expected Results:**

- With PZEM-004T: ±2-5% error
- With ZMPT+ACS (resistive loads): ±5-10% error
- With ZMPT+ACS (mixed loads): ±10-20% error

---

## Conclusion

### Is the Formula Accurate?

**Yes, for the intended use case:**

✅ **Strengths:**

- Mathematically sound (energy = average power × time)
- Appropriate for slowly-varying classroom loads
- 1-second sampling captures typical load changes
- Buffering reduces noise and smooths variations
- Suitable for session-level energy tracking

⚠️ **Limitations:**

- Power factor error with analog sensors (use PZEM-004T to eliminate)
- Cannot capture sub-second transients (not relevant for classrooms)
- Assumes no data loss during session (ESP32 must stay connected)
- Accuracy depends on sensor calibration

🎯 **Recommendation:**

- **For billing/cost allocation:** Use PZEM-004T sensors (±5% accuracy)
- **For behavior tracking:** Analog sensors acceptable (±15% accuracy)
- **Always calibrate** sensors against known loads
- **Validate** with reference meter in actual classroom environment

### Final Verdict

The formula `kWh = (Average Watts × Duration in hours) / 1000` is:

- ✅ **Physically correct**
- ✅ **Mathematically sound**
- ✅ **Appropriately implemented** in PowerAudit
- ✅ **Sufficiently accurate** for educational monitoring (±5-15%)
- ⚠️ **Not utility-grade** (would need ±1-2% for billing)

For the PowerAudit project's purpose (tracking teacher energy consumption, promoting awareness, and energy-saving behavior), this formula and implementation are **excellent choices**.

---

**Report Generated:** May 4, 2026  
**Project:** PowerAudit - IoT Attendance & Energy Monitoring System  
**Repository:** djahasiel101600/ProjectRFID
