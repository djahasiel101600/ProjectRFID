#include <Arduino.h>

// Pin definitions
const int CURRENT_SENSOR_PIN = 35; // GPIO 35
const float VREF = 3.3;            // ESP32 ADC reference voltage
const int ADC_RESOLUTION = 4095;   // ESP32 ADC resolution (12-bit)

// ACS724 parameters (adjust based on your specific model)
// For ACS724LLCTR-20AB (20A model) or ACS724LLCTR-30AB (30A model)
const float SENSOR_SENSITIVITY = 40.0; // mV/A - Check your datasheet
                                       // 40mV/A for 25A model, 60mV/A for 20A/30A models
const float QOV = VREF / 2;            // Quiescent Output Voltage (1.65V for 3.3V)

// Calibration variables
float zeroCurrentVoltage = 2.4324;
const int CALIBRATION_SAMPLES = 1000;

// Thresholds and limits
float CURRENT_THRESHOLD_WARNING = 15.0; // Warn if current exceeds this
float CURRENT_THRESHOLD_MAX = 20.0;     // Maximum expected current

// RMS calculation parameters
const int RMS_SAMPLES = 100;     // Samples for RMS calculation
const int SAMPLE_DELAY_US = 500; // Microseconds between samples

void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n╔════════════════════════════════════════╗");
    Serial.println("║   ACS724 Current Sensor Test Suite   ║");
    Serial.println("╚════════════════════════════════════════╝");

    // Set ADC attenuation for 3.3V range
    analogReadResolution(12);       // Set to 12-bit resolution
    analogSetAttenuation(ADC_11db); // For full 0-3.3V range

    // Sensor diagnostics
    performDiagnostics();

    // Calibrate sensor (measure zero current)
    calibrateSensor();

    Serial.println("\n╔════════════════════════════════════════╗");
    Serial.println("║           Command Menu                ║");
    Serial.println("╠════════════════════════════════════════╣");
    Serial.println("║ c - Calibrate (zero current)          ║");
    Serial.println("║ r - Continuous readings               ║");
    Serial.println("║ s - Single reading                    ║");
    Serial.println("║ m - RMS current measurement (AC)      ║");
    Serial.println("║ d - Detailed diagnostics              ║");
    Serial.println("║ g - Graph mode (ASCII)                ║");
    Serial.println("║ l - CSV log mode (for analysis)       ║");
    Serial.println("║ t - Set current threshold             ║");
    Serial.println("║ ? - Show this menu                    ║");
    Serial.println("╚════════════════════════════════════════╝\n");
}

void loop()
{
    if (Serial.available())
    {
        char command = Serial.read();

        switch (command)
        {
        case 'c':
            calibrateSensor();
            break;

        case 'r':
            continuousReading();
            break;

        case 's':
            singleReading();
            break;

        case 'm':
            measureRMSCurrent();
            break;

        case 'd':
            performDiagnostics();
            break;

        case 'g':
            graphMode();
            break;

        case 'l':
            csvLogMode();
            break;

        case 't':
            setThreshold();
            break;

        case '?':
            printHelp();
            break;
        }
    }

    delay(100);
}

void calibrateSensor()
{
    Serial.println("\n╔══════════════════════════════════════╗");
    Serial.println("║        Sensor Calibration            ║");
    Serial.println("╚══════════════════════════════════════╝");
    Serial.println("⚠ Ensure NO current is flowing through sensor!");
    Serial.println("⚠ Disconnect all loads before calibrating");
    Serial.println("\nStarting calibration in 3 seconds...");

    for (int i = 3; i > 0; i--)
    {
        Serial.print(i);
        Serial.println("...");
        delay(1000);
    }

    Serial.println("\nCalibrating...");

    float sum = 0;
    float minVal = 4095;
    float maxVal = 0;

    for (int i = 0; i < CALIBRATION_SAMPLES; i++)
    {
        int adcValue = analogRead(CURRENT_SENSOR_PIN);
        sum += adcValue;
        minVal = min(minVal, (float)adcValue);
        maxVal = max(maxVal, (float)adcValue);

        // Progress indicator
        if (i % 100 == 0)
        {
            Serial.print(".");
        }
        delay(2);
    }
    Serial.println();

    float avgADC = sum / CALIBRATION_SAMPLES;
    zeroCurrentVoltage = avgADC * (VREF / ADC_RESOLUTION);
    float stability = maxVal - minVal;

    Serial.println("\n✓ Calibration Complete!");
    Serial.println("─────────────────────────────────────");
    Serial.print("Zero current voltage: ");
    Serial.print(zeroCurrentVoltage, 4);
    Serial.println(" V");

    Serial.print("Average ADC value: ");
    Serial.println(avgADC, 2);

    Serial.print("ADC stability: ±");
    Serial.print(stability / 2, 1);
    Serial.println(" counts");

    // Evaluate calibration quality
    if (stability < 10)
    {
        Serial.println("✓ Calibration quality: EXCELLENT");
    }
    else if (stability < 30)
    {
        Serial.println("✓ Calibration quality: GOOD");
    }
    else
    {
        Serial.println("⚠ Calibration quality: POOR - Check for noise/interference");
    }
}

