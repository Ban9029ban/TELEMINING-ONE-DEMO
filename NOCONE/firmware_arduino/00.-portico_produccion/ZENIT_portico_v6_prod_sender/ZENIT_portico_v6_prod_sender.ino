/* 
  ZENIT_EDGE_PROD_v1_1  (FIX TX LoRa REAL con BLE + TIMESLOT)
  - ESP32-S3 pórtico ZENIT
  - Escaneo BLE → trama ZENIT
  - Envío por LoRa (por defecto)
  - WiFi/TCP opcional según modo
  - SD deshabilitada
  - Watchdog desactivado por defecto
  - Anti-colisión: timeslot robusto
  - SIN esperas > 100ms (serviceLoRaTx no bloquea más de 100ms)

  MOD (prueba 2 pórticos, sin cambiar trama):
  - TIMESLOT: PERIOD 200ms / WINDOW 40ms (más throughput; menos choques)
  - OFFSET dinámico por PORTICO_ID:
      ..._001 => 50ms
      ..._002 => 100ms
      ..._003 => 150ms
      ..._004 => 200ms
  - WAIT_BUDGET 60ms (<= 100ms)
  - Mantiene el buffer único g_loraPending (no es cola larga)
*/

#include <WiFi.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <time.h>
#include <SPI.h>
#include <LoRa.h>
#include <SD.h>
#include "esp_task_wdt.h"

// =======================================================
//              MODO DE ENVÍO
// =======================================================

enum SendMode : uint8_t {
  LORA_ONLY = 0,
  WIFI_ONLY = 1,
  BOTH      = 2
};

constexpr SendMode SEND_MODE = LORA_ONLY;
constexpr bool WIFI_ONLY_FALLBACK_TO_LORA = true;

// =======================================================
//      ANTI-COLISIÓN (JITTER / TIMESLOT)
// =======================================================

constexpr bool LORA_USE_JITTER = false;
constexpr uint32_t JITTER_MIN_MS = 20;
constexpr uint32_t JITTER_MAX_MS = 150;

// Timeslot (ON)
constexpr bool LORA_USE_TIMESLOT = true;

// >>>>>> AJUSTE PARA 2 PÓRTICOS (throughput alto) <<<<<<
constexpr uint32_t PERIOD_MS = 200;
constexpr uint32_t WINDOW_MS = 40;

// (ANTES: constexpr uint32_t TIMESLOT_OFFSET_MS = 150;)
// AHORA: offset dinámico por PORTICO_ID (se calcula en setup)
static uint32_t g_timeslotOffsetMs = 0;

// =======================================================
//              FLAGS DE FUNCIONALIDAD
// =======================================================

constexpr bool ENABLE_BLE_SCAN       = true;
constexpr bool ENABLE_SD_CARD        = false;
constexpr bool ENABLE_WATCHDOG       = false;
constexpr bool ENABLE_LOW_POWER_MODE = false;
constexpr bool ENABLE_OFFLINE_BUFFER = false;

constexpr bool ENABLE_LORA = (SEND_MODE == LORA_ONLY || SEND_MODE == BOTH || (SEND_MODE == WIFI_ONLY && WIFI_ONLY_FALLBACK_TO_LORA));
constexpr bool ENABLE_WIFI = (SEND_MODE == WIFI_ONLY || SEND_MODE == BOTH);

// =======================================================
//           IDENTIDAD DEL PÓRTICO / FORMATO TRAMA
// =======================================================

const char* PORTICO_ID  = "TMONE_TTE_001";
const char* BACKBONE_ID = "GW_BACKBONE_001";
const char* EDGE_KIND   = "EDGE_BASIC";
const char* BLE_NAME    = "TMONE_EDGE_TTE_001";

// =======================================================
//                   CONFIG WIFI / TCP
// =======================================================

const char* WIFI_SSID_CENTRAL = "TMONE_URT";
const char* WIFI_PASS_CENTRAL = "TMONE2025";

const char* WIFI_SSID_LISTENER = "TMONE_Repeat";
const char* WIFI_PASS_LISTENER = "TMONE2025";

const char* CENTRAL_API_HOST     = "172.20.10.3";
const uint16_t CENTRAL_API_PORT  = 8080;

const char* LISTENER_HOST        = "172.20.10.2";
const uint16_t LISTENER_PORT     = 7070;

enum WifiTarget {
  WIFI_NONE = 0,
  WIFI_TARGET_CENTRAL,
  WIFI_TARGET_LISTENER
};

