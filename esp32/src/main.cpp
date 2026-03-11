/**
 * IoT Attendance & Energy Monitoring System - ESP32 Firmware
 *
 * Hardware (choose one via USE_PZEM_004T):
 * - Option A (USE_PZEM_004T=0): ZMPT101B (voltage) + ACS724 (current) on ADC
 * - Option B (USE_PZEM_004T=1): PZEM-004T v3 over UART (voltage, current, power from module)
 *
 * Common:
 * - ESP32 Development Board
 * - MFRC522 RFID Reader (SPI)
 * - I2C 16x2 LCD Display
 *
 * ZMPT101B (when USE_PZEM_004T=0):
 *   - OUT  -> GPIO 34  (ADC1_CH6)
 * ACS724 (when USE_PZEM_004T=0):
 *   - OUT  -> GPIO 35  (ADC1_CH7)
 *
 * PZEM-004T (when USE_PZEM_004T=1):
 *   - ESP32 RX (e.g. GPIO 16) -> PZEM TX
 *   - ESP32 TX (e.g. GPIO 17) -> PZEM RX
 *   - GND -> PZEM GND
 */

// Set to 1 to use PZEM-004T instead of ZMPT101B + ACS724 (same backend contract: voltage, current, power)
#define USE_PZEM_004T 0

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#if USE_PZEM_004T
#include <MycilaPZEM.h>
#else
#include <ZMPT101B.h>
#endif

// ============== CONFIGURATION ==============
// WiFi Configuration
const char *WIFI_SSID = "PATAOD MOG INYO!";
const char *WIFI_PASSWORD = "WWW.CUPID.com_1223";

// WebSocket Server Configuration
const char *WS_HOST = "192.168.254.108";
const uint16_t WS_PORT = 8000;
const char *DEVICE_TOKEN = "ESP32-H3WV263437R";
const int CLASSROOM_ID = 1;

// Device Configuration
const char *DEVICE_ID = "ESP32-ROOM-01";

// NTP Configuration
const char *NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 8 * 3600;
const int DAYLIGHT_OFFSET_SEC = 0;

// Power Monitoring Calibration
#define AC_FREQUENCY 60              // AC line frequency in Hz (50Hz or 60Hz)
#define ZMPT101B_SENSITIVITY 483.50f // ZMPT101B sensitivity (calibrate with actual voltage)
#define CURRENT_SENSITIVITY 0.040f   // ACS724: 40mV per A
#define SAMPLES_PER_CYCLE 30         // Samples per AC cycle (reduced for faster loop)
#define MEASUREMENT_CYCLES 5         // Number of cycles (balanced: accuracy vs responsiveness)
#define NOMINAL_VOLTAGE 230.0        // Expected AC voltage (adjust for your region: 110V/220V/230V)
#define ADC_REFERENCE_VOLTAGE 3.3f   // ESP32 ADC reference voltage
#define ADC_RESOLUTION 4095.0f       // 12-bit ADC (0-4095)
#define ADD_AMPERE 0 //Plus/aditional  value to current reading

// ============== PIN DEFINITIONS ==============
#define RFID_SS_PIN 5
#define RFID_RST_PIN 27
#if USE_PZEM_004T
#define PZEM_RX_PIN 16  // ESP32 RX <- PZEM TX
#define PZEM_TX_PIN 17  // ESP32 TX -> PZEM RX
#else
#define VOLTAGE_SENSOR_PIN 34 // ZMPT101B - ADC1_CH6
#define CURRENT_SENSOR_PIN 35 // ACS724 - ADC1_CH7
#endif
#define LCD_ADDRESS 0x27
#define LCD_COLUMNS 16
#define LCD_ROWS 2

// Indicator pins for RFID scanning
#define LED_RED_PIN 26   // Red LED - Scanning mode active
#define LED_GREEN_PIN 33 // Green LED - Card detected/success
#define BUZZER_PIN 25    // Passive buzzer - Audio feedback

// Energy Conservation - Relay Control
#define RELAY_PIN 14 // 5V Relay - Controls 230V classroom lights
#define RFID_REINIT_DELAY_MS 1.5      // Delay after relay ON (EMI settle)
#define RFID_REINIT_DELAY_OFF_MS 2.5 // Longer delay after relay OFF (worse EMI/kickback)

// ============== REAL-TIME OPTIMIZATION ==============
// Reduced intervals for faster response
#define POWER_READ_INTERVAL 1000 // 1 second for real-time dashboard
#define RFID_READ_INTERVAL 50    // 50ms (was 100ms)
#define LCD_UPDATE_INTERVAL 100  // 100ms (was 1 second)
#define HEARTBEAT_INTERVAL 30000 // 30 seconds
#define WS_PING_INTERVAL 10000   // Ping every 10 seconds
#define RECONNECT_INTERVAL 2000  // Reconnect every 2 seconds

// Buffer sizes optimized for ESP32 memory
#define JSON_RFID_BUFFER 192
#define JSON_POWER_BUFFER 128
#define JSON_HEARTBEAT_BUFFER 96

// ============== GLOBAL OBJECTS ==============
WebSocketsClient webSocket;
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);
#if USE_PZEM_004T
Mycila::PZEM pzem;
float lastPzemVoltage = 0;
float lastPzemCurrent = 0;
float lastPzemPower = 0;
#else
ZMPT101B voltageSensor(VOLTAGE_SENSOR_PIN, AC_FREQUENCY);
#endif