void singleReading()
{
    float voltage = readVoltage();
    float current = calculateCurrent(voltage);

    Serial.println("\n╔══════════════════════════════════════╗");
    Serial.println("║        Single Reading Result         ║");
    Serial.println("╚══════════════════════════════════════╝");
    printMeasurement(voltage, current);

    // Visual indicator
    Serial.println("\nCurrent Level:");
    drawCurrentBar(current);
}

void continuousReading()
{
    Serial.println("\n╔══════════════════════════════════════╗");
    Serial.println("║       Continuous Readings Mode       ║");
    Serial.println("╚══════════════════════════════════════╝");
    Serial.println("Press any key to stop...\n");

    unsigned long startTime = millis();
    int readingCount = 0;
    float sumCurrent = 0;
    float maxCurrent = -1000;
    float minCurrent = 1000;

    while (!Serial.available())
    {
        float voltage = readVoltage();
        float current = calculateCurrent(voltage);

        // Update statistics
        sumCurrent += current;
        maxCurrent = max(maxCurrent, current);
        minCurrent = min(minCurrent, current);
        readingCount++;

        // Print reading with threshold warning
        Serial.print("Reading #");
        Serial.print(readingCount);
        Serial.print(": ");
        Serial.print(current, 3);
        Serial.print(" A");

        // Add warning indicators
        if (abs(current) > CURRENT_THRESHOLD_MAX)
        {
            Serial.print("  ✗ CRITICAL!");
        }
        else if (abs(current) > CURRENT_THRESHOLD_WARNING)
        {
            Serial.print("  ⚠ WARNING");
        }

        Serial.println();

        delay(500);
    }

    // Clear serial buffer
    while (Serial.available())
        Serial.read();

    // Print statistics
    printStatistics(readingCount, sumCurrent, maxCurrent, minCurrent, startTime);
}

float readVoltage()
{
    // Take multiple samples for better accuracy
    const int SAMPLES = 10;
    float sum = 0;

    for (int i = 0; i < SAMPLES; i++)
    {
        sum += analogRead(CURRENT_SENSOR_PIN);
        delay(1);
    }

    float avgADC = sum / SAMPLES;
    return avgADC * (VREF / ADC_RESOLUTION);
}

float calculateCurrent(float voltage)
{
    // Convert voltage to current using sensor sensitivity
    float voltageDifference = voltage - zeroCurrentVoltage;
    return voltageDifference * (1000.0 / SENSOR_SENSITIVITY); // Convert mV to A
}

void printMeasurement(float voltage, float current)
{
    int adcValue = voltage * (ADC_RESOLUTION / VREF);
    float voltageDiff = voltage - zeroCurrentVoltage;

    Serial.println("\nMeasurement Details:");
    Serial.println("─────────────────────────────────────");

    Serial.print("  Sensor Voltage: ");
    Serial.print(voltage, 4);
    Serial.print(" V  (ADC: ");
    Serial.print(adcValue);
    Serial.println(")");

    Serial.print("  Zero Reference: ");
    Serial.print(zeroCurrentVoltage, 4);
    Serial.println(" V");

    Serial.print("  Voltage Diff:   ");
    Serial.print(voltageDiff, 4);
    Serial.print(" V  (");
    Serial.print(voltageDiff * 1000, 2);
    Serial.println(" mV)");

    Serial.println();
    Serial.print("  ➤ CURRENT: ");
    Serial.print(current, 3);
    Serial.println(" A");

    // Show power if voltage is known (220V assumed for example)
    Serial.print("  ➤ Power (220V): ");
    Serial.print(abs(current) * 220.0, 1);
    Serial.println(" W");

    Serial.println("─────────────────────────────────────");
}

