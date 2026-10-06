#include <Arduino.h>

static void printBoth(const char* text) {
  Serial.print(text);
#if defined(ARDUINO_ARCH_ESP32)
  Serial0.print(text);
#endif
}

static void printlnBoth(const char* text) {
  Serial.println(text);
#if defined(ARDUINO_ARCH_ESP32)
  Serial0.println(text);
#endif
}

void setup() {
  Serial.begin(115200);
#if defined(ARDUINO_ARCH_ESP32)
  Serial0.begin(115200);
#endif

  delay(1000);
  printlnBoth("");
  printlnBoth("=== TEST SERIAL DUAL ===");
  printlnBoth("Salida por Serial y Serial0.");
}

void loop() {
  static uint32_t count = 0;
  char line[96];
  snprintf(line, sizeof(line), "[TEST] alive=%lu ms=%lu", (unsigned long)count++, (unsigned long)millis());
  printlnBoth(line);
  delay(1000);
}
