# ESP32 IoT Attendance & Energy Monitor Firmware

This firmware connects an ESP32 device to the Django backend for:

- **RFID-based attendance tracking** using RC522 reader
- **Power consumption monitoring** (simulated via ultrasonic sensor)
- **Real-time status display** on I2C LCD

## Hardware Requirements

| Component            | Quantity | Purpose                      |
| -------------------- | -------- | ---------------------------- |
| ESP32 DevKit         | 1        | Main controller              |
| MFRC522 RFID Reader  | 1        | Card scanning                |
| I2C 16x2 LCD Display | 1        | Status display               |
| HC-SR04 Ultrasonic   | 1        | Power simulation (temporary) |
| Jumper wires         | ~20      | Connections                  |
| Breadboard           | 1        | Prototyping                  |

## Wiring Diagram

### RFID RC522 (SPI)

| RC522 Pin | ESP32 Pin     |
| --------- | ------------- |
| SDA (SS)  | GPIO 5        |
| SCK       | GPIO 18       |
| MOSI      | GPIO 23       |
| MISO      | GPIO 19       |
| IRQ       | Not connected |
| RST       | GPIO 27       |
| 3.3V      | 3.3V          |
| GND       | GND           |

### I2C LCD Display

| LCD Pin | ESP32 Pin |
| ------- | --------- |
| SDA     | GPIO 21   |
| SCL     | GPIO 22   |
| VCC     | 5V        |
| GND     | GND       |

### Ultrasonic HC-SR04

| Sensor Pin | ESP32 Pin |
| ---------- | --------- |
| TRIG       | GPIO 32   |
| ECHO       | GPIO 33   |
| VCC        | 5V        |
| GND        | GND       |

## Software Setup

### 1. Install PlatformIO

- Install [VS Code](https://code.visualstudio.com/)
- Install [PlatformIO IDE extension](https://platformio.org/install/ide?install=vscode)

### 2. Configure the Firmware

Edit `src/main.cpp` and update these settings:

```cpp
// WiFi Configuration
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// WebSocket Server Configuration
const char* WS_HOST = "192.168.1.100";  // Your Django server IP
const uint16_t WS_PORT = 8000;
const char* DEVICE_TOKEN = "YOUR_DEVICE_TOKEN";  // From Django admin
const int CLASSROOM_ID = 1;  // Your classroom ID

// Device Configuration
const char* DEVICE_ID = "ESP32-ROOM-01";
```

### 3. Get Device Token from Django Admin

1. Go to Django Admin: `http://localhost:8000/admin/`
2. Navigate to **Classrooms**
3. Create a new classroom or edit existing
4. Copy the `device_token` value
5. Paste into `DEVICE_TOKEN` in main.cpp

### 4. Build and Upload

```bash
# Build the project
pio run

# Upload to ESP32
pio run --target upload

# Monitor serial output
pio device monitor
```

Or use the PlatformIO toolbar buttons in VS Code.

## Backend Setup

Make sure the Django server is running with Daphne:

```bash
cd backend
python -m daphne -b 0.0.0.0 -p 8000 backend.asgi:application
```

### Create Test Data

```bash
python manage.py shell
```

```python
from core.models import User, Classroom

# Create a classroom with token
classroom = Classroom.objects.create(
    name="Room 101",
    device_id="ESP32-ROOM-01",
    device_token="YOUR_DEVICE_TOKEN"  # Same as ESP32 config
)

# Create a teacher with RFID
teacher = User.objects.create_user(
    username="teacher1",
    password="password123",
    first_name="John",
    last_name="Doe",
    role="teacher",
    rfid_uid="A1B2C3D4"  # Your RFID card UID
)
```

## Getting RFID Card UID

1. Upload the firmware to ESP32
2. Open Serial Monitor (`pio device monitor`)
3. Scan an RFID card
4. The UID will be printed: `RFID Detected: A1B2C3D4`
5. Use this UID when creating teacher in Django

## LCD Display Messages

| Display           | Meaning                          |
| ----------------- | -------------------------------- |
| `Connecting WiFi` | Connecting to WiFi network       |
| `WiFi Connected`  | Successfully connected to WiFi   |
| `WS Connected!`   | WebSocket connected to server    |
| `Online 150W`     | Connected, current power reading |
| `Offline`         | Not connected to WebSocket       |
| `Card Detected!`  | RFID card scanned                |
| `Welcome!`        | Attendance recorded successfully |
| `Error!`          | Something went wrong             |

## Troubleshooting

### WiFi Won't Connect

- Check SSID and password
- Ensure 2.4GHz network (ESP32 doesn't support 5GHz)
- Move closer to router

### WebSocket Connection Failed

- Verify server IP address
- Check if Django is running
- Ensure port 8000 is open
- Check device token matches

### RFID Not Reading

- Check wiring (SPI connections)
- Ensure card is close enough (< 3cm)
- Try different card

### LCD Shows Garbage

- Check I2C address (try 0x27 or 0x3F)
- Verify I2C wiring (SDA, SCL)
- Adjust contrast potentiometer on LCD module

## Power Simulation

Since the actual watt meter isn't available yet, the ultrasonic sensor simulates power:

- **Distance < 10cm**: ~1000W (high load)
- **Distance ~200cm**: ~500W (medium load)
- **Distance > 400cm**: ~50W (base load)

This can be used to test the power monitoring feature by moving objects closer/farther from the sensor.

## Future Hardware

When the watt meter becomes available, replace the ultrasonic functions in `main.cpp`:

```cpp
// Replace readUltrasonicPower() with actual watt meter reading
float readPowerMeter() {
    // TODO: Implement actual watt meter reading
    // Example for PZEM-004T:
    // return pzem.power();
}
```

## License

MIT License - See main project LICENSE file.
