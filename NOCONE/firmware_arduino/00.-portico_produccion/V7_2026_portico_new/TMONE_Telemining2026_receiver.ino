/*
  TMONE Telemining 2026 - RECEIVER / RFID LORA RECEIVER
  Plataforma: ESP32-S3 LilyGO A7608 + Carrier Telemining 2026

  Modos soportados:
    MODE_RECEIVER_LORA_TCP              : Recibe LoRa y reenvía tramas a IP destino por Ethernet o WiFi.
    MODE_MODULADOR_RFID_LORA_RECEIVER  : Recibe LoRa desde modulador RFID y reenvía a IP destino.

  Interfaces HW confirmadas:
    LoRa      : SX1278 SPI 433MHz
    Ethernet  : ENC28J60-I/SO
    MicroSD   : SPI independiente
*/

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <EthernetENC.h>
#include <SD.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>

// =======================================================
//                  SELECCION DE MODO
// =======================================================

enum DeviceMode : uint8_t {
  MODE_RECEIVER_LORA_TCP = 10,
  MODE_MODULADOR_RFID_LORA_RECEIVER = 11
};

static constexpr DeviceMode DEVICE_MODE = MODE_RECEIVER_LORA_TCP;

// =======================================================
//                  TRANSPORTE TCP
// =======================================================

enum NetTransport : uint8_t {
  NET_NONE = 0,
  NET_WIFI = 1,
  NET_ETHERNET = 2
};

// Si NET_ETHERNET está activo, no se usa WiFi.
static constexpr NetTransport TCP_TRANSPORT = NET_ETHERNET;

// =======================================================
//                  IDENTIDAD
// =======================================================

static const char* PORTICO_ID  = "TMONE_TTE_RX_003";
static const char* BACKBONE_ID = "GW_BACKBONE_RX_003";
static const char* EDGE_KIND   = "EDGE_RECEIVER";
static const char* BLE_NAME    = "TMONE_EDGE_RX_003";

// =======================================================
//                  RED / TCP
// =======================================================

static const char* WIFI_SSID = "TMONE_Repeat";
static const char* WIFI_PASS = "TMONE2025";

static const char* DEST_HOST = "172.20.10.2";
static constexpr uint16_t DEST_PORT = 7070;

byte ETH_MAC[] = { 0x02, 0x54, 0x4D, 0x4F, 0x4E, 0x03 };
IPAddress ETH_STATIC_IP(172, 20, 10, 53);
IPAddress ETH_DNS(172, 20, 10, 1);
IPAddress ETH_GW(172, 20, 10, 1);
IPAddress ETH_MASK(255, 255, 255, 0);

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

// LED de estado
static constexpr int PIN_LED_ST = 9;

// MicroSD SPI independiente
static constexpr int PIN_SD_MISO = 47;
static constexpr int PIN_SD_MOSI = 14;
static constexpr int PIN_SD_SCK  = 21;
static constexpr int PIN_SD_CS   = 13;

// =======================================================
//                  LORA RF
// =======================================================

static constexpr uint32_t LORA_FREQ_HZ = 433000000UL;
static constexpr int LORA_SF = 7;
static constexpr long LORA_BW = 125E3;
static constexpr int LORA_CR = 5;              // 4/5
static constexpr uint8_t LORA_SYNCWORD = 0x12;
static constexpr int LORA_TX_POWER = 14;

// =======================================================
//                  BLE LOCAL OPCIONAL
// =======================================================

static constexpr bool ENABLE_LOCAL_BLE_SCAN = false;
BLEScan* g_scan = nullptr;

// =======================================================
//                  SD / LOGS
// =======================================================

SPIClass SD_SPI(HSPI);
static bool g_sdOk = false;
static const char* LOG_PATH = "/tmone_rx_log.csv";
static const char* BUFFER_PATH = "/tmone_rx_buffer.log";

// =======================================================
//                  ESTADOS LED
// =======================================================