// ============== STATE VARIABLES ==============
volatile bool wsConnected = false; // volatile for interrupt safety
volatile bool timeSync = false;
volatile bool rfidProcessing = false; // Prevent concurrent RFID processing
volatile bool scanMode = false;       // RFID scan mode for admin registration
volatile bool reinitRfidRequested = false;  // Defer reinit to main loop (avoid blocking in WS callback)
volatile bool reinitRfidAfterOff = false;   // true = use longer delay (relay OFF has worse EMI)
unsigned long scanModeStartTime = 0;
#define SCAN_MODE_TIMEOUT 30000 // 30 seconds timeout

unsigned long lastPowerRead = 0;
unsigned long lastRfidRead = 0;
unsigned long lastLcdUpdate = 0;
unsigned long lastReconnect = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastWsPing = 0;
unsigned long wsLastActivity = 0; // Track last WebSocket activity

// Pre-allocated strings to reduce heap fragmentation
String lastRfidUid = "";
float currentVoltage = 0.0;
float currentCurrent = 0.0;
float currentPower = 0.0;
String currentTeacher = "";
char statusMessage[17] = "Ready"; // Fixed buffer for LCD

// Current sensor calibration (runtime-updatable from backend; PZEM ignores sensitivity/quiescent)
float quiescentVoltage = 2.5;
float voltageSensitivity = ZMPT101B_SENSITIVITY;
float currentSensitivity = CURRENT_SENSITIVITY;
float nominalVoltage = NOMINAL_VOLTAGE;
float addAmpere = ADD_AMPERE;

// Relay state (for maintenance toggle)
bool lightsOn = false;

// JSON document pools (reuse to avoid allocation)
StaticJsonDocument<JSON_RFID_BUFFER> rfidDoc;
StaticJsonDocument<JSON_POWER_BUFFER> powerDoc;
StaticJsonDocument<JSON_HEARTBEAT_BUFFER> heartbeatDoc;

// ============== FUNCTION DECLARATIONS ==============
void setupWiFi();
void setupWebSocket();
void setupRFID();
void reinitRFID(bool afterRelayOff = false); // Re-initialize RFID; call from main loop only
void setupLCD();
void setupPowerMonitoring();
void setupNTP();
void setupIndicators();

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length);
void sendRfidData(const String &rfidUid);
void sendPowerData(float voltage, float current, float watts);
void sendHeartbeat();
void sendWsPing();
void checkWsConnection();

String readRFID();
float readRMSVoltage();
float readRMSCurrent();
float calculatePower();
#if USE_PZEM_004T
float readPowerFromPzem();
#endif
void updateLCD();
void displayMessage(const char *line1, const char *line2 = "");
String formatTime();
void processRFID();

// LED and Buzzer control
void setLED(int pin, bool state);
void blinkLED(int pin, int times, int delayMs);
void beep(int durationMs);
void beepPattern(int times, int onMs, int offMs);

// Relay control for lights
void setRelay(bool state);
void turnLightsOn();
void turnLightsOff();
void toggleLights();  // Maintenance mode - flip relay state

// Scan mode functions
void enterScanMode();
void exitScanMode();
void handleScanMode();
void sendScanResult(const String &rfidUid);
void sendCalibrationResult(float quiescentV);
void runZeroPointCalibration();

void handleTimeoutFinal();

// ============== SETUP ==============
void setup()
{
    Serial.begin(115200);
    Serial2.begin(19200, SERIAL_8N1, 16, 17);
    Serial.println("\n\n=== IoT Attendance & Energy Monitor ===");
    Serial.println("Optimized for Real-Time");

    // Initialize LCD first for user feedback
    setupLCD();
    displayMessage("Initializing...", "Please wait");

    // Setup components
    setupWiFi();
    setupNTP();
    setupRFID();
    setupPowerMonitoring();
    setupIndicators();
    setupWebSocket();

    displayMessage("System Ready", "Scan RFID Card");
    Serial.println("Setup complete!");
}

// ============== MAIN LOOP (OPTIMIZED) ==============
void loop()
{
    unsigned long currentMillis = millis();

    // 1. Handle WebSocket events FIRST (highest priority)
    webSocket.loop();

#if USE_PZEM_004T
    pzem.loop();  // Let PZEM async driver process UART
#endif

    // 1b. Perform deferred RFID reinit
    if (reinitRfidRequested)
    {
        reinitRfidRequested = false;
        bool afterOff = reinitRfidAfterOff;
        reinitRfidAfterOff = false;
        reinitRFID(afterOff);
    }

    // 2. Check WebSocket connection health
    if (wsConnected)
    {
        checkWsConnection();
    }

    // 3. Check RFID (non-blocking, faster interval)
    if (currentMillis - lastRfidRead >= RFID_READ_INTERVAL && !rfidProcessing)
    {
        lastRfidRead = currentMillis;

        // Handle scan mode separately
        if (scanMode)
        {
            handleScanMode();
        }
        else
        {
            processRFID();
        }
    }

    // 4. Send power data periodically
    if (currentMillis - lastPowerRead >= POWER_READ_INTERVAL)
    {
        lastPowerRead = currentMillis;

#if USE_PZEM_004T
        currentVoltage = readRMSVoltage();
        currentCurrent = readRMSCurrent();
        currentPower = readPowerFromPzem();  // Use PZEM active power when available
#else
        // Read voltage and current separately
        currentVoltage = readRMSVoltage();
        currentCurrent = readRMSCurrent();
        currentPower = currentVoltage * currentCurrent;
#endif

        if (wsConnected)
        {
            sendPowerData(currentVoltage, currentCurrent, currentPower);
        }
    }

    // 5. Update LCD (fast updates)
    if (currentMillis - lastLcdUpdate >= LCD_UPDATE_INTERVAL)
    {
        lastLcdUpdate = currentMillis;
        updateLCD();
    }

    // 6. Send heartbeat and ping
    if (wsConnected)
    {
        if (currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL)
        {
            lastHeartbeat = currentMillis;
            sendHeartbeat();
        }

        // Send WebSocket ping to keep connection alive
        if (currentMillis - lastWsPing >= WS_PING_INTERVAL)
        {
            lastWsPing = currentMillis;
            sendWsPing();
        }
    }

    // 7. Handle reconnection
    if (!wsConnected && currentMillis - lastReconnect >= RECONNECT_INTERVAL)
    {
        lastReconnect = currentMillis;
        Serial.println("Reconnecting WebSocket...");
        webSocket.disconnect();
        delay(10);
        setupWebSocket();
    }
}

