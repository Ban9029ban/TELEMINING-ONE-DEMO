/*
  TMONE Telemining 2026 - SENDER / MODULADORES
  Plataforma: ESP32-S3 LilyGO A7608 + Carrier Telemining 2026

  Modos soportados:
    MODE_SENDER_BLE_LORA              : Escanea BLE y transmite tramas por LoRa.
    MODE_MODULADOR_SENSORES          : Lee ADS1115 A1-A4 y transmite tramas por LoRa.
    MODE_MODULADOR_RFID_LORA_SENDER  : Recibe tramas RFID por Ethernet TCP y las retransmite por LoRa.

  Interfaces HW confirmadas:
    LoRa      : SX1278 SPI 433MHz
    Ethernet  : ENC28J60-I/SO
    ADC       : ADS1115IDGST I2C 0x48, VDD=5V, level shifting I2C BSS123
    MicroSD   : SPI independiente
*/

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <LoRa.h>
#include <WiFi.h>
#include <EthernetENC.h>
#include <SD.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <Adafruit_ADS1X15.h>

// =======================================================
//                  SELECCION DE MODO
// =======================================================

enum DeviceMode : uint8_t {
  MODE_SENDER_BLE_LORA = 1,
  MODE_MODULADOR_SENSORES = 2,
  MODE_MODULADOR_RFID_LORA_SENDER = 3
};

// Cambiar aquí según el uso de la placa.
static constexpr DeviceMode DEVICE_MODE = MODE_SENDER_BLE_LORA;

// =======================================================
//                  TRANSPORTE TCP
// =======================================================

enum NetTransport : uint8_t {
  NET_NONE = 0,
  NET_WIFI = 1,
  NET_ETHERNET = 2
};

// Para la placa nueva se recomienda NET_ETHERNET.
// Si NET_ETHERNET está activo, no se usa WiFi para TCP.
static constexpr NetTransport TCP_TRANSPORT = NET_ETHERNET;

// =======================================================
//                  IDENTIDAD / TRAMA
// =======================================================

static const char* PORTICO_ID  = "TMONE_TTE_001";
static const char* BACKBONE_ID = "GW_BACKBONE_001";
static const char* EDGE_KIND   = "EDGE_SENDER";
static const char* BLE_NAME    = "TMONE_EDGE_TTE_001";

// Formato base heredado:
// MAC:BT:TIMESTAMP:BACKBONE_ID:EDGE_KIND:PORTICO_ID:RSSI
//
// Para sensores:
// SENSOR_ID:SENSOR:TIMESTAMP:BACKBONE_ID:EDGE_KIND:PORTICO_ID:VALUE
//
// Para RFID modulador:
// Se retransmite la línea recibida. Si viene sin formato TMONE, se encapsula:
// RFID_ID:RFID:TIMESTAMP:BACKBONE_ID:EDGE_KIND:PORTICO_ID:RSSI_OR_0

// =======================================================
//                  RED / TCP
// =======================================================

static const char* WIFI_SSID = "TMONE_Repeat";
static const char* WIFI_PASS = "TMONE2025";

static const char* DEST_HOST = "172.20.10.2";
static constexpr uint16_t DEST_PORT = 7070;

// Servidor TCP local para modo RFID modulador.
// El lector RFID externo debe conectarse a esta IP/puerto y enviar una trama por línea.
static constexpr uint16_t RFID_TCP_LISTEN_PORT = 7071;

byte ETH_MAC[] = { 0x02, 0x54, 0x4D, 0x4F, 0x4E, 0x01 };
IPAddress ETH_STATIC_IP(172, 20, 10, 51);
IPAddress ETH_DNS(172, 20, 10, 1);
IPAddress ETH_GW(172, 20, 10, 1);
IPAddress ETH_MASK(255, 255, 255, 0);

static EthernetServer rfidServer(RFID_TCP_LISTEN_PORT);
static bool g_ethOk = false;
static bool g_wifiOk = false;

// =======================================================
//                  PINOUT TELEMINING 2026
// =======================================================

// SPI compartido LoRa + Ethernet
static constexpr int PIN_SPI_MISO = 42;
static constexpr int PIN_SPI_MOSI = 41;
static constexpr int PIN_SPI_SCK  = 40;

// LoRa SX1278
static constexpr int PIN_LORA_DIO0 = 5;
static constexpr int PIN_LORA_RST  = 48;
static constexpr int PIN_LORA_CS   = 38;

// Ethernet ENC28J60
static constexpr int PIN_ETH_INT = 10;
static constexpr int PIN_ETH_RST = 8;
static constexpr int PIN_ETH_CS  = 39;