void printStatistics(int count, float sum, float maxVal, float minVal, unsigned long startTime)
{
    float avgCurrent = sum / count;
    float duration = (millis() - startTime) / 1000.0;

    Serial.println("\n╔══════════════════════════════════════╗");
    Serial.println("║          Session Statistics          ║");
    Serial.println("╚══════════════════════════════════════╝");

    Serial.print("Total readings: ");
    Serial.println(count);

    Serial.print("Duration: ");
    Serial.print(duration, 1);
    Serial.print(" seconds (");
    Serial.print(count / duration, 1);
    Serial.println(" samples/sec)");

    Serial.println("\nCurrent Statistics:");
    Serial.println("─────────────────────────────────────");

    Serial.print("  Average: ");
    Serial.print(avgCurrent, 3);
    Serial.println(" A");

    Serial.print("  Maximum: ");
    Serial.print(maxVal, 3);
    Serial.println(" A");

    Serial.print("  Minimum: ");
    Serial.print(minVal, 3);
    Serial.println(" A");

    Serial.print("  Range:   ");
    Serial.print(maxVal - minVal, 3);
    Serial.println(" A");

    Serial.println("\nPower Statistics (@ 220V):");
    Serial.println("─────────────────────────────────────");

    Serial.print("  Average power: ");
    Serial.print(abs(avgCurrent) * 220.0, 1);
    Serial.println(" W");

    Serial.print("  Peak power:    ");
    Serial.print(abs(maxVal) * 220.0, 1);
    Serial.println(" W");

    Serial.print("  Energy used:   ");
    Serial.print((abs(avgCurrent) * 220.0 * duration) / 3600.0, 3);
    Serial.println(" Wh");

    Serial.println("─────────────────────────────────────");
}

void printHelp()
{
    Serial.println("\n╔════════════════════════════════════════╗");
    Serial.println("║           Command Menu                ║");
    Serial.println("╠════════════════════════════════════════╣");
    Serial.println("║ c - Calibrate (zero current)          ║");
    Serial.println("║ r - Continuous readings               ║");
    Serial.println("║ s - Single reading                    ║");
    Serial.println("║ m - RMS current measurement (AC)      ║");
    Serial.println("║ d - Detailed diagnostics              ║");
    Serial.println("║ g - Graph mode (ASCII)                ║");
    Serial.println("║ l - CSV log mode (for analysis)       ║");
    Serial.println("║ t - Set current threshold             ║");
    Serial.println("║ ? - Show this menu                    ║");
    Serial.println("╚════════════════════════════════════════╝");
}

// ============== NEW FUNCTIONS ==============