// ============== RFID PROCESSING (OPTIMIZED) ==============
void processRFID()
{
    rfidProcessing = true;

    String rfidUid = readRFID();

    if (rfidUid.length() > 0 && rfidUid != lastRfidUid)
    {
        lastRfidUid = rfidUid;
        Serial.printf("RFID: %s\n", rfidUid.c_str());

        displayMessage("Card Detected!", rfidUid.c_str());

        if (wsConnected)
        {
            sendRfidData(rfidUid);
        }
        else
        {
            displayMessage("No Connection!", rfidUid.c_str());
        }

        // Short debounce delay
        delay(100);
        lastRfidUid = "";
    }

    rfidProcessing = false;
}

// ============== WIFI SETUP ==============
void setupWiFi()
{
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);

    displayMessage("Connecting WiFi", WIFI_SSID);

    // Disable WiFi power save for faster response
    WiFi.setSleep(false);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    // Faster connection attempt
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20)
    {
        delay(250);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.printf("\nWiFi Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        displayMessage("WiFi Connected", WiFi.localIP().toString().c_str());
        delay(500);
    }
    else
    {
        Serial.println("\nWiFi Failed!");
        displayMessage("WiFi Failed!", "Retrying...");
    }
}

// ============== WEBSOCKET SETUP (OPTIMIZED) ==============
void setupWebSocket()
{
    String wsPath = "/ws/iot/classroom/" + String(CLASSROOM_ID) + "/?token=" + String(DEVICE_TOKEN);

    Serial.printf("WS: ws://%s:%d%s\n", WS_HOST, WS_PORT, wsPath.c_str());

    // Configure WebSocket for low latency
    webSocket.setExtraHeaders("Origin: http://192.168.1.18:8000");
    webSocket.begin(WS_HOST, WS_PORT, wsPath.c_str());
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(RECONNECT_INTERVAL);

    // Enable heartbeat with shorter intervals
    webSocket.enableHeartbeat(15000, 3000, 2);
}

