#include <Wire.h>
#include <time.h>

/**
 * IoT Attendance & Energy Monitoring System - ESP32 Firmware
 *
 * Hardware:
 * - ESP32 Development Board
 * - MFRC522 RFID Reader (SPI)
 * - I2C 16x2 LCD Display
 * - HC-SR04 Ultrasonic Sensor (temporary for power simulation)
 *
 * Wiring:
 * RFID RC522:
 *   - SDA  -> GPIO 5
 *   - SCK  -> GPIO 18
 *   - MOSI -> GPIO 23
 *   - MISO -> GPIO 19
 *   - RST  -> GPIO 27
 *   - 3.3V -> 3.3V
 *   - GND  -> GND
 *
 * I2C LCD (16x2):
 *   - SDA -> GPIO 21
 *   - SCL -> GPIO 22
 *   - VCC -> 5V
 *   - GND -> GND
 *
 * Ultrasonic HC-SR04:
 *   - TRIG -> GPIO 32
 *   - ECHO -> GPIO 33
 *   - VCC  -> 5V
 *   - GND  -> GND
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>

// ============== CONFIGURATION ==============
// WiFi Configuration
const char *WIFI_SSID = "2.4GHz-Band";
const char *WIFI_PASSWORD = "#2.4GHz-Band_21";

// WebSocket Server Configuration
const char *WS_HOST = "192.168.1.18"; // Your Django server IP
const uint16_t WS_PORT = 8000;
const char *DEVICE_TOKEN = "ESP32-H3WV263437R"; // From Django admin
const int CLASSROOM_ID = 1;                     // Your classroom ID

// Device Configuration
const char *DEVICE_ID = "ESP32-ROOM-01";

// NTP Configuration for Philippines Time (UTC+8)
const char *NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 8 * 3600; // UTC+8 for Philippines
const int DAYLIGHT_OFFSET_SEC = 0;    // No daylight saving in Philippines

// ============== PIN DEFINITIONS ==============
// RFID RC522 Pins
#define RFID_SS_PIN 5
#define RFID_RST_PIN 27

// Ultrasonic Sensor Pins
#define ULTRASONIC_TRIG 32
#define ULTRASONIC_ECHO 33

// I2C LCD Address (usually 0x27 or 0x3F)
#define LCD_ADDRESS 0x27
#define LCD_COLUMNS 16
#define LCD_ROWS 2

// ============== TIMING CONFIGURATION ==============
#define POWER_READ_INTERVAL 60000 // Send power reading every 60 seconds
#define RFID_READ_INTERVAL 100    // Check RFID every 100ms
#define LCD_UPDATE_INTERVAL 1000  // Update LCD every 1 second
#define RECONNECT_INTERVAL 5000   // Reconnect attempt every 5 seconds
#define HEARTBEAT_INTERVAL 30000  // Send heartbeat every 30 seconds

// ============== GLOBAL OBJECTS ==============
WebSocketsClient webSocket;
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
LiquidCrystal_I2C lcd(LCD_ADDRESS, LCD_COLUMNS, LCD_ROWS);

// ============== STATE VARIABLES ==============
bool wsConnected = false;
bool timeSync = false; // Track if time is synced with NTP
unsigned long lastPowerRead = 0;
unsigned long lastRfidRead = 0;
unsigned long lastLcdUpdate = 0;
unsigned long lastReconnect = 0;
unsigned long lastHeartbeat = 0;

String lastRfidUid = "";
float currentPower = 0.0;
String currentTeacher = "";
String statusMessage = "Ready";

// ============== FUNCTION DECLARATIONS ==============
void setupWiFi();
void setupWebSocket();
void setupRFID();
void setupLCD();
void setupUltrasonic();
void setupNTP();
bool isTimeSynced();

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length);
void sendRfidData(String rfidUid);
void sendPowerData(float watts);
void sendHeartbeat();

String readRFID();
float readUltrasonicPower();
void updateLCD();
void displayMessage(String line1, String line2 = "");
String formatTime();

// ============== SETUP ==============
void setup()
{
    Serial.begin(115200);
    Serial.println("\n\n=== IoT Attendance & Energy Monitor ===");
    Serial.println("Initializing...");

    // Initialize components
    setupLCD();
    displayMessage("Initializing...", "Please wait");

    setupWiFi();
    setupNTP(); // Sync time with NTP after WiFi is connected
    setupRFID();
    setupUltrasonic();
    setupWebSocket();

    displayMessage("System Ready", "Scan RFID Card");
    Serial.println("Setup complete!");
}

// ============== MAIN LOOP ==============
void loop()
{
    // Handle WebSocket communication
    webSocket.loop();

    unsigned long currentMillis = millis();

    // Check RFID
    if (currentMillis - lastRfidRead >= RFID_READ_INTERVAL)
    {
        lastRfidRead = currentMillis;
        String rfidUid = readRFID();

        if (rfidUid.length() > 0 && rfidUid != lastRfidUid)
        {
            lastRfidUid = rfidUid;
            Serial.println("RFID Detected: " + rfidUid);

            displayMessage("Card Detected!", rfidUid);

            if (wsConnected)
            {
                sendRfidData(rfidUid);
            }
            else
            {
                displayMessage("No Connection!", "Card: " + rfidUid);
            }

            delay(2000);      // Prevent multiple reads
            lastRfidUid = ""; // Reset for next card
        }
    }

    // Send power reading periodically
    if (currentMillis - lastPowerRead >= POWER_READ_INTERVAL)
    {
        lastPowerRead = currentMillis;
        currentPower = readUltrasonicPower();

        Serial.print("Power Reading: ");
        Serial.print(currentPower);
        Serial.println(" W");

        if (wsConnected)
        {
            sendPowerData(currentPower);
        }
    }

    // Update LCD display
    if (currentMillis - lastLcdUpdate >= LCD_UPDATE_INTERVAL)
    {
        lastLcdUpdate = currentMillis;
        updateLCD();
    }

    // Send heartbeat
    if (wsConnected && currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL)
    {
        lastHeartbeat = currentMillis;
        sendHeartbeat();
    }

    // Attempt reconnection if disconnected
    if (!wsConnected && currentMillis - lastReconnect >= RECONNECT_INTERVAL)
    {
        lastReconnect = currentMillis;
        Serial.println("Attempting to reconnect WebSocket...");
        webSocket.disconnect();
        setupWebSocket();
    }
}

// ============== WIFI SETUP ==============
void setupWiFi()
{
    Serial.print("Connecting to WiFi: ");
    Serial.println(WIFI_SSID);

    displayMessage("Connecting WiFi", WIFI_SSID);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30)
    {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.println("\nWiFi Connected!");
        Serial.print("IP Address: ");
        Serial.println(WiFi.localIP());
        displayMessage("WiFi Connected", WiFi.localIP().toString());
        delay(1000);
    }
    else
    {
        Serial.println("\nWiFi Connection Failed!");
        displayMessage("WiFi Failed!", "Check settings");
        delay(2000);
    }
}

// ============== WEBSOCKET SETUP ==============
void setupWebSocket()
{
    // Build WebSocket path with token
    String wsPath = "/ws/iot/classroom/" + String(CLASSROOM_ID) + "/?token=" + String(DEVICE_TOKEN);

    Serial.print("Connecting to WebSocket: ws://");
    Serial.print(WS_HOST);
    Serial.print(":");
    Serial.print(WS_PORT);
    Serial.println(wsPath);

    // Important: Set extra headers that Django Channels expects
    webSocket.setExtraHeaders("Origin: http://192.168.1.18:8000");

    webSocket.begin(WS_HOST, WS_PORT, wsPath.c_str());
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(RECONNECT_INTERVAL);

    // Disable the built-in heartbeat - it can interfere with some servers
    // webSocket.enableHeartbeat(15000, 3000, 2);
}

// ============== WEBSOCKET EVENT HANDLER ==============
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length)
{
    switch (type)
    {
    case WStype_DISCONNECTED:
        Serial.println("WebSocket Disconnected!");
        wsConnected = false;
        statusMessage = "Disconnected";
        break;

    case WStype_CONNECTED:
        Serial.println("WebSocket Connected!");
        wsConnected = true;
        statusMessage = "Connected";
        displayMessage("WS Connected!", "Ready to scan");

        // Send initial power reading
        currentPower = readUltrasonicPower();
        sendPowerData(currentPower);
        break;

    case WStype_TEXT:
    {
        Serial.print("Received: ");
        Serial.println((char *)payload);

        // Parse JSON response
        StaticJsonDocument<512> doc;
        DeserializationError error = deserializeJson(doc, payload, length);

        if (!error)
        {
            const char *status = doc["status"];
            if (status && strcmp(status, "ok") == 0)
            {
                Serial.println("Server acknowledged");
            }

            // Handle attendance response
            if (doc.containsKey("event"))
            {
                const char *event = doc["event"];
                if (strcmp(event, "attendance_in") == 0)
                {
                    const char *teacher = doc["data"]["teacher"];
                    if (teacher)
                    {
                        currentTeacher = String(teacher);
                        displayMessage("Welcome!", currentTeacher.substring(0, 16));
                    }
                }
                else if (strcmp(event, "attendance_error") == 0)
                {
                    const char *message = doc["data"]["message"];
                    displayMessage("Error!", message ? message : "Unknown");
                }
            }
        }
        break;
    }

    case WStype_BIN:
        Serial.println("Binary data received (ignored)");
        break;

    case WStype_ERROR:
        Serial.println("WebSocket Error!");
        wsConnected = false;
        break;

    case WStype_PING:
        Serial.println("Ping received");
        break;

    case WStype_PONG:
        Serial.println("Pong received");
        break;

    default:
        break;
    }
}

// ============== SEND RFID DATA ==============
void sendRfidData(String rfidUid)
{
    StaticJsonDocument<256> doc;

    doc["device_id"] = DEVICE_ID;
    doc["rfid_uid"] = rfidUid;
    doc["power"] = currentPower;
    // No timestamp needed - server uses auto_now_add for time_in

    String jsonString;
    serializeJson(doc, jsonString);

    Serial.print("Sending RFID data: ");
    Serial.println(jsonString);

    webSocket.sendTXT(jsonString);

    displayMessage("Card Sent!", rfidUid.substring(0, 16));
}

// ============== SEND POWER DATA ==============
void sendPowerData(float watts)
{
    StaticJsonDocument<256> doc;

    doc["device_id"] = DEVICE_ID;
    doc["power"] = watts;
    // No timestamp needed - server uses auto_now_add

    String jsonString;
    serializeJson(doc, jsonString);

    Serial.print("Sending power data: ");
    Serial.println(jsonString);

    webSocket.sendTXT(jsonString);
}

// ============== SEND HEARTBEAT ==============
void sendHeartbeat()
{
    StaticJsonDocument<128> doc;

    doc["device_id"] = DEVICE_ID;
    doc["type"] = "heartbeat";
    // No timestamp needed

    String jsonString;
    serializeJson(doc, jsonString);

    webSocket.sendTXT(jsonString);
}

// ============== GET ISO TIMESTAMP ==============
String getISOTimestamp()
{
    struct tm timeinfo;
    if (!getLocalTime(&timeinfo))
    {
        Serial.println("Failed to obtain time, using fallback");
        // Return empty string to let server use its own time
        return "";
    }

    // Format as ISO 8601 with timezone offset for Philippines (UTC+8)
    char timestamp[30];
    sprintf(timestamp, "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
            timeinfo.tm_year + 1900,
            timeinfo.tm_mon + 1,
            timeinfo.tm_mday,
            timeinfo.tm_hour,
            timeinfo.tm_min,
            timeinfo.tm_sec);
    return String(timestamp);
}

// ============== NTP SETUP ==============
void setupNTP()
{
    Serial.println("Configuring NTP time...");
    displayMessage("Syncing Time...", "");

    configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);

    // Wait for time to be set (max 10 seconds)
    struct tm timeinfo;
    int attempts = 0;
    while (!getLocalTime(&timeinfo) && attempts < 10)
    {
        Serial.println("Waiting for NTP time sync...");
        delay(1000);
        attempts++;
    }

    if (getLocalTime(&timeinfo))
    {
        timeSync = true;
        Serial.println("NTP Time synchronized!");
        Serial.printf("Current time: %04d-%02d-%02d %02d:%02d:%02d\n",
                      timeinfo.tm_year + 1900,
                      timeinfo.tm_mon + 1,
                      timeinfo.tm_mday,
                      timeinfo.tm_hour,
                      timeinfo.tm_min,
                      timeinfo.tm_sec);
        displayMessage("Time Synced!", "");
    }
    else
    {
        timeSync = false;
        Serial.println("WARNING: Could not sync time with NTP");
        displayMessage("Time Sync Fail", "Using server time");
    }
    delay(500);
}

bool isTimeSynced()
{
    return timeSync;
}

// ============== RFID SETUP & READ ==============
void setupRFID()
{
    SPI.begin();
    rfid.PCD_Init();

    Serial.print("RFID Reader: ");
    rfid.PCD_DumpVersionToSerial();

    displayMessage("RFID Ready", "");
}

String readRFID()
{
    // Check for new card
    if (!rfid.PICC_IsNewCardPresent())
    {
        return "";
    }

    // Read card serial
    if (!rfid.PICC_ReadCardSerial())
    {
        return "";
    }

    // Convert UID to string
    String uidString = "";
    for (byte i = 0; i < rfid.uid.size; i++)
    {
        if (rfid.uid.uidByte[i] < 0x10)
        {
            uidString += "0";
        }
        uidString += String(rfid.uid.uidByte[i], HEX);
    }
    uidString.toUpperCase();

    // Halt PICC and stop encryption
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();

    return uidString;
}

// ============== LCD SETUP & UPDATE ==============
void setupLCD()
{
    lcd.init();
    lcd.backlight();
    lcd.clear();

    Serial.println("LCD Initialized");
}

void displayMessage(String line1, String line2)
{
    lcd.clear();

    // Center line 1
    int pad1 = (LCD_COLUMNS - line1.length()) / 2;
    if (pad1 < 0)
        pad1 = 0;
    lcd.setCursor(pad1, 0);
    lcd.print(line1.substring(0, LCD_COLUMNS));

    // Center line 2
    int pad2 = (LCD_COLUMNS - line2.length()) / 2;
    if (pad2 < 0)
        pad2 = 0;
    lcd.setCursor(pad2, 1);
    lcd.print(line2.substring(0, LCD_COLUMNS));
}

void updateLCD()
{
    lcd.clear();

    // Line 1: Time, Status and Power
    String line1 = formatTime();
    line1 += wsConnected ? " ON " : " OFF";
    line1 += String(currentPower, 0) + "W";
    lcd.setCursor(0, 0);
    lcd.print(line1.substring(0, LCD_COLUMNS));

    // Line 2: Current teacher or ready message
    lcd.setCursor(0, 1);
    if (currentTeacher.length() > 0)
    {
        lcd.print(currentTeacher.substring(0, LCD_COLUMNS));
    }
    else
    {
        lcd.print("Scan RFID Card");
    }
}

// ============== ULTRASONIC SENSOR (POWER SIMULATION) ==============
void setupUltrasonic()
{
    pinMode(ULTRASONIC_TRIG, OUTPUT);
    pinMode(ULTRASONIC_ECHO, INPUT);

    Serial.println("Ultrasonic sensor initialized");
}

float readUltrasonicPower()
{
    // Send ultrasonic pulse
    digitalWrite(ULTRASONIC_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(ULTRASONIC_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(ULTRASONIC_TRIG, LOW);

    // Read echo duration
    long duration = pulseIn(ULTRASONIC_ECHO, HIGH, 30000); // 30ms timeout

    // Convert to distance (cm)
    float distance = duration * 0.034 / 2;

    // Simulate power based on distance (0-400cm -> 0-1000W)
    // This is just for testing - replace with actual power meter later
    float simulatedPower = 0;
    if (distance > 0 && distance < 400)
    {
        // myMap distance to power: closer = higher power
        simulatedPower = myMap(distance, 0, 400, 1000, 0);
        // Add some random variation
        simulatedPower += random(-20, 20);
        if (simulatedPower < 0)
            simulatedPower = 0;
    }
    else
    {
        // If no reading, return a base load value
        simulatedPower = 50 + random(0, 30);
    }

    return simulatedPower;
}

// ============== UTILITY FUNCTIONS ==============
long myMap(long x, long in_min, long in_max, long out_min, long out_max)
{
    return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

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