void performDiagnostics()
{
    Serial.println("\n=== Sensor Diagnostics ===");

    // Check ADC readings
    Serial.println("\nADC Health Check:");
    float minReading = 4095;
    float maxReading = 0;
    float sum = 0;

    for (int i = 0; i < 100; i++)
    {
        int adcValue = analogRead(CURRENT_SENSOR_PIN);
        minReading = min(minReading, (float)adcValue);
        maxReading = max(maxReading, (float)adcValue);
        sum += adcValue;
        delay(2);
    }

    float avgADC = sum / 100.0;
    float avgVoltage = avgADC * (VREF / ADC_RESOLUTION);
    float noise = maxReading - minReading;

    Serial.print("  Average ADC: ");
    Serial.print(avgADC, 2);
    Serial.print(" (");
    Serial.print(avgVoltage, 4);
    Serial.println(" V)");

    Serial.print("  ADC Range: ");
    Serial.print(minReading, 0);
    Serial.print(" - ");
    Serial.println(maxReading, 0);

    Serial.print("  Noise Level: ");
    Serial.print(noise, 0);
    Serial.print(" ADC counts (");
    Serial.print(noise * (VREF / ADC_RESOLUTION) * 1000, 2);
    Serial.println(" mV)");

    // Evaluate noise
    if (noise < 10)
    {
        Serial.println("  ✓ Noise level: EXCELLENT");
    }
    else if (noise < 30)
    {
        Serial.println("  ✓ Noise level: GOOD");
    }
    else if (noise < 100)
    {
        Serial.println("  ⚠ Noise level: MODERATE - Check connections");
    }
    else
    {
        Serial.println("  ✗ Noise level: HIGH - Check wiring!");
    }

    // Expected voltage range check
    Serial.println("\nSensor Configuration:");
    Serial.print("  Sensitivity: ");
    Serial.print(SENSOR_SENSITIVITY, 1);
    Serial.println(" mV/A");

    Serial.print("  Zero current voltage: ");
    Serial.print(zeroCurrentVoltage, 4);
    Serial.println(" V");

    Serial.print("  Expected range: ");
    Serial.print(zeroCurrentVoltage - (20 * SENSOR_SENSITIVITY / 1000.0), 2);
    Serial.print(" V to ");
    Serial.print(zeroCurrentVoltage + (20 * SENSOR_SENSITIVITY / 1000.0), 2);
    Serial.println(" V (±20A)");
}

void measureRMSCurrent()
{
    Serial.println("\n=== RMS Current Measurement ===");
    Serial.println("Measuring AC current over multiple cycles...\n");

    float sumSquares = 0;
    float instantaneousMax = 0;
    float instantaneousMin = 1000;

    unsigned long startTime = micros();

    for (int i = 0; i < RMS_SAMPLES; i++)
    {
        int adcValue = analogRead(CURRENT_SENSOR_PIN);
        float voltage = adcValue * (VREF / ADC_RESOLUTION);
        float current = calculateCurrent(voltage);

        sumSquares += current * current;
        instantaneousMax = max(instantaneousMax, current);
        instantaneousMin = min(instantaneousMin, current);

        delayMicroseconds(SAMPLE_DELAY_US);
    }

    unsigned long endTime = micros();
    float samplingTime = (endTime - startTime) / 1000.0; // Convert to ms

    float rmsCurrent = sqrt(sumSquares / RMS_SAMPLES);
    float peakToPeak = instantaneousMax - instantaneousMin;

    Serial.println("Results:");
    Serial.print("  RMS Current: ");
    Serial.print(rmsCurrent, 3);
    Serial.println(" A");

    Serial.print("  Peak Current: ");
    Serial.print(instantaneousMax, 3);
    Serial.println(" A");

    Serial.print("  Peak-to-Peak: ");
    Serial.print(peakToPeak, 3);
    Serial.println(" A");

    Serial.print("  Sampling time: ");
    Serial.print(samplingTime, 2);
    Serial.println(" ms");

    Serial.print("  Sampling rate: ");
    Serial.print(RMS_SAMPLES / (samplingTime / 1000.0), 1);
    Serial.println(" Hz");

    // Check for threshold warnings
    if (rmsCurrent > CURRENT_THRESHOLD_MAX)
    {
        Serial.println("  ✗ WARNING: Current exceeds maximum threshold!");
    }
    else if (rmsCurrent > CURRENT_THRESHOLD_WARNING)
    {
        Serial.println("  ⚠ CAUTION: Current approaching threshold");
    }
}

void graphMode()
{
    Serial.println("\n=== ASCII Graph Mode ===");
    Serial.println("Real-time current visualization");
    Serial.println("Press any key to stop...\n");

    const int GRAPH_WIDTH = 50;
    const float GRAPH_MAX = 25.0; // Maximum current to display (A)

    delay(1000);

    while (!Serial.available())
    {
        float voltage = readVoltage();
        float current = calculateCurrent(voltage);

        // Create ASCII bar graph
        int barLength = (abs(current) / GRAPH_MAX) * GRAPH_WIDTH;
        barLength = constrain(barLength, 0, GRAPH_WIDTH);

        // Print current value
        Serial.print(current >= 0 ? "+" : "");
        Serial.print(current, 2);
        Serial.print(" A |");

        // Print bar
        for (int i = 0; i < barLength; i++)
        {
            Serial.print("█");
        }

        // Print warning if threshold exceeded
        if (abs(current) > CURRENT_THRESHOLD_WARNING)
        {
            Serial.print(" ⚠");
        }

        Serial.println();

        delay(100);
    }

    // Clear serial buffer
    while (Serial.available())
        Serial.read();
    Serial.println("\nGraph mode stopped.");
}