// ============== WEBSOCKET EVENT HANDLER ==============
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length)
{
    wsLastActivity = millis(); // Update last activity time

    switch (type)
    {
    case WStype_DISCONNECTED:
        Serial.println("WebSocket Disconnected!");
        wsConnected = false;
        strcpy(statusMessage, "Disconnected");
        break;

    case WStype_CONNECTED:
        Serial.println("WebSocket Connected!");
        wsConnected = true;
        strcpy(statusMessage, "Connected");
        displayMessage("WS Connected!", "Ready");
        break;

    case WStype_TEXT:
    {
        // Fast JSON parsing with minimal validation
        if (length > 0 && length < 512)
        {
            StaticJsonDocument<256> responseDoc;
            DeserializationError error = deserializeJson(responseDoc, payload, length);

            if (!error)
            {
                // Check for scan mode command
                const char *type = responseDoc["type"];
                if (type && strcmp(type, "start_scan") == 0)
                {
                    Serial.println("Received scan mode command");
                    enterScanMode();
                    break;
                }

                // Check for final timeout notification (daily auto-out from system)
                if (type && strcmp(type, "timeout_final") == 0)
                {
                    Serial.println("Received final timeout notification");
                    handleTimeoutFinal();
                    break;
                }

                // Check for calibration config from backend
                if (type && strcmp(type, "calibration_config") == 0)
                {
                    JsonObject cal = responseDoc["calibration"];
                    if (!cal.isNull())
                    {
                        if (cal.containsKey("nominal_voltage"))
                            nominalVoltage = cal["nominal_voltage"].as<float>();
                        if (cal.containsKey("add_ampere"))
                            addAmpere = cal["add_ampere"].as<float>();
#if !USE_PZEM_004T
                        if (cal.containsKey("voltage_sensitivity"))
                            voltageSensitivity = cal["voltage_sensitivity"].as<float>();
                        if (cal.containsKey("current_sensitivity"))
                            currentSensitivity = cal["current_sensitivity"].as<float>();
                        if (cal.containsKey("quiescent_voltage"))
                            quiescentVoltage = cal["quiescent_voltage"].as<float>();
                        voltageSensor.setSensitivity(voltageSensitivity);
                        Serial.printf("Calibration updated: Vsen=%.1f Csen=%.3f Q=%.3f\n",
                                      voltageSensitivity, currentSensitivity, quiescentVoltage);
#else
                        Serial.printf("Calibration updated (PZEM): nominal=%.1fV add=%.3fA\n",
                                      nominalVoltage, addAmpere);
#endif
                        displayMessage("Calibration", "Updated");
                    }
                    break;
                }

                // Check for calibrate_now command (no-op for PZEM; ZMPT/ACS724 run zero-point cal)
                if (type && strcmp(type, "calibrate_now") == 0)
                {
#if USE_PZEM_004T
                    Serial.println("Received calibrate_now - PZEM has no zero-point cal, sending ack");
                    displayMessage("PZEM", "No cal needed");
                    sendCalibrationResult(0.0f);  // Backend expects a result; 0 = N/A for PZEM
#else
                    Serial.println("Received calibrate_now - running zero-point calibration");
                    displayMessage("Calibrating...", "No load please");
                    runZeroPointCalibration();
#endif
                    break;
                }

                // Check for attendance response
                const char *event = responseDoc["event"];
                Serial.println("[Debug] Checking for attendance response");
                if (event)
                {
                    Serial.print("[Debug] Event found: ");
                    Serial.println(event);

                    // Debug: Print entire data object
                    if (responseDoc.containsKey("data"))
                    {
                        Serial.println("[Debug] Data object:");
                        serializeJsonPretty(responseDoc["data"], Serial);
                        Serial.println();
                    }

                    if (strcmp(event, "attendance_in") == 0)
                    {
                        Serial.println("[Debug] Processing attendance [IN]");
                        const char *teacher = responseDoc["data"]["teacher"];
                        if (teacher)
                        {
                            Serial.print("[DEBUG] Teacher extracted: ");
                            Serial.println(teacher);
                            currentTeacher = teacher;
                            displayMessage("Welcome!", teacher);
                            // Success feedback
                            feedbackPattern(LED_GREEN_PIN, 2, 50, 50);
                            // Turn ON classroom lights
                            turnLightsOn();
                        }
                        else
                        {
                            Serial.println("[DEBUG] WARNING: teacher field is NULL or missing!");
                        }
                    }
                    else if (strcmp(event, "attendance_out") == 0)
                    {
                        Serial.println("[Debug] Processing attendance [OUT]");
                        const char *teacher = responseDoc["data"]["teacher"];
                        if (teacher)
                        {
                            Serial.print("[DEBUG] Teacher checkout: ");
                            Serial.println(teacher);
                            displayMessage("Goodbye!", teacher);
                            currentTeacher = "";
                            // Checkout feedback - synchronized LED and buzzer
                            feedbackPattern(LED_GREEN_PIN, 3, 150, 150);
                            // Turn OFF classroom lights (no active teacher)
                            turnLightsOff();
                        }
                    }
                    else if (strcmp(event, "attendance_invalid") == 0)
                    {
                        displayMessage("Error!", "Invalid Sched.");
                        feedbackPattern(LED_RED_PIN, 3, 500, 500);
                    }
                    else if (strcmp(event, "attendance_error") == 0)
                    {
                        Serial.println("[Debug] Processing attendance [ERROR]");
                        const char *message = responseDoc["data"]["message"];
                        Serial.print("[DEBUG] Error message: ");
                        Serial.println(message ? message : "NULL");
                        displayMessage("Error!", message ? message : "Unknown");
                        feedbackPattern(LED_RED_PIN, 3, 500, 500);
                    }
                    else if (strcmp(event, "maintenance_toggle") == 0)
                    {
                        Serial.println("[Debug] Maintenance - toggle lights");
                        toggleLights();
                        displayMessage("Maintenance", lightsOn ? "Lights ON" : "Lights OFF");
                        feedbackPattern(LED_GREEN_PIN, 2, 100, 100);
                    }
                    else if (strcmp(event, "maintenance_blocked") == 0)
                    {
                        Serial.println("[Debug] Maintenance blocked - teacher present");
                        displayMessage("Blocked", "Teacher present");
                        feedbackPattern(LED_RED_PIN, 3, 400, 400);
                    }
                    else
                    {
                        Serial.print("[DEBUG] Unknown event type: ");
                        Serial.println(event);
                    }
                }
                else
                {
                    Serial.println("[Debug] No 'event' field in response");
                }
            }
        }
        break;
    }

    case WStype_PING:
        Serial.println("WebSocket PING received");
        break;

    case WStype_PONG:
        Serial.println("WebSocket PONG received");
        break;

    default:
        break;
    }
}

// ============== CHECK WEBSOCKET CONNECTION HEALTH ==============
void checkWsConnection()
{
    unsigned long currentMillis = millis();

    // If no activity for 30 seconds, consider connection dead
    if (currentMillis - wsLastActivity > 30000)
    {
        Serial.println("WebSocket connection appears dead, reconnecting...");
        wsConnected = false;
        webSocket.disconnect();
    }
}

// ============== DATA SENDING FUNCTIONS (OPTIMIZED) ==============
void sendRfidData(const String &rfidUid)
{
    // Reuse document to avoid allocation
    rfidDoc.clear();

    rfidDoc["device_id"] = DEVICE_ID;
    rfidDoc["rfid_uid"] = rfidUid;
    rfidDoc["voltage"] = currentVoltage;
    rfidDoc["current"] = currentCurrent;
    rfidDoc["power"] = currentPower;

    // Serialize directly to WebSocket buffer
    size_t len = measureJson(rfidDoc);
    char buffer[JSON_RFID_BUFFER];
    serializeJson(rfidDoc, buffer, sizeof(buffer));

    if (webSocket.sendTXT(buffer, len))
    {
        wsLastActivity = millis();
        displayMessage("Card Sent!", rfidUid.c_str());
    }
    else
    {
        Serial.println("Failed to send RFID data!");
        wsConnected = false;
    }
}