WifiTarget    g_wifiTarget     = WIFI_NONE;
bool          g_wifiConnected  = false;
unsigned long g_lastWiFiCheck  = 0;
const unsigned long WIFI_RECHECK_MS = 30000;
uint8_t       g_wifiFailCount  = 0;

// =======================================================
//                      CONFIG NTP
// =======================================================

const char* NTP_SERVER      = "pool.ntp.org";
const long  GMT_OFFSET_SEC  = -3 * 3600;
const int   DST_OFFSET_SEC  = 0;

// =======================================================
//                     CONFIG LoRa (PINES REALES)
// =======================================================

static constexpr uint32_t LORA_FREQUENCY = 915000000UL;

const int    LORA_SCK_PIN     = 12;
const int    LORA_MISO_PIN    = 13;
const int    LORA_MOSI_PIN    = 11;

const int    LORA_SS_PIN      = 16;
const int    LORA_RST_PIN     = 15;
const int    LORA_DIO0_PIN    = 38;

bool          g_loraOk        = false;
unsigned long g_lastLoRaDiag  = 0;

// DIAG rápido para prueba
const unsigned long LORA_DIAG_MS = 2000;

// Ajustes RF (DEBEN MATCH con receiver)
constexpr int     LORA_SF = 7;
constexpr long    LORA_BW = 125E3;
constexpr uint8_t LORA_SYNCWORD = 0x12;

// =======================================================
//                     CONFIG SD (DESACTIVADA)
// =======================================================

const int SD_CS_PIN = 10;
bool g_sdOk = false;
const char* SD_CONFIG_PATH  = "/zenit.cfg";
const char* SD_BUFFER_PATH  = "/buffer.log";

// =======================================================
//                      BLE GLOBAL
// =======================================================

BLEScan* g_scan = nullptr;

// BLE throttled (no bloquear cada loop)
static uint32_t g_lastBleScanMs = 0;
static constexpr uint32_t BLE_SCAN_EVERY_MS = 3000;
static constexpr uint32_t BLE_SCAN_SECONDS  = 1;

// =======================================================
//          PENDIENTE LoRa (TIMESLOT) (buffer único)
// =======================================================
static bool   g_loraPending = false;
static char   g_loraPendingBuf[260];
static size_t g_loraPendingLen = 0;

// =======================================================
//          REAL-TIME: límite de espera <= 100ms
// =======================================================
// Para 2 pórticos: 60ms funciona bien (<=100ms)
static constexpr uint32_t LORA_TX_WAIT_BUDGET_MS = 60;

// =======================================================
// Logs
// =======================================================

static void logToSerialLine(const char* tag, const String& msg) {
  Serial.print("[");
  Serial.print(tag);
  Serial.print("] ");
  Serial.println(msg);
}

static String getTimestampISO() {
  struct tm timeinfo;
  char ts[30];

  if (getLocalTime(&timeinfo)) {
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    return String(ts);
  } else {
    return String("1970-01-01T00:00:00");
  }
}

// =======================================================
//      OFFSET DINÁMICO POR PORTICO_ID (001->50,002->100,...)
// =======================================================
static uint32_t computeOffsetFromPorticoId(const char* id) {
  if (!id || !id[0]) return 0;
  int n = (int)strlen(id);

  for (int i = n - 1; i >= 0; i--) {
    char c = id[i];
    if (c >= '0' && c <= '9') {
      int d = c - '0';
      if (d == 1) return 50;
      if (d == 2) return 100;
      if (d == 3) return 150;
      if (d == 4) return 200;
      return 0;
    }
  }
  return 0;
}

// =======================================================
//                      LoRa (TX)
// =======================================================

static bool loraInWindow(uint32_t nowMs) {
  // usa offset dinámico
  return (((nowMs + g_timeslotOffsetMs) % PERIOD_MS) < WINDOW_MS);
}

static void loraMaybeJitter() {
  if (!LORA_USE_JITTER) return;
  uint32_t d = random(JITTER_MIN_MS, JITTER_MAX_MS + 1);
  delay(d);
}

static bool sendFrameLoRaNow(const char* s, size_t n) {
  if (!ENABLE_LORA) return false;
  if (!g_loraOk) {
    logToSerialLine("LORA", "No OK aún, no se envía.");
    return false;
  }
  if (n == 0) return false;

  // Timeslot: permitir solo si toca
  if (LORA_USE_TIMESLOT) {
    if (!loraInWindow(millis())) {
      return false;
    }
  }

  loraMaybeJitter();

  LoRa.beginPacket();
  LoRa.write((const uint8_t*)s, n);
  LoRa.endPacket();

  return true;
}

