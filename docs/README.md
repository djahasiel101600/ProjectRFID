# Project Documentation

Documentation for the IoT-Based Attendance & Energy Consumption Tracking System.

## Documentation Index

| Document                                                  | Description                                            |
| --------------------------------------------------------- | ------------------------------------------------------ |
| [System Architecture](SYSTEM_ARCHITECTURE.md)             | System design, data flow, components, and interactions |
| [Power Sensors & PZEM](POWER_SENSORS_AND_PZEM.md)         | ZMPT101B+ACS724 vs PZEM-004T, wiring, calibration, what changed |
| [Docker Deployment](DOCKER.md)                            | Running the project with Docker Compose                |
| [PRD (Product Requirements)](PRD.md)                      | Project requirements and specifications                |
| [RFID Scan Troubleshooting](RFID_SCAN_TROUBLESHOOTING.md) | Troubleshooting guide for the RFID scan feature        |
| [Schedule Scenarios & Logic](SCHEDULE_SCENARIOS_AND_LOGIC.md) | How the system handles teacher schedules, substitutes, maintenance, overtime, etc. |

## Component READMEs

- [Frontend (aem)](../aem/README.md) – React + TypeScript dashboard
- [ESP32 Firmware](../esp32/README.md) – PlatformIO firmware for classroom devices