// I2C ADS1115
static constexpr int PIN_I2C_SDA = 11;
static constexpr int PIN_I2C_SCL = 12;
static constexpr uint8_t ADS1115_ADDR = 0x48;

// LED de estado
static constexpr int PIN_LED_ST = 9;

// MicroSD SPI independiente
static constexpr int PIN_SD_MISO = 47;
static constexpr int PIN_SD_MOSI = 14;
static constexpr int PIN_SD_SCK  = 21;
static constexpr int PIN_SD_CS   = 13;

// Pines digitales informados
static constexpr int PIN_10V_IN_DIGITAL = 1;
static constexpr int PIN_3V3_IN_DIGITAL = 2;
static constexpr int PIN_ONE_WIRE       = 3;

// =======================================================
//                  LORA RF
// =======================================================

static constexpr uint32_t LORA_FREQ_HZ = 433000000UL;
static constexpr int LORA_SF = 7;
static constexpr long LORA_BW = 125E3;
static constexpr int LORA_CR = 5;              // 4/5
static constexpr uint8_t LORA_SYNCWORD = 0x12;
static constexpr int LORA_TX_POWER = 14;

// Anticolisión pórticos
static constexpr bool LORA_USE_TIMESLOT = true;
static constexpr uint32_t PERIOD_MS = 200;
static constexpr uint32_t WINDOW_MS = 40;
static uint32_t g_timeslotOffsetMs = 0;

// =======================================================
//                  ADC ADS1115
// =======================================================

Adafruit_ADS1115 ads;
static bool g_adsOk = false;

// Canal ADS1115:
// A1 4-20mA -> AIN0 con shunt 249 ohm a GND
// A2        -> AIN1
// A3        -> AIN2
// A4 0-10V  -> AIN3 con divisor 100k/100k esperado
static constexpr float A1_SHUNT_OHMS = 249.0f;
static constexpr float A4_DIVIDER_RATIO = 2.0f;  // Ventrada = Vadc * 2 si 100k/100k

static constexpr uint32_t SENSOR_READ_EVERY_MS = 5000;

// =======================================================
//                  BLE
// =======================================================

BLEScan* g_scan = nullptr;
static constexpr bool ENABLE_BLE_SCAN = true;
static constexpr uint32_t BLE_SCAN_EVERY_MS = 3000;
static constexpr uint32_t BLE_SCAN_SECONDS = 1;
static uint32_t g_lastBleScanMs = 0;

// =======================================================
//                  SD / LOGS
// =======================================================

SPIClass SD_SPI(HSPI);
static bool g_sdOk = false;
static const char* LOG_PATH = "/tmone_log.csv";
static const char* BUFFER_PATH = "/tmone_buffer.log";

// =======================================================
//                  ESTADOS LED
// =======================================================

enum LedCode : uint8_t {
  LED_BOOT = 1,         // 1 pulso corto cada ciclo
  LED_OK = 2,           // 2 pulsos cortos
  LED_LORA_TX = 3,      // 1 pulso largo
  LED_NET_OK = 4,       // 2 cortos + 1 largo
  LED_ERROR_NET = 5,    // 3 cortos
  LED_ERROR_LORA = 6,   // 4 cortos
  LED_ERROR_SD = 7,     // 5 cortos
  LED_ERROR_SENSOR = 8  // 6 cortos
};

static LedCode g_ledCode = LED_BOOT;
static uint32_t g_ledLastMs = 0;
static uint8_t g_ledStep = 0;
static bool g_ledOn = false;

static void setLed(bool on) {
  g_ledOn = on;
  digitalWrite(PIN_LED_ST, on ? HIGH : LOW);
}

static void ledSetCode(LedCode code) {
  if (g_ledCode == code) return;
  g_ledCode = code;
  g_ledStep = 0;
  g_ledLastMs = 0;
  setLed(false);
}