static void enqueueLoRaFrame(const String& frame) {
  // OJO: NO es cola larga; es buffer único (sobrescribe lo anterior)
  size_t n = frame.length();
  if (n >= sizeof(g_loraPendingBuf)) n = sizeof(g_loraPendingBuf) - 1;
  memcpy(g_loraPendingBuf, frame.c_str(), n);
  g_loraPendingBuf[n] = 0;
  g_loraPendingLen = n;
  g_loraPending = true;

  // Log explícito: "pendiente" (no significa TX aún)
  logToSerialLine("LORA", String("PENDING len=") + String(g_loraPendingLen) + " -> " + String(g_loraPendingBuf));
}

/*
  REAL TIME service:
  - Nunca bloquea más de LORA_TX_WAIT_BUDGET_MS (<=100ms)
  - Si no está en ventana, espera poquito; si no alcanza, sale y reintenta en el siguiente loop
*/
static void serviceLoRaTx() {
  if (!ENABLE_LORA || !g_loraOk) return;
  if (!g_loraPending) return;

  // Si timeslot OFF => manda ya
  if (!LORA_USE_TIMESLOT) {
    logToSerialLine("LORA", String("TX (frame): ") + String(g_loraPendingBuf));
    bool ok = sendFrameLoRaNow(g_loraPendingBuf, g_loraPendingLen);
    if (ok) {
      logToSerialLine("LORA", "Trama enviada OK.");
      g_loraPending = false;
    }
    return;
  }

  // Timeslot ON => intenta entrar a ventana con presupuesto limitado
  uint32_t start = millis();
  while (!loraInWindow(millis())) {
    delay(2);
    if (millis() - start >= LORA_TX_WAIT_BUDGET_MS) {
      // no alcanzó ventana en este loop (queda pendiente para el próximo loop)
      return;
    }
  }

  // Estamos en ventana => TX
  logToSerialLine("LORA", String("TX (frame): ") + String(g_loraPendingBuf));
  bool ok = sendFrameLoRaNow(g_loraPendingBuf, g_loraPendingLen);
  if (ok) {
    logToSerialLine("LORA", "Trama enviada OK.");
    g_loraPending = false;
  }
}

static void initLoRa() {
  if (!ENABLE_LORA) {
    logToSerialLine("LORA", "Deshabilitado por modo.");
    return;
  }

  logToSerialLine("LORA", "Inicializando LoRa...");
  Serial.printf("[LORA] SPI pins: SCK=%d MISO=%d MOSI=%d NSS=%d RST=%d DIO0=%d\n",
                LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);

  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN);
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);

  bool ok = false;
  for (int i = 0; i < 5; i++) {
    logToSerialLine("LORA", String("LoRa.begin intento #") + i);
    if (LoRa.begin((long)LORA_FREQUENCY)) { ok = true; break; }
    delay(300);
  }

  if (!ok) {
    logToSerialLine("LORA", "ERROR: No se pudo inicializar LoRa. Continuamos sin LoRa.");
    g_loraOk = false;
    return;
  }

  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setSyncWord(LORA_SYNCWORD);
  LoRa.enableCrc();
  LoRa.setTxPower(14);

  g_loraOk = true;
  randomSeed((uint32_t)esp_random());

  Serial.printf("[LORA] OK @%.1fMHz | SF=%d | BW=%ld | SYNC=0x%02X | TIMESLOT=%s (PERIOD=%lu OFFSET=%lu WIN=%lu) | WAIT_BUDGET=%lums\n",
                (double)LORA_FREQUENCY / 1e6,
                LORA_SF, (long)LORA_BW, (unsigned)LORA_SYNCWORD,
                LORA_USE_TIMESLOT ? "ON" : "OFF",
                (unsigned long)PERIOD_MS,
                (unsigned long)g_timeslotOffsetMs,
                (unsigned long)WINDOW_MS,
                (unsigned long)LORA_TX_WAIT_BUDGET_MS);
}

static void sendLoRaDiag() {
  if (!ENABLE_LORA || !g_loraOk) return;

  String msg = String("ZENIT_DIAG ") + PORTICO_ID + " " + getTimestampISO();
  logToSerialLine("LORA", String("DIAG GEN: ") + msg);

  enqueueLoRaFrame(msg);
}

// =======================================================
//                        WIFI
// =======================================================