enum LedCode : uint8_t {
  LED_BOOT = 1,         // 1 pulso corto
  LED_OK = 2,           // 2 pulsos cortos
  LED_LORA_RX = 3,      // 1 pulso largo
  LED_NET_OK = 4,       // 2 cortos + 1 largo
  LED_ERROR_NET = 5,    // 3 cortos
  LED_ERROR_LORA = 6,   // 4 cortos
  LED_ERROR_SD = 7,     // 5 cortos
  LED_QUEUE_FULL = 8    // 6 cortos
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

static void serviceLed() {
  uint32_t now = millis();

  uint8_t pulses = 2;
  bool specialNet = false;
  bool longOnly = false;

  switch (g_ledCode) {
    case LED_BOOT: pulses = 1; break;
    case LED_OK: pulses = 2; break;
    case LED_LORA_RX: longOnly = true; pulses = 1; break;
    case LED_NET_OK: specialNet = true; pulses = 3; break;
    case LED_ERROR_NET: pulses = 3; break;
    case LED_ERROR_LORA: pulses = 4; break;
    case LED_ERROR_SD: pulses = 5; break;
    case LED_QUEUE_FULL: pulses = 6; break;
  }

  uint16_t onMs = 120;
  if (longOnly) onMs = 500;
  if (specialNet && g_ledStep == 4) onMs = 500;

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
//                  COLA DE TRAMAS
// =======================================================

static constexpr int QUEUE_CAP = 96;
static constexpr int FRAME_MAX = 260;

struct FrameItem {
  uint16_t len;
  char data[FRAME_MAX];
  uint8_t retries;
};

static FrameItem g_q[QUEUE_CAP];
static volatile int g_qHead = 0;
static volatile int g_qTail = 0;

static int qCount() {
  int c = g_qHead - g_qTail;
  if (c < 0) c += QUEUE_CAP;
  return c;
}

static bool queuePush(const String& s) {
  int nextHead = g_qHead + 1;
  if (nextHead >= QUEUE_CAP) nextHead = 0;

  if (nextHead == g_qTail) {
    ledSetCode(LED_QUEUE_FULL);
    return false;
  }

  size_t n = s.length();
  if (n >= FRAME_MAX) n = FRAME_MAX - 1;

  FrameItem& it = g_q[g_qHead];
  memcpy(it.data, s.c_str(), n);
  it.data[n] = '\0';
  it.len = n;
  it.retries = 0;

  g_qHead = nextHead;
  return true;
}

static bool queuePop(FrameItem& out) {
  if (g_qHead == g_qTail) return false;
  out = g_q[g_qTail];
  int nextTail = g_qTail + 1;
  if (nextTail >= QUEUE_CAP) nextTail = 0;
  g_qTail = nextTail;
  return true;
}

static bool queueRePush(const FrameItem& in) {
  int nextHead = g_qHead + 1;
  if (nextHead >= QUEUE_CAP) nextHead = 0;
  if (nextHead == g_qTail) return false;

  g_q[g_qHead] = in;
  g_qHead = nextHead;
  return true;
}

// =======================================================
//                  UTILIDADES / LOGS
// =======================================================

static String timestampISO() {
  char ts[32];
  snprintf(ts, sizeof(ts), "UPTIME_%lu", (unsigned long)(millis() / 1000UL));
  return String(ts);
}

static void logSerial(const char* tag, const String& msg) {
  Serial.print("["); Serial.print(tag); Serial.print("] ");
  Serial.println(msg);
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
//                  RED
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

static bool sendTcpToDest(const char* frame) {
  if (!netConnected()) {
    ledSetCode(LED_ERROR_NET);
    appendBufferFrame(String(frame));
    return false;
  }

  if (TCP_TRANSPORT == NET_ETHERNET) {
    EthernetClient client;
    if (!client.connect(DEST_HOST, DEST_PORT)) {
      ledSetCode(LED_ERROR_NET);
      appendBufferFrame(String(frame));
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
    appendBufferFrame(String(frame));
    return false;
  }
  client.println(frame);
  client.stop();
  ledSetCode(LED_NET_OK);
  return true;
}

// =======================================================
//                  LORA
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

  logSD("INFO", "LORA", "SX1278 RX OK 433MHz");
  return true;
}

static void pollLoRa() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;

  String frame;
  while (LoRa.available()) {
    char c = (char)LoRa.read();
    if (frame.length() < FRAME_MAX - 1) frame += c;
  }

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  logSD("INFO", "LORA_RX", frame + String(" | RSSI=") + rssi + " SNR=" + String(snr, 1));
  ledSetCode(LED_LORA_RX);

  if (!queuePush(frame)) {
    appendBufferFrame(frame);
    logSD("ERROR", "QUEUE", "Cola llena, frame a SD");
  }
}

// =======================================================
//                  PROCESAR COLA -> TCP
// =======================================================

static void processQueue() {
  uint32_t start = millis();
  static constexpr uint32_t TCP_BUDGET_MS = 8;

  FrameItem it;
  while (queuePop(it)) {
    if (millis() - start > TCP_BUDGET_MS) {
      queueRePush(it);
      return;
    }

    bool ok = sendTcpToDest(it.data);
    if (!ok) {
      it.retries++;
      if (it.retries <= 2) {
        queueRePush(it);
      } else {
        appendBufferFrame(String(it.data));
      }
      return;
    }

    logSD("INFO", "TCP_TX", String(it.data));
    delay(1);
  }
}

// =======================================================
//                  BLE LOCAL OPCIONAL
// =======================================================

class LocalBleCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int rssi = advertisedDevice.getRSSI();

    String frame = addr + ":BT:" + timestampISO() + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(rssi);

    queuePush(frame);
  }
};

static void initBLE() {
  if (!ENABLE_LOCAL_BLE_SCAN) return;

  BLEDevice::init(BLE_NAME);
  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new LocalBleCallbacks());
  g_scan->setActiveScan(true);
  g_scan->setInterval(50);
  g_scan->setWindow(45);
  logSD("INFO", "BLE", "BLE local listo");
}

static void pollBLE() {
  if (!ENABLE_LOCAL_BLE_SCAN || !g_scan) return;

  static uint32_t lastMs = 0;
  if (millis() - lastMs < 6000) return;
  lastMs = millis();

  g_scan->start(1, false);
  g_scan->clearResults();
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
  Serial.println("=== TMONE Telemining 2026 - Receiver ===");

  initSD();
  initLoRa();

  if (TCP_TRANSPORT == NET_ETHERNET) initEthernet();
  if (TCP_TRANSPORT == NET_WIFI) initWiFi();

  initBLE();

  logSD("INFO", "BOOT", "Setup completo");
  ledSetCode(LED_OK);
}

void loop() {
  serviceLed();

  if (TCP_TRANSPORT == NET_ETHERNET) {
    Ethernet.maintain();
  }

  if (TCP_TRANSPORT == NET_WIFI && WiFi.status() != WL_CONNECTED) {
    g_wifiOk = false;
    initWiFi();
  }

  pollLoRa();
  pollBLE();
  processQueue();

  static uint32_t lastSysMs = 0;
  if (millis() - lastSysMs > 10000) {
    lastSysMs = millis();
    logSD("INFO", "SYS", String("Queue=") + qCount() + " Heap=" + ESP.getFreeHeap());
  }

  delay(2);
}