void sendPowerData(float voltage, float current, float watts)
{
    powerDoc.clear();

    powerDoc["device_id"] = DEVICE_ID;
    powerDoc["voltage"] = voltage;
    powerDoc["current"] = current;
    powerDoc["power"] = watts;

    char buffer[JSON_POWER_BUFFER];
    serializeJson(powerDoc, buffer, sizeof(buffer));

    if (webSocket.sendTXT(buffer))
    {
        wsLastActivity = millis();
    }
    else
    {
        Serial.println("Failed to send power data!");
        wsConnected = false;
    }
}

void sendHeartbeat()
{
    heartbeatDoc.clear();

    heartbeatDoc["device_id"] = DEVICE_ID;
    heartbeatDoc["type"] = "heartbeat";

    char buffer[JSON_HEARTBEAT_BUFFER];
    serializeJson(heartbeatDoc, buffer, sizeof(buffer));

    if (webSocket.sendTXT(buffer))
    {
        wsLastActivity = millis();
    }
    else
    {
        Serial.println("Failed to send heartbeat!");
        wsConnected = false;
    }
}

void sendWsPing()
{
    // Send JSON ping so server can reply with pong (keeps connection alive without triggering Invalid JSON)
    StaticJsonDocument<32> doc;
    doc["type"] = "ping";
    char buffer[32];
    size_t len = serializeJson(doc, buffer, sizeof(buffer));
    if (webSocket.sendTXT(buffer, len))
    {
        wsLastActivity = millis();
    }
    else
    {
        Serial.println("Failed to send ping!");
        wsConnected = false;
    }
}

// ============== NTP SETUP ==============
void setupNTP()
{
    Serial.println("Configuring NTP time...");

    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);

    // Wait with timeout
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

// ============== RFID SETUP ==============
void setupRFID()
{
    SPI.begin();
    rfid.PCD_Init();

    Serial.print("RFID Reader: ");
    rfid.PCD_DumpVersionToSerial();

    displayMessage("RFID Ready", "");
}

// Re-initialize RFID after relay trigger (fallback for RC522 lock/EMI)
// Must be called from main loop only - never from WebSocket callback
// Robust: hardware RST pulse, SPI reset, version verification, retries
void reinitRFID(bool afterRelayOff)
{
    const unsigned long emiDelay = afterRelayOff ? RFID_REINIT_DELAY_OFF_MS : RFID_REINIT_DELAY_MS;
    const int maxRetries = 3;

    // 1. Stop any active RC522 operations
    rfid.PCD_StopCrypto1();
    rfid.PICC_HaltA();

    // 2. Let EMI settle
    delay(emiDelay);

    for (int attempt = 0; attempt < maxRetries; attempt++)
    {
        // 3. Hardware reset via RST pin (full chip reset)
        pinMode(RFID_RST_PIN, OUTPUT);
        digitalWrite(RFID_RST_PIN, LOW);
        delay(10);
        digitalWrite(RFID_RST_PIN, HIGH);
        delay(10);

        // 4. Reset SPI bus
        SPI.end();
        delay(5);
        SPI.begin();

        // 5. Software init
        rfid.PCD_Init();

        // 6. Verify chip responded (0x91, 0x92 = MFRC522; 0x88 = FM17522 clone; 0x90 = older)
        byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
        if (version == 0x91 || version == 0x92 || version == 0x88 || version == 0x90)
        {
            Serial.println("RFID re-initialized (post-relay)");
            return;
        }

        Serial.printf("[RFID] Reinit attempt %d failed (version=0x%02X)\n", attempt + 1, version);
        delay(50);
    }

    Serial.println("[RFID] Reinit failed after retries");
}

// ============== RFID READ (OPTIMIZED) ==============
String readRFID()
{
    // Quick check for card presence
    if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial())
    {
        return "";
    }

    // Convert UID to hex string
    char uidBuffer[20];
    for (byte i = 0; i < rfid.uid.size; i++)
    {
        sprintf(uidBuffer + (i * 2), "%02X", rfid.uid.uidByte[i]);
    }

    // Stop quickly
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    return String(uidBuffer);
}

// ============== LCD SETUP ==============
void setupLCD()
{
    lcd.init();
    lcd.backlight();
    lcd.clear();

    Serial.println("LCD Initialized");
}

// ============== LCD FUNCTIONS ==============
void displayMessage(const char *line1, const char *line2)
{
    lcd.clear();

    // Center first line
    int len1 = min(strlen(line1), (size_t)LCD_COLUMNS);
    int pad1 = (LCD_COLUMNS - len1) / 2;
    lcd.setCursor(pad1, 0);
    lcd.print(line1);

    // Center second line
    if (line2)
    {
        int len2 = min(strlen(line2), (size_t)LCD_COLUMNS);
        int pad2 = (LCD_COLUMNS - len2) / 2;
        lcd.setCursor(pad2, 1);
        lcd.print(line2);
    }
}

void updateLCD()
{
    lcd.clear();

    // Line 1: Time + Status + Power
    char line1[17];
    String timeStr = formatTime();
    snprintf(line1, sizeof(line1), "%s %s %.0fW",
             timeStr.c_str(),
             wsConnected ? "ON" : "OFF",
             currentPower);
    lcd.setCursor(0, 0);
    lcd.print(line1);

    // Line 2: Teacher or default message
    lcd.setCursor(0, 1);
    if (currentTeacher.length() > 0)
    {
        lcd.print(currentTeacher.substring(0, LCD_COLUMNS));
    }
    else
    {
        lcd.print("Scan Here...");
    }
}