static bool connectWiFiTo(const char* ssid, const char* pass, WifiTarget target) {
  logToSerialLine("NET", String("Conectando a WiFi: ") + ssid);

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(300);

  WiFi.begin(ssid, pass);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 25) {
    delay(400);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    g_wifiTarget = target;
    g_wifiFailCount = 0;

    logToSerialLine("NET", String("WiFi OK. IP: ") + WiFi.localIP().toString());

    logToSerialLine("NET", "Configurando NTP...");
    configTime(GMT_OFFSET_SEC, DST_OFFSET_SEC, NTP_SERVER);

    struct tm timeinfo;
    bool ntp_ok = false;
    for (int i = 0; i < 10; i++) {
      if (getLocalTime(&timeinfo)) { ntp_ok = true; break; }
      delay(250);
    }

    logToSerialLine("NET", ntp_ok ? "Hora NTP sincronizada." : "No se pudo obtener hora NTP (seguimos igual).");
    return true;
  }

  g_wifiConnected = false;
  logToSerialLine("NET", "ERROR: no se pudo conectar a WiFi.");
  return false;
}

static void connectInitialWiFi() {
  if (!ENABLE_WIFI) {
    logToSerialLine("NET", "WiFi deshabilitada por modo.");
    g_wifiConnected = false;
    g_wifiTarget = WIFI_NONE;
    return;
  }

  if (strlen(WIFI_SSID_CENTRAL) > 0 &&
      connectWiFiTo(WIFI_SSID_CENTRAL, WIFI_PASS_CENTRAL, WIFI_TARGET_CENTRAL)) {
    logToSerialLine("NET", "Conectado a CENTRAL.");
    return;
  }

  if (connectWiFiTo(WIFI_SSID_LISTENER, WIFI_PASS_LISTENER, WIFI_TARGET_LISTENER)) {
    logToSerialLine("NET", "Conectado a LISTENER.");
    return;
  }

  logToSerialLine("NET", "No se pudo conectar a CENTRAL ni LISTENER. Seguimos offline.");
}

static void checkWiFiReconnection() {
  if (!ENABLE_WIFI) return;

  if (WiFi.status() == WL_CONNECTED) { g_wifiConnected = true; return; }

  g_wifiConnected = false;
  g_wifiFailCount++;
  logToSerialLine("NET", "WiFi caída. Probando reconexión...");

  if (g_wifiTarget == WIFI_TARGET_CENTRAL) {
    if (!connectWiFiTo(WIFI_SSID_CENTRAL, WIFI_PASS_CENTRAL, WIFI_TARGET_CENTRAL)) {
      logToSerialLine("NET", "Reconexión CENTRAL falló, probando LISTENER...");
      connectWiFiTo(WIFI_SSID_LISTENER, WIFI_PASS_LISTENER, WIFI_TARGET_LISTENER);
    }
  } else if (g_wifiTarget == WIFI_TARGET_LISTENER) {
    if (!connectWiFiTo(WIFI_SSID_LISTENER, WIFI_PASS_LISTENER, WIFI_TARGET_LISTENER)) {
      logToSerialLine("NET", "Reconexión LISTENER falló, probando CENTRAL...");
      connectWiFiTo(WIFI_SSID_CENTRAL, WIFI_PASS_CENTRAL, WIFI_TARGET_CENTRAL);
    }
  } else {
    connectInitialWiFi();
  }
}

// =======================================================
//                 ENVÍO DE FRAMES TCP (OK/FAIL)
// =======================================================

static bool sendFrameTCP(const String& frame) {
  if (!ENABLE_WIFI) {
    logToSerialLine("TCP", "WiFi deshabilitada, no se envía.");
    return false;
  }

  if (!g_wifiConnected || WiFi.status() != WL_CONNECTED) {
    logToSerialLine("TCP", "Sin WiFi, NO se envía.");
    return false;
  }

  const char* host = nullptr;
  uint16_t    port = 0;

  if (g_wifiTarget == WIFI_TARGET_CENTRAL) {
    host = CENTRAL_API_HOST;
    port = CENTRAL_API_PORT;
  } else if (g_wifiTarget == WIFI_TARGET_LISTENER) {
    host = LISTENER_HOST;
    port = LISTENER_PORT;
  } else {
    logToSerialLine("TCP", "No hay target definido, no se envía.");
    return false;
  }

  WiFiClient client;
  Serial.printf("[TCP] Conectando a %s:%d...\n", host, port);

  if (!client.connect(host, port)) {
    logToSerialLine("TCP", "ERROR al conectar.");
    return false;
  }

  client.println(frame);
  client.flush();
  delay(5);
  client.stop();

  logToSerialLine("TCP", "Trama enviada OK.");
  return true;
}

// =======================================================
//      FUNCIÓN UNIFICADA: ENVÍA LA MISMA TRAMA POR MODO
// =======================================================

