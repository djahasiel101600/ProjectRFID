# Power Sensors: ZMPT101B + ACS724 vs PZEM-004T

This document describes the **two supported power-measurement options** in the ESP32 firmware and what changed when PZEM-004T support was added. The backend and frontend are **unchanged**; only the firmware can use either sensor set.

---

## 1. Sensor Options (compile-time switch)

| Option | Define in `esp32/src/main.cpp` | Hardware | How it works |
|--------|---------------------------------|---------|--------------|
| **A** | `#define USE_PZEM_004T 0` **(default)** | ZMPT101B (voltage) + ACS724 (current) on ADC | Analog pins → RMS voltage/current → power = V×I |
| **B** | `#define USE_PZEM_004T 1` | PZEM-004T v3 over UART | Module reports voltage, current, and active power directly |

- **Default is 0**: existing ZMPT101B + ACS724 behavior is unchanged.
- **Set to 1** to use PZEM-004T (requires wiring and `MycilaPZEM` library).

---

## 2. What stays the same (no breaking changes)

- **WebSocket payload** sent to the backend is identical: `{ "device_id", "voltage", "current", "power" }` (and optional `timestamp`).
- **Backend** (`core/consumers.py`, `EnergyLog`, energy buffer, dashboard) expects these three values; no code changes.
- **Frontend** (Admin calibration UI, dashboard power display) is unchanged.
- **Calibration API**: backend still sends `calibration_config` and accepts `calibration_result`; only which fields the ESP32 uses differs by sensor (see below).

---

## 3. Wiring

### Option A: ZMPT101B + ACS724 (USE_PZEM_004T = 0)

| Sensor | ESP32 pin | Notes |
|--------|-----------|--------|
| ZMPT101B OUT | GPIO 34 (ADC1_CH6) | Voltage, 5V/GND to sensor |
| ACS724 OUT | GPIO 35 (ADC1_CH7) | Current, 5V/GND to sensor |

### Option B: PZEM-004T (USE_PZEM_004T = 1)

| Connection | ESP32 | PZEM-004T |
|------------|--------|-----------|
| RX | GPIO 16 | TX (from PZEM) |
| TX | GPIO 17 | RX (to PZEM) |
| GND | GND | GND |

Pins are defined in `main.cpp` as `PZEM_RX_PIN` and `PZEM_TX_PIN`; change them if you use different GPIOs. The firmware uses **Serial2** for PZEM; do not use the same UART for anything else.

---

## 4. Calibration behavior

### Option A (ZMPT101B + ACS724)

- **From backend** (`calibration_config`): uses all fields — `voltage_sensitivity`, `current_sensitivity`, `quiescent_voltage`, `nominal_voltage`, `add_ampere`.
- **Calibrate Now**: runs zero-point calibration on the current sensor (no load), updates `quiescent_voltage`, sends `calibration_result(quiescent_voltage)` to the backend.

### Option B (PZEM-004T)

- **From backend** (`calibration_config`): uses only **`nominal_voltage`** (for capping) and **`add_ampere`** (offset added to current). Other fields are ignored.
- **Calibrate Now**: does not run hardware calibration. Sends `calibration_result(0)` so the backend still receives a result; LCD shows “PZEM / No cal needed”.

---

## 5. Power value

- **Option A**: Power = voltage × current (apparent power; assumes resistive load).
- **Option B**: Power = **PZEM active power** (watts from the module; better when power factor &lt; 1).

---

## 6. Firmware changes (summary)

| Area | Change |
|------|--------|
| **Top of main.cpp** | `#define USE_PZEM_004T 0`; conditional `#include` of `MycilaPZEM.h` or `ZMPT101B.h`. |
| **Pins** | When PZEM: `PZEM_RX_PIN` (16), `PZEM_TX_PIN` (17). When ZMPT/ACS724: `VOLTAGE_SENSOR_PIN` (34), `CURRENT_SENSOR_PIN` (35). |
| **Globals** | When PZEM: `Mycila::PZEM pzem`, `lastPzemVoltage`, `lastPzemCurrent`, `lastPzemPower`. When ZMPT/ACS724: `ZMPT101B voltageSensor`. |
| **setupPowerMonitoring()** | PZEM: init Serial2 + PZEM, set async callback to update `lastPzem*`. ZMPT/ACS724: ADC setup, zero-point calibration. |
| **Main loop** | PZEM: call `pzem.loop()`; power = `readPowerFromPzem()`. ZMPT/ACS724: power = voltage × current. |
| **readRMSVoltage() / readRMSCurrent()** | PZEM: return last value from callback (with NaN/range checks). ZMPT/ACS724: unchanged ADC + RMS logic. |
| **readPowerFromPzem()** | New function only when `USE_PZEM_004T`; returns `lastPzemPower`. |
| **runZeroPointCalibration()** | Only compiled when `!USE_PZEM_004T`. |
| **calibrate_now handler** | PZEM: send `calibration_result(0)`, show “No cal needed”. ZMPT/ACS724: call `runZeroPointCalibration()`. |
| **calibration_config handler** | PZEM: apply only `nominal_voltage` and `add_ampere`. ZMPT/ACS724: apply all fields and `voltageSensor.setSensitivity()`. |

---

## 7. Enabling PZEM-004T

1. **Wiring**: Connect PZEM-004T to ESP32 as in section 3 (Option B).
2. **Library**: In `esp32/platformio.ini`, `lib_deps` includes `mathieucarbou/MycilaPZEM@^1.3.0`. Run `pio run` to install.
3. **Switch**: In `esp32/src/main.cpp`, set:
   ```c
   #define USE_PZEM_004T 1
   ```
4. **Optional**: Change `PZEM_RX_PIN` / `PZEM_TX_PIN` if using different GPIOs.
5. **Build and upload**: `pio run`, then `pio run --target upload`.

---

## 8. References

- **System overview**: [System Architecture](SYSTEM_ARCHITECTURE.md)
- **Firmware setup**: [ESP32 README](../esp32/README.md)
- **Admin calibration UI**: Backend → Classrooms → Sensor Calibration (same for both sensor options).