// ============== POWER MONITORING SETUP ==============
void setupPowerMonitoring()
{
#if USE_PZEM_004T
    Serial.println("Power monitoring: PZEM-004T (UART)");
    Serial.printf("PZEM RX=GPIO%d TX=GPIO%d\n", PZEM_RX_PIN, PZEM_TX_PIN);
    pzem.begin(Serial2, PZEM_RX_PIN, PZEM_TX_PIN, MYCILA_PZEM_ADDRESS_GENERAL, true);
    pzem.setCallback([](const Mycila::PZEM::EventType evt, const Mycila::PZEM::Data &data) {
        if (evt == Mycila::PZEM::EventType::EVT_READ) {
            if (!isnan(data.voltage))
                lastPzemVoltage = data.voltage;
            if (!isnan(data.current))
                lastPzemCurrent = data.current;
            if (!isnan(data.activePower))
                lastPzemPower = data.activePower;
        }
    });
    displayMessage("PZEM-004T", "Ready");
#else
    // Configure ADC for 12-bit resolution (0-4095)
    analogReadResolution(12);

    // Set attenuation for full 0-3.3V range
    analogSetAttenuation(ADC_11db);

    // Set ADC pins as input
    pinMode(VOLTAGE_SENSOR_PIN, INPUT);
    pinMode(CURRENT_SENSOR_PIN, INPUT);

    // Configure ZMPT101B voltage sensor (use runtime variable)
    voltageSensor.setSensitivity(voltageSensitivity);

    Serial.println("Power monitoring initialized");
    Serial.printf("Voltage sensor (ZMPT101B): GPIO %d @ %dHz\n", VOLTAGE_SENSOR_PIN, AC_FREQUENCY);
    Serial.printf("Voltage sensitivity: %.1f\n", voltageSensitivity);
    Serial.printf("Current sensor (ACS724): GPIO %d @ %.1fmV/A\n", CURRENT_SENSOR_PIN, currentSensitivity * 1000);

    // Calibrate current sensor zero point
    Serial.println("Calibrating current sensor zero point... (ensure no load)");
    displayMessage("Calibrating...", "No load please");
    delay(2000);

    float sum = 0;
    for (int i = 0; i < 50; i++)
    {
        sum += analogRead(CURRENT_SENSOR_PIN);
        delay(20);
    }

    float avgAdc = sum / 50.0;
    quiescentVoltage = (avgAdc / ADC_RESOLUTION) * ADC_REFERENCE_VOLTAGE;

    Serial.printf("Current sensor calibrated - Zero point: %.3fV (ADC: %.1f)\n", quiescentVoltage, avgAdc);
    Serial.println("Note: Calibrate voltage sensitivity with multimeter if needed");
#endif
}

// ============== ZERO-POINT CALIBRATION (REMOTE TRIGGER) ==============
#if !USE_PZEM_004T
void runZeroPointCalibration()
{
    delay(2000);
    float sum = 0;
    for (int i = 0; i < 50; i++)
    {
        sum += analogRead(CURRENT_SENSOR_PIN);
        delay(20);
    }
    float avgAdc = sum / 50.0;
    quiescentVoltage = (avgAdc / ADC_RESOLUTION) * ADC_REFERENCE_VOLTAGE;
    Serial.printf("Zero-point calibration done: quiescent=%.3fV\n", quiescentVoltage);
    char buf[8];
    snprintf(buf, sizeof(buf), "%.2fV", quiescentVoltage);
    displayMessage("Calibrated!", buf);
    sendCalibrationResult(quiescentVoltage);
}
#endif

void sendCalibrationResult(float quiescentV)
{
    StaticJsonDocument<96> doc;
    doc["type"] = "calibration_result";
    doc["quiescent_voltage"] = round(quiescentV * 1000) / 1000.0;
    char buffer[96];
    size_t len = serializeJson(doc, buffer, sizeof(buffer));
    if (webSocket.sendTXT(buffer, len))
    {
        wsLastActivity = millis();
        Serial.println("Sent calibration_result to backend");
    }
}

// ============== READ RMS VOLTAGE (ZMPT101B) / PZEM ==============
float readRMSVoltage()
{
#if USE_PZEM_004T
    float v = lastPzemVoltage;
    if (isnan(v) || v < 0)
        v = 0;
    if (v > nominalVoltage)
        v = nominalVoltage;
    return v;
#else
    // Use ZMPT101B library to read RMS voltage
    // Read 3 periods for more accurate measurement
    float voltage = voltageSensor.getRmsVoltage(3);

    // Debug: Show raw reading
    Serial.printf("[DEBUG VOLTAGE] Raw sensor reading: %.2fV\n", voltage);

    // Sanity checks
    if (voltage < 0)
    {
        Serial.println("[DEBUG VOLTAGE] Negative value detected, setting to 0");
        voltage = 0;
    }
    if (voltage > 300)
    {
        Serial.printf("[DEBUG VOLTAGE] Value %.2fV > 300V, capping to nominal (%.1fV)\n", voltage, nominalVoltage);
        voltage = nominalVoltage;
    }

    return voltage;
#endif
}

