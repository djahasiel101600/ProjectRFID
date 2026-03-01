// ARDUINO - Using SoftwareSerial
#include <SoftwareSerial.h>

// SoftwareSerial Serial(16, 17); // RX, TX (use any available digital pins)

int relayPin = 2;
// Track last load state so Relay Trigger follows: ON when load is OFF, OFF when load is ON
bool lastStateOn = false;

void setup()
{
    Serial.begin(115200); // For Serial Monitor debugging

    pinMode(relayPin, OUTPUT);
    digitalWrite(relayPin, HIGH); // Start with trigger ON (assume load was OFF before boot)

    Serial.println("Arduino Ready - Using SoftwareSerial");
}

void loop()
{
    if (Serial.available())
    {
        String receivedData = Serial.readStringUntil('\n');
        receivedData.trim();

        if (receivedData == "R1_ON")
        {
            // Last state is ON -> Relay Trigger OFF
            lastStateOn = true;
            digitalWrite(relayPin, LOW);
            Serial.println("Command: Relay 1 ON (Trigger OFF)");
        }
        else if (receivedData == "R1_OFF")
        {
            // Last value is OFF -> Relay Trigger ON
            lastStateOn = false;
            digitalWrite(relayPin, HIGH);
            Serial.println("Command: Relay 1 OFF (Trigger ON)");
        }
    }
}