// Patrón no bloqueante.
// Corto=120ms, largo=500ms, pausa entre pulsos=160ms, pausa ciclo=1600ms.
static void serviceLed() {
  uint32_t now = millis();

  uint8_t pulses = 2;
  bool specialNet = false;
  bool longOnly = false;

  switch (g_ledCode) {
    case LED_BOOT: pulses = 1; break;
    case LED_OK: pulses = 2; break;
    case LED_LORA_TX: longOnly = true; pulses = 1; break;
    case LED_NET_OK: specialNet = true; pulses = 3; break;
    case LED_ERROR_NET: pulses = 3; break;
    case LED_ERROR_LORA: pulses = 4; break;
    case LED_ERROR_SD: pulses = 5; break;
    case LED_ERROR_SENSOR: pulses = 6; break;
  }

  uint16_t onMs = 120;
  if (longOnly) onMs = 500;
  if (specialNet && g_ledStep == 4) onMs = 500; // tercer pulso largo

  uint16_t offMs = 160;
  uint16_t cyclePauseMs = 1600;

  if (g_ledOn) {
    if (now - g_ledLastMs >= onMs) {
      setLed(false);
      g_ledLastMs = now;
      g_ledStep++;
    }
    return;
  }

  if (g_ledStep >= pulses * 2) {
    if (now - g_ledLastMs >= cyclePauseMs) {
      g_ledStep = 0;
      setLed(true);
      g_ledLastMs = now;
    }
    return;
  }

  if (now - g_ledLastMs >= offMs) {
    setLed(true);
    g_ledLastMs = now;
  }
}

// =======================================================
//                  UTILIDADES
// =======================================================

static void logSerial(const char* tag, const String& msg) {
  Serial.print("["); Serial.print(tag); Serial.print("] ");
  Serial.println(msg);
}

static String timestampISO() {
  // Sin RTC/NTP obligatorio. Se usa uptime en segundos si no hay hora real.
  char ts[32];
  snprintf(ts, sizeof(ts), "UPTIME_%lu", (unsigned long)(millis() / 1000UL));
  return String(ts);
}

static void logSD(const char* level, const char* module, const String& msg) {
  String line = timestampISO() + "," + level + "," + module + ",\"" + msg + "\"";
  Serial.println(line);

  if (!g_sdOk) return;
  File f = SD.open(LOG_PATH, FILE_APPEND);
  if (!f) {
    ledSetCode(LED_ERROR_SD);
    return;
  }
  f.println(line);
  f.close();
}

static bool appendBufferFrame(const String& frame) {
  if (!g_sdOk) return false;
  File f = SD.open(BUFFER_PATH, FILE_APPEND);
  if (!f) return false;
  f.println(frame);
  f.close();
  return true;
}

static uint32_t computeOffsetFromPorticoId(const char* id) {
  if (!id) return 0;
  int n = strlen(id);
  for (int i = n - 1; i >= 0; --i) {
    if (id[i] >= '0' && id[i] <= '9') {
      int d = id[i] - '0';
      if (d >= 1 && d <= 4) return d * 50;
      return 0;
    }
  }
  return 0;
}

// =======================================================
//                  INIT SD
// =======================================================

static void initSD() {
  SD_SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  if (SD.begin(PIN_SD_CS, SD_SPI)) {
    g_sdOk = true;
    logSD("INFO", "SD", "MicroSD inicializada");
  } else {
    g_sdOk = false;
    logSerial("SD", "No inicializa MicroSD");
    ledSetCode(LED_ERROR_SD);
  }
}

// =======================================================
//                  INIT RED
// =======================================================

static bool initWiFi() {
  if (TCP_TRANSPORT != NET_WIFI) return false;

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(200);
    serviceLed();
  }

  g_wifiOk = (WiFi.status() == WL_CONNECTED);
  logSD(g_wifiOk ? "INFO" : "ERROR", "WIFI", g_wifiOk ? "WiFi conectado" : "WiFi no conectado");
  return g_wifiOk;
}

static void resetEthernetChip() {
  pinMode(PIN_ETH_RST, OUTPUT);
  digitalWrite(PIN_ETH_RST, LOW);
  delay(50);
  digitalWrite(PIN_ETH_RST, HIGH);
  delay(200);
}

static bool initEthernet() {
  if (TCP_TRANSPORT != NET_ETHERNET) return false;

  resetEthernetChip();

  pinMode(PIN_ETH_CS, OUTPUT);
  digitalWrite(PIN_ETH_CS, HIGH);
  pinMode(PIN_LORA_CS, OUTPUT);
  digitalWrite(PIN_LORA_CS, HIGH);

  Ethernet.init(PIN_ETH_CS);

  int dhcp = Ethernet.begin(ETH_MAC);
  if (dhcp == 0) {
    Ethernet.begin(ETH_MAC, ETH_STATIC_IP, ETH_DNS, ETH_GW, ETH_MASK);
  }

  delay(500);
  g_ethOk = (Ethernet.localIP() != IPAddress(0, 0, 0, 0));

  if (g_ethOk) {
    logSD("INFO", "ETH", "Ethernet OK IP=" + Ethernet.localIP().toString());
    if (DEVICE_MODE == MODE_MODULADOR_RFID_LORA_SENDER) {
      rfidServer.begin();
      logSD("INFO", "RFID", String("Servidor TCP RFID puerto ") + RFID_TCP_LISTEN_PORT);
    }
  } else {
    logSD("ERROR", "ETH", "Ethernet no obtuvo IP");
    ledSetCode(LED_ERROR_NET);
  }

  return g_ethOk;
}