// ============== READ RMS CURRENT (ACS724) / PZEM ==============
float readRMSCurrent()
{
#if USE_PZEM_004T
    float c = lastPzemCurrent + addAmpere;
    if (isnan(c) || c < 0)
        c = 0;
    return c;
#else
    // Calculate sampling interval based on AC frequency
    // For 60Hz with 30 samples per cycle: 1,000,000 / 60 / 30 = 555.5 µs
    float sampleIntervalUs = (1000000.0 / AC_FREQUENCY) / SAMPLES_PER_CYCLE;
    int totalSamples = SAMPLES_PER_CYCLE * MEASUREMENT_CYCLES; // 30 * 5 = 150 samples

    float sumSquares = 0;

    // Take samples synchronized with AC frequency
    for (int i = 0; i < totalSamples; i++)
    {
        // Read ADC value (12-bit: 0-4095)
        int adcValue = analogRead(CURRENT_SENSOR_PIN);

        // Convert ADC to voltage (0-3.3V)
        float voltage = (adcValue / ADC_RESOLUTION) * ADC_REFERENCE_VOLTAGE;

        // Remove DC offset (quiescent voltage at zero current)
        float acVoltage = voltage - quiescentVoltage;

        // Square the AC voltage for RMS calculation
        sumSquares += acVoltage * acVoltage;

        // Wait for next sample (synchronized with AC frequency)
        delayMicroseconds(round(sampleIntervalUs));
    }

    // Calculate RMS voltage from sensor
    float meanSquare = sumSquares / totalSamples;
    float rmsVoltage = sqrt(meanSquare);

    // Convert RMS voltage to current using sensor sensitivity
    float current = rmsVoltage / currentSensitivity;

    // Debug output
    Serial.printf("[DEBUG CURRENT] ADC samples: %d, RMS voltage: %.3fV, Current: %.3fA\n",
                  totalSamples, rmsVoltage, current);

    // Sanity checks
    if (current < 0.01)
        current = 0; // Ignore noise below 10mA
    if (current > 50)
        current = 0; // Safety limit for ACS724 50A sensor

    return current + addAmpere;
#endif
}

#if USE_PZEM_004T
float readPowerFromPzem()
{
    float p = lastPzemPower;
    if (isnan(p) || p < 0)
        p = 0;
    return p;
}
#endif

// ============== CALCULATE REAL POWER ==============
float calculatePower()
{
    // Read voltage and current
    float voltage = readRMSVoltage();
    float current = readRMSCurrent();

    // Calculate apparent power (P = V × I)
    // Note: This assumes unity power factor (resistive load)
    // For reactive loads (motors, etc.), implement power factor correction
    float power = voltage * current;

    // Debug output for calibration
    Serial.printf("V: %.1fV, I: %.3fA, P: %.1fW\n", voltage, current, power);

    // Sanity checks
    if (power < 0)
        power = 0;
    if (power > 10000)
        power = 0; // Cap at 10kW for safety

    return power;
}

// Note: calculatePower is kept for backward compatibility,
// but main loop now calls readRMSVoltage() and readRMSCurrent() directly

// ============== UTILITY FUNCTIONS ==============
String formatTime()
{
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo))
    {
        return "--:--";
    }
    char buffer[6];
    sprintf(buffer, "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);
    return String(buffer);
}

