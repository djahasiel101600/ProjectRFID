/**
 * Dummy ESP32 Firmware - IoT Attendance & Energy Monitoring Simulator
 *
 * Simulates the real ESP32 device without any physical sensors or RFID
 * hardware. All configuration is done via a built-in web portal, and
 * RFID scans are triggered from that same portal.
 *
 * Boot behavior:
 *   - Hold BOOT button (GPIO0) on power-on  → Config AP mode
 *   - No saved WiFi SSID in NVS             → Config AP mode
 *   - Otherwise                             → Connect to WiFi + runtime portal
 *
 * Config AP:      SSID "DummyESP-Setup" (open), IP 192.168.4.1
 * Runtime portal: http://dummyesp.local  (or http://<device-IP>  port 80)
 *
 * WebSocket message contracts (identical to real firmware):
 *   Power : { "device_id", "voltage", "current", "power" }
 *   RFID  : { "device_id", "rfid_uid", "voltage", "current", "power" }
 *   Ping  : { "type": "ping" }
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ─── GPIO ─────────────────────────────────────────────────────────────────────
#define BOOT_BUTTON_PIN 0 // Hold LOW on power-on to force Config AP mode

// ─── Timing ───────────────────────────────────────────────────────────────────
#define POWER_INTERVAL 1000     // ms between power frames
#define PING_INTERVAL 10000     // ms between ping keepalives
#define RECONNECT_INTERVAL 2000 // ms between reconnect attempts
#define WIFI_TIMEOUT 30000      // ms to wait for WiFi before falling back to AP

// ─── Simulated power values ───────────────────────────────────────────────────
#define BASE_WATTS_IDLE 20.0f    // standby: no teacher, lights off
#define BASE_WATTS_ACTIVE 150.0f // active: teacher present, lights + equipment
#define NOISE_AMPLITUDE 5.0f     // ±5 W random noise per tick
#define NOMINAL_VOLTAGE 230.0f   // fixed AC voltage

// ─── Global objects ───────────────────────────────────────────────────────────
Preferences prefs;
WebServer server(80);
DNSServer dns;
WebSocketsClient webSocket;

// ─── Config (persisted in NVS) ────────────────────────────────────────────────
struct Config
{
    String ssid;
    String password;
    String wsHost;
    uint16_t wsPort;
    String deviceToken;
    int classroomId;
    String deviceId;
} cfg;

// ─── Runtime state ────────────────────────────────────────────────────────────
bool apMode = false;
bool wsConnected = false;
bool teacherPresent = false;
float currentV = NOMINAL_VOLTAGE;
float currentI = 0.09f;
float currentW = BASE_WATTS_IDLE;
String lastServerMsg = "—";

unsigned long lastPowerTick = 0;
unsigned long lastPingTick = 0;
unsigned long lastReconnect = 0;
unsigned long wsLastActivity = 0;

// Reusable JSON documents (avoids repeated heap allocation)
JsonDocument powerDoc;
JsonDocument rfidDoc;
JsonDocument pingDoc;

// ─── Forward declarations ─────────────────────────────────────────────────────
void loadConfig();
void saveConfig();
void clearConfig();
bool bootButtonHeld();
void startConfigAP();
void startRunning();
void connectWebSocket();
void registerAPRoutes();
void registerRunningRoutes();
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length);
void updateSimulatedPower();
void sendPowerFrame();
void sendRfidFrame(const String &uid);
void sendPingFrame();
String pageWrap(const String &title, const String &body);
String configFormHtml();
String dashboardHtml();

// ═══════════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════════
void setup()
{
    Serial.begin(115200);
    delay(200);
    Serial.println("\n=== Dummy ESP32 Firmware ===");

    pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
    randomSeed(analogRead(36));

    loadConfig();

    if (bootButtonHeld() || cfg.ssid.isEmpty())
    {
        Serial.println("[BOOT] No config or BOOT held → Config AP mode");
        startConfigAP();
    }
    else
    {
        Serial.println("[BOOT] Config found → Running mode");
        startRunning();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════════
void loop()
{
    unsigned long now = millis();

    if (apMode)
    {
        dns.processNextRequest();
        server.handleClient();
        return;
    }

    // Running mode ─────────────────────────────────────────────────────────────
    webSocket.loop();
    server.handleClient();

    // Power frame
    if (now - lastPowerTick >= POWER_INTERVAL)
    {
        lastPowerTick = now;
        updateSimulatedPower();
        if (wsConnected)
            sendPowerFrame();
    }

    // Ping keepalive
    if (now - lastPingTick >= PING_INTERVAL)
    {
        lastPingTick = now;
        if (wsConnected)
            sendPingFrame();
    }

    // Reconnect guard
    if (!wsConnected && now - lastReconnect >= RECONNECT_INTERVAL)
    {
        lastReconnect = now;
        Serial.println("[WS] Reconnecting...");
        webSocket.disconnect();
        delay(10);
        connectWebSocket();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NVS CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
void loadConfig()
{
    prefs.begin("dummy-cfg", true);
    cfg.ssid = prefs.getString("ssid", "dummy-device");
    cfg.password = prefs.getString("password", "12345678");
    cfg.wsHost = prefs.getString("ws_host", "192.168.254.108");
    cfg.wsPort = (uint16_t)prefs.getInt("ws_port", 8000);
    cfg.deviceToken = prefs.getString("device_token", "ESP32-H3WV263437R");
    cfg.classroomId = prefs.getInt("classroom_id", 1);
    cfg.deviceId = prefs.getString("device_id", "ESP32-ROOM-01");
    prefs.end();
    Serial.printf("[CFG] ssid=%s host=%s port=%d cid=%d devid=%s\n",
                  cfg.ssid.c_str(), cfg.wsHost.c_str(),
                  cfg.wsPort, cfg.classroomId, cfg.deviceId.c_str());
}

void saveConfig()
{
    prefs.begin("dummy-cfg", false);
    prefs.putString("ssid", cfg.ssid);
    prefs.putString("password", cfg.password);
    prefs.putString("ws_host", cfg.wsHost);
    prefs.putInt("ws_port", cfg.wsPort);
    prefs.putString("device_token", cfg.deviceToken);
    prefs.putInt("classroom_id", cfg.classroomId);
    prefs.putString("device_id", cfg.deviceId);
    prefs.end();
    Serial.println("[CFG] Saved to NVS");
}

void clearConfig()
{
    prefs.begin("dummy-cfg", false);
    prefs.clear();
    prefs.end();
    Serial.println("[CFG] NVS cleared");
}

bool bootButtonHeld()
{
    // Confirm intentional hold (sample 10 times over 50 ms)
    int low = 0;
    for (int i = 0; i < 10; i++)
    {
        if (digitalRead(BOOT_BUTTON_PIN) == LOW)
            low++;
        delay(5);
    }
    return low >= 8;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG AP MODE
// ═══════════════════════════════════════════════════════════════════════════════
void startConfigAP()
{
    apMode = true;
    WiFi.mode(WIFI_AP);
    WiFi.softAP("DummyESP-Setup"); // open AP, no password
    Serial.printf("[AP] SSID: DummyESP-Setup  IP: %s\n",
                  WiFi.softAPIP().toString().c_str());

    // Captive portal: redirect all DNS queries to self
    dns.start(53, "*", WiFi.softAPIP());

    registerAPRoutes();
    server.begin();
    Serial.println("[AP] Web server started — connect to DummyESP-Setup then open 192.168.4.1");
}

void registerAPRoutes()
{
    // Main config form
    server.on("/", HTTP_GET, []()
              { server.send(200, "text/html", configFormHtml()); });

    // Captive portal detection endpoints (Android, iOS, Windows)
    auto redirect = []()
    {
        server.sendHeader("Location", "http://192.168.4.1/");
        server.send(302);
    };
    server.on("/generate_204", HTTP_GET, redirect);
    server.on("/hotspot-detect.html", HTTP_GET, redirect);
    server.on("/fwlink", HTTP_GET, redirect);
    server.on("/ncsi.txt", HTTP_GET, redirect);
    server.on("/connecttest.txt", HTTP_GET, redirect);

    // Save config → reboot
    server.on("/config", HTTP_POST, []()
              {
        if (server.hasArg("ssid"))         cfg.ssid        = server.arg("ssid");
        if (server.hasArg("password"))     cfg.password    = server.arg("password");
        if (server.hasArg("ws_host"))      cfg.wsHost      = server.arg("ws_host");
        if (server.hasArg("ws_port"))      cfg.wsPort      = (uint16_t)server.arg("ws_port").toInt();
        if (server.hasArg("device_token")) cfg.deviceToken = server.arg("device_token");
        if (server.hasArg("classroom_id")) cfg.classroomId = server.arg("classroom_id").toInt();
        if (server.hasArg("device_id"))    cfg.deviceId    = server.arg("device_id");
        saveConfig();
        server.send(200, "text/html",
            pageWrap("Saved",
                "<div class='card'><h2>&#10003; Saved!</h2>"
                "<p>Rebooting in 2 seconds…</p></div>"
                "<script>setTimeout(()=>window.location='/',5000)</script>"));
        delay(2000);
        ESP.restart(); });

    // Catch-all → redirect to root
    server.onNotFound([]()
                      {
        server.sendHeader("Location", "http://192.168.4.1/");
        server.send(302); });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RUNNING MODE
// ═══════════════════════════════════════════════════════════════════════════════
void startRunning()
{
    apMode = false;
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(cfg.ssid.c_str(), cfg.password.c_str());

    Serial.printf("[WiFi] Connecting to \"%s\"", cfg.ssid.c_str());
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < WIFI_TIMEOUT)
    {
        delay(250);
        Serial.print(".");
    }
    Serial.println();

    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println("[WiFi] Failed — falling back to Config AP");
        startConfigAP();
        return;
    }

    Serial.printf("[WiFi] Connected  IP: %s\n", WiFi.localIP().toString().c_str());

    connectWebSocket();
    registerRunningRoutes();
    server.begin();
    if (MDNS.begin("dummyesp"))
    {
        MDNS.addService("http", "tcp", 80);
        Serial.println("[mDNS] http://dummyesp.local");
    }
    else
    {
        Serial.println("[mDNS] Failed to start");
    }
    Serial.printf("[HTTP] Portal → http://dummyesp.local  (or http://%s)\n", WiFi.localIP().toString().c_str());
}

void connectWebSocket()
{
    String path = "/ws/iot/classroom/" + String(cfg.classroomId) +
                  "/?token=" + cfg.deviceToken;
    Serial.printf("[WS] ws://%s:%d%s\n", cfg.wsHost.c_str(), cfg.wsPort, path.c_str());
    webSocket.setExtraHeaders("Origin: http://192.168.1.1:8000");
    webSocket.begin(cfg.wsHost.c_str(), cfg.wsPort, path.c_str());
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(RECONNECT_INTERVAL);
}

void registerRunningRoutes()
{
    // ── GET /  →  runtime dashboard ──────────────────────────────────────────
    server.on("/", HTTP_GET, []()
              { server.send(200, "text/html", dashboardHtml()); });

    // ── GET /status  →  JSON status (polled every 2 s by dashboard JS) ───────
    server.on("/status", HTTP_GET, []()
              {
        // Build JSON manually to avoid allocation overhead on every poll
        char buf[256];
        snprintf(buf, sizeof(buf),
            "{\"ws_connected\":%s,\"teacher_present\":%s,"
            "\"voltage\":%.1f,\"current\":%.4f,\"power\":%.1f,"
            "\"last_server_msg\":\"%s\"}",
            wsConnected    ? "true" : "false",
            teacherPresent ? "true" : "false",
            currentV, currentI, currentW,
            lastServerMsg.c_str());
        server.send(200, "application/json", buf); });

    // ── POST /teacher  →  toggle teacher presence ─────────────────────────────
    server.on("/teacher", HTTP_POST, []()
              {
        if (server.hasArg("state")) {
            teacherPresent = server.arg("state").toInt() != 0;
            Serial.printf("[PORTAL] teacherPresent → %s\n",
                          teacherPresent ? "true" : "false");
        }
        server.sendHeader("Location", "/");
        server.send(302); });

    // ── POST /rfid  →  send RFID frame to backend ─────────────────────────────
    server.on("/rfid", HTTP_POST, []()
              {
        if (server.hasArg("uid")) {
            String uid = server.arg("uid");
            uid.trim();
            uid.toUpperCase();
            if (uid.length() > 0) {
                if (wsConnected) {
                    sendRfidFrame(uid);
                } else {
                    lastServerMsg = "Not connected — scan ignored";
                    Serial.println("[PORTAL] WS not connected, scan ignored");
                }
            }
        }
        server.sendHeader("Location", "/");
        server.send(302); });

    // ── GET /config  →  pre-filled config edit form ───────────────────────────
    server.on("/config", HTTP_GET, []()
              { server.send(200, "text/html", configFormHtml()); });

    // ── POST /config  →  save config → reboot ────────────────────────────────
    server.on("/config", HTTP_POST, []()
              {
        if (server.hasArg("ssid"))         cfg.ssid        = server.arg("ssid");
        if (server.hasArg("password"))     cfg.password    = server.arg("password");
        if (server.hasArg("ws_host"))      cfg.wsHost      = server.arg("ws_host");
        if (server.hasArg("ws_port"))      cfg.wsPort      = (uint16_t)server.arg("ws_port").toInt();
        if (server.hasArg("device_token")) cfg.deviceToken = server.arg("device_token");
        if (server.hasArg("classroom_id")) cfg.classroomId = server.arg("classroom_id").toInt();
        if (server.hasArg("device_id"))    cfg.deviceId    = server.arg("device_id");
        saveConfig();
        server.send(200, "text/html",
            pageWrap("Saved",
                "<div class='card'><h2>&#10003; Saved!</h2>"
                "<p>Rebooting in 2 seconds…</p></div>"
                "<script>setTimeout(()=>window.location='/',5000)</script>"));
        delay(2000);
        ESP.restart(); });

    // ── POST /reset  →  clear NVS → reboot into AP ───────────────────────────
    server.on("/reset", HTTP_POST, []()
              {
        server.send(200, "text/html",
            pageWrap("Reset",
                "<div class='card'><h2>Config cleared</h2>"
                "<p>Rebooting into setup mode…</p></div>"));
        delay(1500);
        clearConfig();
        ESP.restart(); });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WEBSOCKET EVENT HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length)
{
    wsLastActivity = millis();

    switch (type)
    {
    case WStype_DISCONNECTED:
        Serial.println("[WS] Disconnected");
        wsConnected = false;
        break;

    case WStype_CONNECTED:
        Serial.println("[WS] Connected to backend");
        wsConnected = true;
        lastServerMsg = "connected";
        break;

    case WStype_TEXT:
    {
        if (!payload || length == 0)
            break;
        Serial.printf("[WS] RX: %.*s\n", (int)length, (char *)payload);

        JsonDocument doc;
        if (deserializeJson(doc, payload, length) != DeserializationError::Ok)
            break;

        const char *event = doc["event"];
        const char *msgType = doc["type"];

        if (event)
        {
            if (strcmp(event, "attendance_in") == 0)
            {
                const char *teacher = doc["data"]["teacher"];
                teacherPresent = true;
                lastServerMsg = "attendance_in";
                if (teacher)
                    lastServerMsg += String(" → ") + teacher;
            }
            else if (strcmp(event, "attendance_out") == 0)
            {
                const char *teacher = doc["data"]["teacher"];
                teacherPresent = false;
                lastServerMsg = "attendance_out";
                if (teacher)
                    lastServerMsg += String(" → ") + teacher;
            }
            else if (strcmp(event, "attendance_invalid") == 0)
            {
                lastServerMsg = "attendance_invalid";
            }
            else if (strcmp(event, "attendance_error") == 0)
            {
                const char *msg = doc["data"]["message"];
                lastServerMsg = String("attendance_error: ") + (msg ? msg : "?");
            }
            else if (strcmp(event, "maintenance_toggle") == 0)
            {
                lastServerMsg = "maintenance_toggle";
            }
            else if (strcmp(event, "maintenance_blocked") == 0)
            {
                lastServerMsg = "maintenance_blocked";
            }
            else
            {
                lastServerMsg = String("event: ") + event;
            }
        }
        else if (msgType)
        {
            if (strcmp(msgType, "timeout_final") == 0)
            {
                teacherPresent = false;
                lastServerMsg = "timeout_final — teacher cleared";
            }
            else if (strcmp(msgType, "calibration_config") == 0)
            {
                lastServerMsg = "calibration_config (ignored)";
            }
            else if (strcmp(msgType, "start_scan") == 0)
            {
                lastServerMsg = "start_scan (use portal RFID form)";
            }
            else
            {
                // Covers {"status":"ok","message":"pong"} and similar acks
                const char *status = doc["status"];
                const char *msg = doc["message"];
                if (msg)
                {
                    lastServerMsg = String(msgType) + ": " + msg;
                }
                else if (status)
                {
                    lastServerMsg = String("status: ") + status;
                }
                else
                {
                    lastServerMsg = String("type: ") + msgType;
                }
            }
        }
        break;
    }

    case WStype_PING:
        Serial.println("[WS] PING received");
        break;

    case WStype_PONG:
        Serial.println("[WS] PONG received");
        break;

    default:
        break;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SIMULATED POWER
// ═══════════════════════════════════════════════════════════════════════════════
void updateSimulatedPower()
{
    float base = teacherPresent ? BASE_WATTS_ACTIVE : BASE_WATTS_IDLE;
    float noise = ((float)random(-100, 101) / 100.0f) * NOISE_AMPLITUDE;
    currentW = base + noise;
    if (currentW < 0.0f)
        currentW = 0.0f;
    currentV = NOMINAL_VOLTAGE;
    currentI = currentW / currentV;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEND FRAMES (contracts identical to real firmware)
// ═══════════════════════════════════════════════════════════════════════════════
void sendPowerFrame()
{
    powerDoc.clear();
    powerDoc["device_id"] = cfg.deviceId;
    powerDoc["voltage"] = round(currentV * 10.0f) / 10.0f;
    powerDoc["current"] = round(currentI * 1000.0f) / 1000.0f;
    powerDoc["power"] = round(currentW * 10.0f) / 10.0f;

    char buf[192];
    size_t len = serializeJson(powerDoc, buf, sizeof(buf));
    if (!webSocket.sendTXT(buf, len))
    {
        Serial.println("[WS] Failed to send power frame");
        wsConnected = false;
    }
}

void sendRfidFrame(const String &uid)
{
    rfidDoc.clear();
    rfidDoc["device_id"] = cfg.deviceId;
    rfidDoc["rfid_uid"] = uid;
    rfidDoc["voltage"] = round(currentV * 10.0f) / 10.0f;
    rfidDoc["current"] = round(currentI * 1000.0f) / 1000.0f;
    rfidDoc["power"] = round(currentW * 10.0f) / 10.0f;

    char buf[192];
    size_t len = serializeJson(rfidDoc, buf, sizeof(buf));
    if (webSocket.sendTXT(buf, len))
    {
        wsLastActivity = millis();
        Serial.printf("[WS] RFID frame sent: %s\n", uid.c_str());
    }
    else
    {
        Serial.println("[WS] Failed to send RFID frame");
        wsConnected = false;
    }
}

void sendPingFrame()
{
    pingDoc.clear();
    pingDoc["type"] = "ping";
    char buf[48];
    size_t len = serializeJson(pingDoc, buf, sizeof(buf));
    if (!webSocket.sendTXT(buf, len))
    {
        wsConnected = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HTML HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// Shared CSS wrapper
String pageWrap(const String &title, const String &body)
{
    return String(
               "<!DOCTYPE html><html><head>"
               "<meta charset='utf-8'>"
               "<meta name='viewport' content='width=device-width,initial-scale=1'>"
               "<title>") +
           title + "</title>"
                   "<style>"
                   "body{font-family:sans-serif;max-width:520px;margin:20px auto;padding:0 12px;background:#f5f5f5}"
                   "h2{margin-bottom:4px}"
                   "label{display:block;margin-top:10px;font-size:.85em;color:#555}"
                   "input{width:100%;box-sizing:border-box;padding:7px;border:1px solid #ccc;border-radius:4px;margin-top:2px}"
                   ".card{background:#fff;border-radius:8px;padding:16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.1)}"
                   ".row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f0f0f0}"
                   ".row:last-child{border-bottom:none}"
                   ".val{font-size:1.15em;font-weight:bold;color:#212529}"
                   ".badge{padding:3px 10px;border-radius:12px;font-size:.8em;font-weight:bold}"
                   ".green{background:#d4edda;color:#155724}"
                   ".red{background:#f8d7da;color:#721c24}"
                   "button,input[type=submit]{"
                   "width:100%;margin-top:8px;padding:10px;"
                   "background:#0d6efd;color:#fff;"
                   "border:none;border-radius:4px;cursor:pointer;font-size:1em}"
                   "button.danger{background:#dc3545}"
                   "button.secondary{background:#6c757d}"
                   "a.btn{display:block;text-align:center;text-decoration:none;"
                   "padding:9px;border-radius:4px;margin-top:8px;color:#fff;background:#6c757d}"
                   "</style></head><body>" +
           body +
           "</body></html>";
}

// Config form — used in both AP mode (/) and running mode (/config)
String configFormHtml()
{
    String b;
    b.reserve(1400);
    b += "<h2>Dummy ESP32 Setup</h2>";
    b += "<p style='color:#555;font-size:.9em'>Enter your network and backend details, then click Save &amp; Reboot.</p>";
    b += "<div class='card'><form method='POST' action='/config'>";
    b += "<label>WiFi SSID</label>"
         "<input name='ssid' value='" +
         cfg.ssid + "' required placeholder='MyNetwork'>";
    b += "<label>WiFi Password</label>"
         "<input name='password' type='password' value='" +
         cfg.password + "' placeholder='(leave blank if open)'>";
    b += "<label>Server Host (IP or hostname)</label>"
         "<input name='ws_host' value='" +
         cfg.wsHost + "' required placeholder='192.168.1.100'>";
    b += "<label>Server Port</label>"
         "<input name='ws_port' type='number' value='" +
         String(cfg.wsPort) + "' required placeholder='8000'>";
    b += "<label>Device Token <small style='color:#888'>(copy from Admin → Classrooms)</small></label>"
         "<input name='device_token' value='" +
         cfg.deviceToken + "' required placeholder='ESP32-XXXXXXXX'>";
    b += "<label>Classroom ID</label>"
         "<input name='classroom_id' type='number' value='" +
         String(cfg.classroomId) + "' required placeholder='1'>";
    b += "<label>Device ID <small style='color:#888'>(any unique string)</small></label>"
         "<input name='device_id' value='" +
         cfg.deviceId + "' required placeholder='ESP32-DUMMY-01'>";
    b += "<input type='submit' value='Save &amp; Reboot'>";
    b += "</form></div>";
    return pageWrap("ESP32 Setup", b);
}

// Runtime dashboard — auto-refreshes every 2 s via fetch('/status')
String dashboardHtml()
{
    String b;
    b.reserve(2800);

    // Header
    b += "<h2>Dummy ESP32</h2>";
    b += "<p style='color:#777;font-size:.85em'>"
         "Device: <b>" +
         cfg.deviceId + "</b>&nbsp;|&nbsp;"
                        "Classroom: <b>" +
         String(cfg.classroomId) + "</b>&nbsp;|&nbsp;"
                                   "Server: <b>" +
         cfg.wsHost + ":" + String(cfg.wsPort) + "</b></p>";

    // ── Status card ──────────────────────────────────────────────────────────
    b += "<div class='card'>";
    b += "<div class='row'><span>WebSocket</span>"
         "<span id='ws' class='badge " +
         String(wsConnected ? "green" : "red") + "'>" +
         String(wsConnected ? "Connected" : "Disconnected") + "</span></div>";
    b += "<div class='row'><span>Voltage</span><span class='val' id='V'>" + String(currentV, 1) + " V</span></div>";
    b += "<div class='row'><span>Current</span><span class='val' id='I'>" + String(currentI, 3) + " A</span></div>";
    b += "<div class='row'><span>Power</span><span class='val' id='W'>" + String(currentW, 1) + " W</span></div>";
    b += "<div class='row'><span>Teacher</span>"
         "<span id='teacher' class='badge " +
         String(teacherPresent ? "green" : "red") + "'>" +
         String(teacherPresent ? "Present" : "Absent") + "</span></div>";
    b += "<div class='row'><span>Last server msg</span>"
         "<span id='msg' style='font-size:.85em;color:#555'>" +
         lastServerMsg + "</span></div>";
    b += "</div>";

    // ── Teacher presence toggle ───────────────────────────────────────────────
    b += "<div class='card'><b>Teacher Presence</b>"
         "<form method='POST' action='/teacher'>"
         "<input type='hidden' name='state' value='" +
         String(teacherPresent ? "0" : "1") + "'>"
                                              "<button type='submit'>" +
         String(teacherPresent ? "&#10005; Simulate Check-Out" : "&#10003; Simulate Check-In") +
         "</button></form></div>";

    // ── RFID scan simulator ───────────────────────────────────────────────────
    b += "<div class='card'><b>Simulate RFID Scan</b><br><br>"
         "<form method='POST' action='/rfid'>"
         "<label>RFID UID (hex, e.g. A1B2C3D4)</label>"
         "<input name='uid' placeholder='A1B2C3D4' required "
         "style='text-transform:uppercase;font-family:monospace'>"
         "<input type='submit' value='&#128268; Send Scan'>"
         "</form></div>";

    // ── Config / reset links ──────────────────────────────────────────────────
    b += "<a class='btn secondary' href='/config'>&#9881; Edit Configuration</a>"
         "<form method='POST' action='/reset' style='margin-top:8px'>"
         "<button class='danger' type='submit' "
         "onclick=\"return confirm('Clear all config and reboot into setup mode?')\">"
         "&#128465; Reset Config</button></form>";

    // ── Auto-refresh JS (polls /status every 2 s) ─────────────────────────────
    b += "<script>"
         "function refresh(){"
         "fetch('/status').then(r=>r.json()).then(d=>{"
         "var ws=document.getElementById('ws');"
         "ws.textContent=d.ws_connected?'Connected':'Disconnected';"
         "ws.className='badge '+(d.ws_connected?'green':'red');"
         "document.getElementById('V').textContent=d.voltage.toFixed(1)+' V';"
         "document.getElementById('I').textContent=d.current.toFixed(3)+' A';"
         "document.getElementById('W').textContent=d.power.toFixed(1)+' W';"
         "var t=document.getElementById('teacher');"
         "t.textContent=d.teacher_present?'Present':'Absent';"
         "t.className='badge '+(d.teacher_present?'green':'red');"
         "document.getElementById('msg').textContent=d.last_server_msg;"
         "}).catch(()=>{})}"
         "setInterval(refresh,2000);"
         "refresh();"
         "</script>";

    return pageWrap("Dummy ESP32", b);
}