static bool netConnected() {
  if (TCP_TRANSPORT == NET_ETHERNET) return g_ethOk;
  if (TCP_TRANSPORT == NET_WIFI) return WiFi.status() == WL_CONNECTED;
  return false;
}

static bool sendTcpToDest(const String& frame) {
  if (!netConnected()) {
    ledSetCode(LED_ERROR_NET);
    appendBufferFrame(frame);
    return false;
  }

  if (TCP_TRANSPORT == NET_ETHERNET) {
    EthernetClient client;
    if (!client.connect(DEST_HOST, DEST_PORT)) {
      ledSetCode(LED_ERROR_NET);
      appendBufferFrame(frame);
      return false;
    }
    client.println(frame);
    client.stop();
    ledSetCode(LED_NET_OK);
    return true;
  }

  WiFiClient client;
  if (!client.connect(DEST_HOST, DEST_PORT)) {
    ledSetCode(LED_ERROR_NET);
    appendBufferFrame(frame);
    return false;
  }
  client.println(frame);
  client.stop();
  ledSetCode(LED_NET_OK);
  return true;
}

// =======================================================
//                  INIT LORA
// =======================================================

static bool initLoRa() {
  pinMode(PIN_LORA_CS, OUTPUT);
  digitalWrite(PIN_LORA_CS, HIGH);
  pinMode(PIN_ETH_CS, OUTPUT);
  digitalWrite(PIN_ETH_CS, HIGH);

  SPI.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI);

  LoRa.setPins(PIN_LORA_CS, PIN_LORA_RST, PIN_LORA_DIO0);

  if (!LoRa.begin(LORA_FREQ_HZ)) {
    logSD("ERROR", "LORA", "No inicializa SX1278");
    ledSetCode(LED_ERROR_LORA);
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNCWORD);
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.enableCrc();

  logSD("INFO", "LORA", "SX1278 OK 433MHz");
  return true;
}

static bool loraInWindow() {
  if (!LORA_USE_TIMESLOT) return true;
  return (((millis() + g_timeslotOffsetMs) % PERIOD_MS) < WINDOW_MS);
}

static bool sendLoRaFrame(const String& frame) {
  uint32_t start = millis();
  while (!loraInWindow() && millis() - start < 70) {
    serviceLed();
    delay(2);
  }

  if (!loraInWindow()) return false;

  LoRa.beginPacket();
  LoRa.print(frame);
  int ok = LoRa.endPacket();

  if (ok == 1) {
    logSD("INFO", "LORA_TX", frame);
    ledSetCode(LED_LORA_TX);
    return true;
  }

  logSD("ERROR", "LORA_TX", "Fallo TX: " + frame);
  ledSetCode(LED_ERROR_LORA);
  appendBufferFrame(frame);
  return false;
}

// =======================================================
//                  ADS1115 / SENSORES
// =======================================================

static void initADS() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  if (!ads.begin(ADS1115_ADDR, &Wire)) {
    g_adsOk = false;
    logSD("ERROR", "ADS1115", "No inicializa ADS1115 0x48");
    ledSetCode(LED_ERROR_SENSOR);
    return;
  }

  // ADS1115 alimentado a 5V. GAIN_TWOTHIRDS permite FS ±6.144V.
  // No aplicar señales mayores a VDD del ADS1115.
  ads.setGain(GAIN_TWOTHIRDS);
  g_adsOk = true;
  logSD("INFO", "ADS1115", "ADS1115 OK addr 0x48");
}

static float adsVolts(uint8_t channel) {
  int16_t raw = ads.readADC_SingleEnded(channel);
  return ads.computeVolts(raw);
}

static void readAndSendSensors() {
  if (!g_adsOk) return;

  float a1_v = adsVolts(0);
  float a2_v = adsVolts(1);
  float a3_v = adsVolts(2);
  float a4_adc_v = adsVolts(3);

  float a1_mA = (a1_v / A1_SHUNT_OHMS) * 1000.0f;
  float a4_input_v = a4_adc_v * A4_DIVIDER_RATIO;

  String ts = timestampISO();

  String f1 = String("A1:SENSOR_4_20MA:") + ts + ":" + BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(a1_mA, 3);
  String f2 = String("A2:SENSOR_ADC_V:") + ts + ":" + BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(a2_v, 3);
  String f3 = String("A3:SENSOR_ADC_V:") + ts + ":" + BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(a3_v, 3);
  String f4 = String("A4:SENSOR_0_10V:") + ts + ":" + BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(a4_input_v, 3);

  sendLoRaFrame(f1);
  sendLoRaFrame(f2);
  sendLoRaFrame(f3);
  sendLoRaFrame(f4);
}