// ============== LED AND BUZZER FUNCTIONS ==============
void setupIndicators()
{
    // Configure LED pins as outputs
    pinMode(LED_RED_PIN, OUTPUT);
    pinMode(LED_GREEN_PIN, OUTPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(RELAY_PIN, OUTPUT);

    // Initialize all off
    digitalWrite(LED_RED_PIN, LOW);
    digitalWrite(LED_GREEN_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(RELAY_PIN, LOW); // Lights OFF on startup (no active teacher)

    Serial.println("Indicators initialized (LED Red: GPIO26, Green: GPIO33, Buzzer: GPIO25)");
    Serial.printf("Relay initialized (Lights Control: GPIO%d) - Lights OFF\n", RELAY_PIN);

    // Power-on test: blink both LEDs and beep
    setLED(LED_RED_PIN, true);
    setLED(LED_GREEN_PIN, true);
    digitalWrite(RELAY_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(1000);
    setLED(LED_RED_PIN, false);
    setLED(LED_GREEN_PIN, false);
    digitalWrite(RELAY_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
}

void setLED(int pin, bool state)
{
    if (state)
    {
        digitalWrite(pin, HIGH);
    }
    else
    {
        digitalWrite(pin, LOW);
    }
}

void blinkLED(int pin, int times, int delayMs)
{
    for (int i = 0; i < times; i++)
    {
        digitalWrite(pin, HIGH);
        delay(delayMs);
        digitalWrite(pin, LOW);
        if (i < times - 1)
            delay(delayMs);
    }
}

void beepPassiveBuzzer(int durationMs)
{
    // For passive buzzer, generate a tone at ~2kHz
    int frequency = 2000;
    int period = 1000000 / frequency; // microseconds
    int cycles = (durationMs * 1000) / period;

    for (int i = 0; i < cycles; i++)
    {
        digitalWrite(BUZZER_PIN, HIGH);
        delayMicroseconds(period / 2);
        digitalWrite(BUZZER_PIN, LOW);
        delayMicroseconds(period / 2);
    }
}

void beep(int durationMs)
{
    // For ACTIVE buzzer - just turn it on/off
    digitalWrite(BUZZER_PIN, HIGH);
    blinkLED(LED_GREEN_PIN, 1, durationMs);
    delay(durationMs);
    digitalWrite(BUZZER_PIN, LOW);
}

void beepPattern(int times, int onMs, int offMs)
{
    for (int i = 0; i < times; i++)
    {
        beep(onMs);
        if (i < times - 1)
            delay(offMs);
    }
}

// Synchronized feedback
void feedbackPattern(int ledPin, int times, int onMs, int offMs)
{
    for (int i = 0; i < times; i++)
    {
        // Turn on both LED and buzzer simultaneously
        digitalWrite(ledPin, HIGH);
        digitalWrite(BUZZER_PIN, HIGH);
        delay(onMs);

        // Turn off both simultaneously
        digitalWrite(ledPin, LOW);
        digitalWrite(BUZZER_PIN, LOW);

        // Delay between patterns (except after last one)
        if (i < times - 1)
            delay(offMs);
    }
}

// ============== SCAN MODE FUNCTIONS ==============
void enterScanMode()
{
    Serial.println("Entering RFID scan mode...");
    scanMode = true;
    scanModeStartTime = millis();

    // Turn on red LED to indicate scanning mode
    setLED(LED_RED_PIN, true);
    setLED(LED_GREEN_PIN, false);

    // Beep twice to indicate scan mode active
    beepPattern(2, 100, 100);

    // Update LCD
    displayMessage("SCAN MODE", "Present tag now");

    Serial.println("Scan mode active - waiting for RFID tag...");
}

void exitScanMode()
{
    Serial.println("Exiting scan mode");
    scanMode = false;

    // Turn off red LED
    setLED(LED_RED_PIN, false);

    // Restore normal display
    displayMessage("System Ready", "Scan RFID Card");
}

void handleScanMode()
{
    rfidProcessing = true;

    // Check for timeout
    if (millis() - scanModeStartTime > SCAN_MODE_TIMEOUT)
    {
        Serial.println("Scan mode timeout");

        // Beep once (error/timeout)
        beep(500);

        // Send timeout message
        StaticJsonDocument<128> timeoutDoc;
        timeoutDoc["type"] = "scan_timeout";
        timeoutDoc["device_id"] = DEVICE_ID;

        char buffer[128];
        serializeJson(timeoutDoc, buffer);
        webSocket.sendTXT(buffer);

        exitScanMode();
        rfidProcessing = false;
        return;
    }

    // Try to read RFID
    String rfidUid = readRFID();

    if (rfidUid.length() > 0)
    {
        Serial.printf("RFID scanned in scan mode: %s\n", rfidUid.c_str());

        // Turn off red LED, turn on green LED
        setLED(LED_RED_PIN, false);
        setLED(LED_GREEN_PIN, true);

        // Success beep pattern (3 short beeps)
        beepPattern(3, 50, 50);

        // Display success
        displayMessage("Card Scanned!", rfidUid.c_str());

        // Send scan result
        sendScanResult(rfidUid);

        // Wait a bit before exiting
        delay(1000);

        // Turn off green LED
        setLED(LED_GREEN_PIN, false);

        exitScanMode();
    }

    rfidProcessing = false;
}

void sendScanResult(const String &rfidUid)
{
    StaticJsonDocument<192> scanDoc;

    scanDoc["type"] = "scan_result";
    scanDoc["device_id"] = DEVICE_ID;
    scanDoc["rfid_uid"] = rfidUid;
    scanDoc["timestamp"] = formatTime();

    char buffer[192];
    serializeJson(scanDoc, buffer);

    if (webSocket.sendTXT(buffer))
    {
        wsLastActivity = millis();
        Serial.println("Scan result sent successfully");
    }
    else
    {
        Serial.println("Failed to send scan result!");
    }
}

// Handle final timeout notification (daily auto-out or system-triggered session end)
void handleTimeoutFinal()
{
    Serial.println("Session timed out!");

    // Display timeout message
    displayMessage("TIMED OUT", "Session Ended");

    // Final notification: Red LED rapid blink (5 times)
    blinkLED(LED_RED_PIN, 5, 150);

    // Timeout sound: Three short beeps
    beepPattern(3, 100, 100);

    // Turn OFF classroom lights (no active teacher)
    turnLightsOff();

    // Clear current teacher
    currentTeacher = "";

    // Restore normal display after a moment
    delay(3000);
    displayMessage("System Ready", "Scan RFID Card");
}

// ============== RELAY CONTROL FUNCTIONS ==============
// Control relay for classroom lights (Energy Conservation)
// Reinit is deferred to main loop to avoid blocking/freeze in WebSocket callback
void setRelay(bool state)
{
    lightsOn = state;
    if (state)
    {
        // digitalWrite(RELAY_PIN, HIGH);
        Serial.println("Relay ON, LIGHTS ON");
        Serial.println("R1_ON");
    }
    else
    {
        // digitalWrite(RELAY_PIN, LOW);
        Serial.println("Relay OFF, LIGHTS OFF");
        Serial.println("R1_OFF");
    }

    reinitRfidRequested = true;
    reinitRfidAfterOff = !state; // Longer delay when turning OFF (worse EMI)
}

void toggleLights()
{
    lightsOn = !lightsOn;
    setRelay(lightsOn);
    Serial.println(lightsOn ? "[MAINT] Lights turned ON" : "[MAINT] Lights turned OFF");
}

void turnLightsOn()
{
    setRelay(true);
    Serial.println("[ENERGY] Classroom lights turned ON (Teacher Active)");
}

void turnLightsOff()
{
    setRelay(false);
    Serial.println("[ENERGY] Classroom lights turned OFF (No Active Teacher - Energy Saving)");
}