static void sendFrameUnified(const String& frame) {
  bool tcpOk = false;

  if (SEND_MODE == WIFI_ONLY || SEND_MODE == BOTH) {
    tcpOk = sendFrameTCP(frame);
  }

  if (SEND_MODE == LORA_ONLY) {
    enqueueLoRaFrame(frame);   // buffer único (sobrescribe)
    return;
  }

  if (SEND_MODE == BOTH) {
    if (!tcpOk) {
      logToSerialLine("MUX", "TCP falló -> fallback LoRa");
      enqueueLoRaFrame(frame);
    } else {
      // si quieres que BOTH mande SIEMPRE LoRa además de TCP, descomenta:
      // enqueueLoRaFrame(frame);
    }
    return;
  }

  if (SEND_MODE == WIFI_ONLY && WIFI_ONLY_FALLBACK_TO_LORA) {
    if (!tcpOk) {
      logToSerialLine("MUX", "WIFI_ONLY: TCP falló -> fallback LoRa (habilitado)");
      enqueueLoRaFrame(frame);
    }
  }
}

// =======================================================
//                  CALLBACK BLE
// =======================================================

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int    rssi = advertisedDevice.getRSSI();
    String ts   = getTimestampISO();

    // >>>>>> TRAMA SE MANTIENE IGUAL <<<<<<
    String frame = addr + ":BT:" + ts + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(rssi);

    Serial.println(frame);
    sendFrameUnified(frame);
  }
};

// =======================================================
//                       SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== ZENIT EDGE PROD v1.1 - SENDER (BLE + LoRa/WiFi + anti-collision) ===");
  Serial.printf("Pórtico ID   : %s\n", PORTICO_ID);
  Serial.printf("Backbone ID  : %s\n", BACKBONE_ID);
  Serial.printf("Edge kind    : %s\n", EDGE_KIND);

  // OFFSET dinámico por PORTICO_ID
  g_timeslotOffsetMs = computeOffsetFromPorticoId(PORTICO_ID);
  Serial.printf("[CFG] TIMESLOT dynamic offset = %lu ms (from PORTICO_ID)\n", (unsigned long)g_timeslotOffsetMs);

  Serial.printf("SEND_MODE    : %s\n",
    (SEND_MODE == LORA_ONLY) ? "LORA_ONLY" :
    (SEND_MODE == WIFI_ONLY) ? "WIFI_ONLY" : "BOTH"
  );

  if (ENABLE_WATCHDOG) {
    esp_task_wdt_config_t wdt_config = {
      .timeout_ms     = 30000,
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
      .trigger_panic  = true
    };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);
    logToSerialLine("WDT", "Watchdog habilitado (30s).");
  } else {
    logToSerialLine("WDT", "Watchdog deshabilitado.");
  }

  connectInitialWiFi();
  initLoRa();

  if (ENABLE_BLE_SCAN) {
    logToSerialLine("BLE", "Inicializando BLE...");
    BLEDevice::init(BLE_NAME);

    g_scan = BLEDevice::getScan();
    g_scan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
    g_scan->setActiveScan(true);
    g_scan->setInterval(50);
    g_scan->setWindow(45);

    logToSerialLine("BLE", "Escaneo listo (THROTTLED).");
  } else {
    logToSerialLine("BLE", "Deshabilitado por configuración.");
  }

  Serial.println("=== SETUP COMPLETO ===");
}

// =======================================================
//                        LOOP
// =======================================================

void loop() {
  unsigned long now = millis();

  if (ENABLE_WATCHDOG) esp_task_wdt_reset();

  if (ENABLE_WIFI && (now - g_lastWiFiCheck) > WIFI_RECHECK_MS) {
    g_lastWiFiCheck = now;
    checkWiFiReconnection();
  }

  // BLE scan throttled
  if (ENABLE_BLE_SCAN && g_scan) {
    if (now - g_lastBleScanMs >= BLE_SCAN_EVERY_MS) {
      g_lastBleScanMs = now;
      g_scan->start((int)BLE_SCAN_SECONDS, false);
      g_scan->clearResults();
    }
  }

  // LoRa TX service (<= 60ms de espera máxima)
  serviceLoRaTx();

  // Diag por LoRa
  if (ENABLE_LORA && g_loraOk && (now - g_lastLoRaDiag) > LORA_DIAG_MS) {
    g_lastLoRaDiag = now;
    sendLoRaDiag();
  }

  delay(ENABLE_LOW_POWER_MODE ? 50 : 10);
}