// =======================================================
//                  BLE SENDER
// =======================================================

static bool looksLikeTmoneFrame(const String& s) {
  int colons = 0;
  for (size_t i = 0; i < s.length(); ++i) if (s[i] == ':') colons++;
  return colons >= 6;
}

class BleCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int rssi = advertisedDevice.getRSSI();

    String frame = addr + ":BT:" + timestampISO() + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(rssi);

    sendLoRaFrame(frame);
  }
};

static void initBLE() {
  if (!ENABLE_BLE_SCAN) return;

  BLEDevice::init(BLE_NAME);
  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new BleCallbacks());
  g_scan->setActiveScan(true);
  g_scan->setInterval(50);
  g_scan->setWindow(45);

  logSD("INFO", "BLE", "BLE scan listo");
}

static void pollBLE() {
  if (!g_scan) return;
  if (millis() - g_lastBleScanMs < BLE_SCAN_EVERY_MS) return;

  g_lastBleScanMs = millis();
  g_scan->start((int)BLE_SCAN_SECONDS, false);
  g_scan->clearResults();
}

// =======================================================
//                  RFID TCP -> LORA
// =======================================================

static String normalizeRfidFrame(String line) {
  line.trim();
  if (line.length() == 0) return "";

  if (looksLikeTmoneFrame(line)) return line;

  // Encapsulado mínimo compatible con estructura de 7 campos.
  return line + ":RFID:" + timestampISO() + ":" +
         BACKBONE_ID + ":" + "EDGE_RFID_LORA_SENDER" + ":" + PORTICO_ID + ":0";
}

static void pollRfidTcpServer() {
  if (DEVICE_MODE != MODE_MODULADOR_RFID_LORA_SENDER) return;
  if (TCP_TRANSPORT != NET_ETHERNET || !g_ethOk) return;

  EthernetClient client = rfidServer.available();
  if (!client) return;

  uint32_t start = millis();
  String line;

  while (client.connected() && millis() - start < 1000) {
    while (client.available()) {
      char c = (char)client.read();
      if (c == '\n' || c == '\r') {
        String frame = normalizeRfidFrame(line);
        if (frame.length() > 0) {
          bool ok = sendLoRaFrame(frame);
          client.println(ok ? "OK" : "ERROR");
        }
        line = "";
      } else if (line.length() < 240) {
        line += c;
      }
    }
    serviceLed();
    delay(1);
  }

  if (line.length() > 0) {
    String frame = normalizeRfidFrame(line);
    if (frame.length() > 0) {
      bool ok = sendLoRaFrame(frame);
      client.println(ok ? "OK" : "ERROR");
    }
  }

  client.stop();
}

// =======================================================
//                  SETUP / LOOP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1200);

  pinMode(PIN_LED_ST, OUTPUT);
  setLed(false);
  ledSetCode(LED_BOOT);

  Serial.println();
  Serial.println("=== TMONE Telemining 2026 - Sender/Modulador ===");

  g_timeslotOffsetMs = computeOffsetFromPorticoId(PORTICO_ID);

  initSD();
  initADS();
  initLoRa();

  if (TCP_TRANSPORT == NET_ETHERNET) initEthernet();
  if (TCP_TRANSPORT == NET_WIFI) initWiFi();

  if (DEVICE_MODE == MODE_SENDER_BLE_LORA) initBLE();

  logSD("INFO", "BOOT", "Setup completo");
  ledSetCode(LED_OK);
}

void loop() {
  serviceLed();

  if (TCP_TRANSPORT == NET_ETHERNET) {
    Ethernet.maintain();
  }

  if (DEVICE_MODE == MODE_SENDER_BLE_LORA) {
    pollBLE();
  }

  static uint32_t lastSensorMs = 0;
  if (DEVICE_MODE == MODE_MODULADOR_SENSORES) {
    if (millis() - lastSensorMs >= SENSOR_READ_EVERY_MS) {
      lastSensorMs = millis();
      readAndSendSensors();
    }
  }

  if (DEVICE_MODE == MODE_MODULADOR_RFID_LORA_SENDER) {
    pollRfidTcpServer();
  }

  delay(2);
}
