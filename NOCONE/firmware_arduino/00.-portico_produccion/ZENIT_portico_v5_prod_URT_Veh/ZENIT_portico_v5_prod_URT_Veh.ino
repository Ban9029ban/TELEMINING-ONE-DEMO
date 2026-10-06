/*
  ZENIT_EDGE_PROD_v1_1 + OFFLINE BUFFER (vehículo)
  - ESP32-S3 pórtico ZENIT
  - Escaneo BLE → trama ZENIT
  - Envío por WiFi al Listener/Central
  - Si NO se puede enviar: acumula por MAC (sin repetir), guarda primera y última, y count
  - Al recuperar conexión: envía first + last (y opcional summary) y limpia buffer
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
//              FLAGS DE FUNCIONALIDAD (ON/OFF)
// =======================================================

constexpr bool ENABLE_WIFI           = true;   // WiFi / TCP
constexpr bool ENABLE_BLE_SCAN       = true;   // Escaneo BLE
constexpr bool ENABLE_LORA           = false;  // Módulo LoRa (OFF)
constexpr bool ENABLE_SD_CARD        = false;  // SD card (OFF)
constexpr bool ENABLE_WATCHDOG       = false;  // Watchdog OFF (para evitar panic)
constexpr bool ENABLE_LOW_POWER_MODE = false;  // Delay más alto

// ✅ Activamos buffer offline RAM
constexpr bool ENABLE_OFFLINE_BUFFER = true;   // buffer RAM deduplicado por MAC

// =======================================================
//           IDENTIDAD DEL PÓRTICO / FORMATO TRAMA
// =======================================================

const char* PORTICO_ID  = "TMONE_TTE_003";
const char* BACKBONE_ID = "GW_BACKBONE_003";
const char* EDGE_KIND   = "EDGE_BASIC";
const char* BLE_NAME    = "TMONE_EDGE_TTE_003";

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

WifiTarget   g_wifiTarget     = WIFI_NONE;
bool         g_wifiConnected  = false;
unsigned long g_lastWiFiCheck = 0;
const unsigned long WIFI_RECHECK_MS = 30000;
uint8_t      g_wifiFailCount  = 0;

// =======================================================
//                      CONFIG NTP
// =======================================================

const char* NTP_SERVER      = "pool.ntp.org";
const long  GMT_OFFSET_SEC  = -3 * 3600;    // Chile -03
const int   DST_OFFSET_SEC  = 0;

// =======================================================
//                     CONFIG LoRa (OPCIONAL)
// =======================================================

const long   LORA_FREQUENCY   = 915E6;
const int    LORA_SS_PIN      = 5;
const int    LORA_RST_PIN     = 18;
const int    LORA_DIO0_PIN    = 26;

bool         g_loraOk        = false;
unsigned long g_lastLoRaDiag = 0;
const unsigned long LORA_DIAG_MS = 15000;

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

// =======================================================
//               OFFLINE BUFFER (RAM)
// =======================================================

// ⚠️ Ajusta según tu RAM y tasa de lectura BLE
static const uint16_t OFFLINE_MAX_DEVICES = 80;

// Cada entrada: 2 Strings (first/last) + addr + count.
// Si te preocupa memoria, te hago versión con char[] fijo.
struct OfflineEntry {
  bool   used = false;
  String addr;
  String firstFrame;
  String lastFrame;
  uint16_t count = 0;
};

OfflineEntry g_offline[OFFLINE_MAX_DEVICES];
uint16_t g_offlineUsed = 0;

int findOfflineIndexByAddr(const String& addr) {
  for (uint16_t i = 0; i < OFFLINE_MAX_DEVICES; i++) {
    if (g_offline[i].used && g_offline[i].addr == addr) return (int)i;
  }
  return -1;
}

int findFreeOfflineSlot() {
  for (uint16_t i = 0; i < OFFLINE_MAX_DEVICES; i++) {
    if (!g_offline[i].used) return (int)i;
  }
  return -1;
}

// Inserta o actualiza (sin repetir MAC):
// - primera lectura se mantiene
// - última lectura se reemplaza siempre
// - count incrementa siempre
void bufferUpsert(const String& addr, const String& frame) {
  if (!ENABLE_OFFLINE_BUFFER) return;

  int idx = findOfflineIndexByAddr(addr);
  if (idx >= 0) {
    g_offline[idx].lastFrame = frame;
    g_offline[idx].count++;
    return;
  }

  int freeIdx = findFreeOfflineSlot();
  if (freeIdx < 0) {
    // Buffer lleno: política simple -> reemplazar el más antiguo (primero encontrado)
    // (Si quieres FIFO real, lo hacemos con timestamps o ring index)
    freeIdx = 0;
  }

  g_offline[freeIdx].used = true;
  g_offline[freeIdx].addr = addr;
  g_offline[freeIdx].firstFrame = frame;
  g_offline[freeIdx].lastFrame  = frame;
  g_offline[freeIdx].count = 1;

  // recalcula g_offlineUsed (solo informativo)
  uint16_t usedCount = 0;
  for (uint16_t i = 0; i < OFFLINE_MAX_DEVICES; i++) if (g_offline[i].used) usedCount++;
  g_offlineUsed = usedCount;
}

void bufferClearAll() {
  for (uint16_t i = 0; i < OFFLINE_MAX_DEVICES; i++) {
    g_offline[i].used = false;
    g_offline[i].addr = "";
    g_offline[i].firstFrame = "";
    g_offline[i].lastFrame = "";
    g_offline[i].count = 0;
  }
  g_offlineUsed = 0;
}

// =======================================================
//                  FUNCIONES AUXILIARES
// =======================================================

String getTimestampISO() {
  struct tm timeinfo;
  char ts[30];

  if (getLocalTime(&timeinfo)) {
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    return String(ts);
  } else {
    return String("1970-01-01T00:00:00");
  }
}

void logToSerialLine(const char* tag, const String& msg) {
  Serial.print("[");
  Serial.print(tag);
  Serial.print("] ");
  Serial.println(msg);
}

// =======================================================
//                    SD / CONFIG (OFF por defecto)
// =======================================================

void sdAppendLine(const char* path, const String& line) {
  if (!ENABLE_SD_CARD || !g_sdOk) return;
  File f = SD.open(path, FILE_APPEND);
  if (!f) {
    logToSerialLine("SD", String("No se pudo abrir para append: ") + path);
    return;
  }
  f.println(line);
  f.close();
}

void sdLoadConfig() {
  if (!ENABLE_SD_CARD || !g_sdOk) return;

  if (!SD.exists(SD_CONFIG_PATH)) {
    logToSerialLine("SD", String("No existe archivo de config: ") + SD_CONFIG_PATH);
    return;
  }

  File f = SD.open(SD_CONFIG_PATH, FILE_READ);
  if (!f) {
    logToSerialLine("SD", "Error al abrir config para lectura.");
    return;
  }

  logToSerialLine("SD", "=== Contenido de zenit.cfg ===");
  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    Serial.println(line);
  }
  logToSerialLine("SD", "=== Fin de zenit.cfg ===");
  f.close();
}

void initSD() {
  if (!ENABLE_SD_CARD) {
    logToSerialLine("SD", "Deshabilitada por configuración.");
    return;
  }

  logToSerialLine("SD", "Inicializando SD...");
  if (!SD.begin(SD_CS_PIN)) {
    logToSerialLine("SD", "ERROR: SD.begin() falló.");
    g_sdOk = false;
    return;
  }

  uint64_t cardSize = SD.cardSize() / (1024 * 1024);
  logToSerialLine("SD", String("SD OK. Tamaño: ") + cardSize + " MB");
  g_sdOk = true;

  sdLoadConfig();
}

// =======================================================
//                      LoRa (OPCIONAL)
// =======================================================

void initLoRa() {
  if (!ENABLE_LORA) {
    logToSerialLine("LORA", "Deshabilitado por configuración.");
    return;
  }

  logToSerialLine("LORA", "Inicializando LoRa...");
  SPI.begin();
  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);

  bool ok = false;
  for (int i = 0; i < 3; i++) {
    if (LoRa.begin(LORA_FREQUENCY)) {
      ok = true;
      break;
    }
    logToSerialLine("LORA", "LoRa.begin() falló, reintentando...");
    delay(500);
  }

  if (!ok) {
    logToSerialLine("LORA", "ERROR: No se pudo inicializar LoRa. Continuamos sin LoRa.");
    g_loraOk = false;
    return;
  }

  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setTxPower(14);
  g_loraOk = true;

  logToSerialLine("LORA", "LoRa OK @915MHz.");
}

void sendLoRaDiag() {
  if (!ENABLE_LORA || !g_loraOk) return;

  String msg = String("ZENIT_DIAG ") + PORTICO_ID + " " + getTimestampISO();
  logToSerialLine("LORA", String("TX: ") + msg);

  LoRa.beginPacket();
  LoRa.print(msg);
  LoRa.endPacket();
}

// Envío LoRa “frame” (si lo activas más adelante)
bool sendFrameLoRa(const String& frame) {
  if (!ENABLE_LORA || !g_loraOk) return false;

  // Ojo: LoRa tiene MTU chica; si tu frame es largo, hay que fragmentar.
  // Por ahora, enviamos tal cual (ideal para tramas cortas).
  LoRa.beginPacket();
  LoRa.print(frame);
  bool ok = (LoRa.endPacket() == 1);
  return ok;
}

// =======================================================
//                        WIFI
// =======================================================

bool connectWiFiTo(const char* ssid, const char* pass, WifiTarget target) {
  logToSerialLine("NET", String("Conectando a WiFi: ") + ssid);

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(500);

  WiFi.begin(ssid, pass);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
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
      delay(300);
    }

    if (ntp_ok) logToSerialLine("NET", "Hora NTP sincronizada.");
    else        logToSerialLine("NET", "No se pudo obtener hora NTP (seguimos igual).");

    return true;
  } else {
    g_wifiConnected = false;
    logToSerialLine("NET", "ERROR: no se pudo conectar a WiFi.");
    return false;
  }
}

void connectInitialWiFi() {
  if (!ENABLE_WIFI) {
    logToSerialLine("NET", "WiFi deshabilitada por configuración.");
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

void checkWiFiReconnection() {
  if (!ENABLE_WIFI) return;

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    return;
  }

  g_wifiConnected = false;
  g_wifiFailCount++;
  logToSerialLine("NET", "WiFi caída. Probando reconexión...");

  bool reconnected = false;

  if (g_wifiTarget == WIFI_TARGET_CENTRAL) {
    reconnected = connectWiFiTo(WIFI_SSID_CENTRAL, WIFI_PASS_CENTRAL, WIFI_TARGET_CENTRAL);
    if (!reconnected) {
      logToSerialLine("NET", "Reconexión CENTRAL falló, probando LISTENER...");
      reconnected = connectWiFiTo(WIFI_SSID_LISTENER, WIFI_PASS_LISTENER, WIFI_TARGET_LISTENER);
    }
  } else if (g_wifiTarget == WIFI_TARGET_LISTENER) {
    reconnected = connectWiFiTo(WIFI_SSID_LISTENER, WIFI_PASS_LISTENER, WIFI_TARGET_LISTENER);
    if (!reconnected) {
      logToSerialLine("NET", "Reconexión LISTENER falló, probando CENTRAL...");
      reconnected = connectWiFiTo(WIFI_SSID_CENTRAL, WIFI_PASS_CENTRAL, WIFI_TARGET_CENTRAL);
    }
  } else {
    connectInitialWiFi();
    reconnected = (WiFi.status() == WL_CONNECTED);
  }

  // ✅ si reconectó, intentamos flush
  if (reconnected && ENABLE_OFFLINE_BUFFER) {
    logToSerialLine("BUF", "WiFi reconectado: intentando vaciar buffer offline...");
    // flush se llama en loop para no bloquear demasiado; aquí sólo avisamos
  }
}

// =======================================================
//                 ENVÍO DE FRAMES (WiFi/LoRa)
// =======================================================

// Ahora devuelve bool
bool sendFrameTCP(const String& frame) {
  if (!ENABLE_WIFI) return false;

  if (!g_wifiConnected || WiFi.status() != WL_CONNECTED) {
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
    return false;
  }

  WiFiClient client;

  if (!client.connect(host, port)) {
    return false;
  }

  client.println(frame);
  client.flush();
  delay(5);
  client.stop();

  return true;
}

// Envío genérico: intenta WiFi; si falla y LoRa está ON, intenta LoRa.
bool sendFrameAny(const String& frame) {
  if (ENABLE_WIFI) {
    if (sendFrameTCP(frame)) return true;
  }
  if (ENABLE_LORA) {
    if (sendFrameLoRa(frame)) return true;
  }
  return false;
}

// =======================================================
//                 FLUSH OFFLINE BUFFER
// =======================================================

bool flushOfflineBuffer() {
  if (!ENABLE_OFFLINE_BUFFER) return true;

  // Si no hay conectividad real, no hacemos nada
  bool canSend = false;
  if (ENABLE_WIFI && g_wifiConnected && WiFi.status() == WL_CONNECTED) canSend = true;
  if (ENABLE_LORA && g_loraOk) canSend = true;
  if (!canSend) return false;

  uint16_t sentItems = 0;
  for (uint16_t i = 0; i < OFFLINE_MAX_DEVICES; i++) {
    if (!g_offline[i].used) continue;

    // Enviar primera
    bool ok1 = sendFrameAny(g_offline[i].firstFrame);

    // Enviar última si es distinta
    bool ok2 = true;
    if (g_offline[i].lastFrame != g_offline[i].firstFrame) {
      ok2 = sendFrameAny(g_offline[i].lastFrame);
    }

    // (Opcional) Enviar summary compacta por MAC
    // Formato: MAC:SUM:ts:BACKBONE:EDGE:PORTICO:COUNT
    // Solo si quieres trazabilidad de “hubo N lecturas”.
    // String sum = g_offline[i].addr + ":SUM:" + getTimestampISO() + ":" + BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(g_offline[i].count);
    // bool ok3 = sendFrameAny(sum);

    if (ok1 && ok2) {
      g_offline[i].used = false;
      g_offline[i].addr = "";
      g_offline[i].firstFrame = "";
      g_offline[i].lastFrame = "";
      g_offline[i].count = 0;
      sentItems++;
    } else {
      // Si falla enviar una entrada, cortamos para no spamear reconexiones/colas
      logToSerialLine("BUF", "Fallo flush: se mantiene buffer para reintento.");
      break;
    }
  }

  // recalcula contador
  uint16_t usedCount = 0;
  for (uint16_t i = 0; i < OFFLINE_MAX_DEVICES; i++) if (g_offline[i].used) usedCount++;
  g_offlineUsed = usedCount;

  if (sentItems > 0) {
    logToSerialLine("BUF", String("Flush OK. Entradas enviadas: ") + sentItems + " | Pendientes: " + g_offlineUsed);
  }

  return (g_offlineUsed == 0);
}

// =======================================================
//                  CALLBACK BLE
// =======================================================

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {

    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int    rssi = advertisedDevice.getRSSI();
    String ts   = getTimestampISO();

    String frame = addr + ":BT:" + ts + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(rssi);

    // Siempre a Serial
    Serial.println(frame);

    // Intentar enviar por red (WiFi/LoRa)
    bool sent = sendFrameAny(frame);

    // Si falla, guardamos offline (deduplicado por MAC; guardamos first y last)
    if (!sent && ENABLE_OFFLINE_BUFFER) {
      bufferUpsert(addr, frame);
      logToSerialLine("BUF", String("Offline add/upd: ") + addr + " | count=" + String(g_offlineUsed) + " devices");
    }
  }
};

// =======================================================
//                       SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== ZENIT EDGE PROD v1.1 + OfflineBuffer - Vehiculo ===");
  Serial.printf("Pórtico ID   : %s\n", PORTICO_ID);
  Serial.printf("Backbone ID  : %s\n", BACKBONE_ID);
  Serial.printf("Edge kind    : %s\n", EDGE_KIND);

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

  initSD();

  connectInitialWiFi();

  if (ENABLE_BLE_SCAN) {
    logToSerialLine("BLE", "Inicializando BLE...");
    BLEDevice::init(BLE_NAME);

    g_scan = BLEDevice::getScan();
    g_scan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
    g_scan->setActiveScan(true);
    g_scan->setInterval(50);
    g_scan->setWindow(45);

    logToSerialLine("BLE", "Escaneo listo (loop infinito).");
  } else {
    logToSerialLine("BLE", "Deshabilitado por configuración.");
  }

  initLoRa();

  if (ENABLE_OFFLINE_BUFFER) {
    logToSerialLine("BUF", String("Offline buffer ON. Max devices = ") + OFFLINE_MAX_DEVICES);
  }

  Serial.println("=== SETUP COMPLETO ===");
}

// =======================================================
//                        LOOP
// =======================================================

void loop() {
  unsigned long now = millis();

  if (ENABLE_WATCHDOG) {
    esp_task_wdt_reset();
  }

  // Revisión WiFi periódica
  if (ENABLE_WIFI && (now - g_lastWiFiCheck) > WIFI_RECHECK_MS) {
    g_lastWiFiCheck = now;
    checkWiFiReconnection();
  }

  // Intentar vaciar buffer en cada loop si hay conectividad
  // (pero sin bloquear: flush hace “lo que puede” y corta si falla)
  if (ENABLE_OFFLINE_BUFFER) {
    flushOfflineBuffer();
  }

  // Escaneo BLE
  if (ENABLE_BLE_SCAN && g_scan) {
    g_scan->start(1 /*seg*/, false);
    g_scan->clearResults();
  }

  // Diag LoRa
  if (ENABLE_LORA && g_loraOk && (now - g_lastLoRaDiag) > LORA_DIAG_MS) {
    g_lastLoRaDiag = now;
    sendLoRaDiag();
  }

  if (ENABLE_LOW_POWER_MODE) delay(50);
  else delay(10);
}