void csvLogMode()
{
    Serial.println("\n=== CSV Log Mode ===");
    Serial.println("Logging data in CSV format for analysis");
    Serial.println("Press any key to stop...\n");

    delay(1000);

    // Print CSV header
    Serial.println("Timestamp(ms),Voltage(V),Current(A),ADC_Value");

    unsigned long startTime = millis();

    while (!Serial.available())
    {
        unsigned long timestamp = millis() - startTime;

        int adcValue = analogRead(CURRENT_SENSOR_PIN);
        float voltage = adcValue * (VREF / ADC_RESOLUTION);
        float current = calculateCurrent(voltage);

        // Print CSV row
        Serial.print(timestamp);
        Serial.print(",");
        Serial.print(voltage, 4);
        Serial.print(",");
        Serial.print(current, 4);
        Serial.print(",");
        Serial.println(adcValue);

        delay(100);
    }

    // Clear serial buffer
    while (Serial.available())
        Serial.read();
    Serial.println("\nCSV logging stopped.");
    Serial.println("Copy the data above and save as .csv file for analysis in Excel/Python");
}

void setThreshold()
{
    Serial.println("\n=== Set Current Threshold ===");
    Serial.print("Current warning threshold: ");
    Serial.print(CURRENT_THRESHOLD_WARNING, 1);
    Serial.println(" A");

    Serial.print("Current maximum threshold: ");
    Serial.print(CURRENT_THRESHOLD_MAX, 1);
    Serial.println(" A");

    Serial.println("\nEnter new warning threshold (A): ");

    // Wait for input with timeout
    unsigned long startWait = millis();
    String input = "";

    while (millis() - startWait < 10000)
    { // 10 second timeout
        if (Serial.available())
        {
            char c = Serial.read();
            if (c == '\n' || c == '\r')
            {
                break;
            }
            input += c;
        }
    }

    if (input.length() > 0)
    {
        float newThreshold = input.toFloat();
        if (newThreshold > 0 && newThreshold < 30)
        {
            CURRENT_THRESHOLD_WARNING = newThreshold;
            Serial.print("✓ Warning threshold set to: ");
            Serial.print(CURRENT_THRESHOLD_WARNING, 1);
            Serial.println(" A");
        }
        else
        {
            Serial.println("✗ Invalid value. Threshold unchanged.");
        }
    }
    else
    {
        Serial.println("Timeout. Threshold unchanged.");
    }
}

void drawCurrentBar(float current)
{
    const int BAR_WIDTH = 40;
    const float MAX_DISPLAY = 25.0; // Maximum current for full bar

    int barLength = (abs(current) / MAX_DISPLAY) * BAR_WIDTH;
    barLength = constrain(barLength, 0, BAR_WIDTH);

    Serial.print("  [");

    for (int i = 0; i < BAR_WIDTH; i++)
    {
        if (i < barLength)
        {
            if (abs(current) > CURRENT_THRESHOLD_MAX)
            {
                Serial.print("!");
            }
            else if (abs(current) > CURRENT_THRESHOLD_WARNING)
            {
                Serial.print("▓");
            }
            else
            {
                Serial.print("█");
            }
        }
        else
        {
            Serial.print("░");
        }
    }

    Serial.print("] ");
    Serial.print(abs(current), 2);
    Serial.print(" A");

    if (abs(current) > CURRENT_THRESHOLD_MAX)
    {
        Serial.print("  ✗ CRITICAL");
    }
    else if (abs(current) > CURRENT_THRESHOLD_WARNING)
    {
        Serial.print("  ⚠ HIGH");
    }

    Serial.println();
}