/*
  ZENIT_EDGE_PROD_v1_1
  - ESP32-S3 pórtico ZENIT
  - Escaneo BLE → trama ZENIT
  - Envío por WiFi al Listener (y/o Central si se configura)
  - LoRa / SD deshabilitados por defecto
  - Watchdog DESACTIVADO para evitar Guru mientras ajustamos WiFi
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

// Producción básica: sólo WiFi + BLE → Listener
constexpr bool ENABLE_WIFI           = true;   // WiFi / TCP
constexpr bool ENABLE_BLE_SCAN       = true;   // Escaneo BLE
constexpr bool ENABLE_LORA           = false;  // Módulo LoRa (OFF)
constexpr bool ENABLE_SD_CARD        = false;  // SD card (OFF)
constexpr bool ENABLE_WATCHDOG       = false;  // Watchdog OFF (para evitar panic)
constexpr bool ENABLE_LOW_POWER_MODE = false;  // Delay más alto
constexpr bool ENABLE_OFFLINE_BUFFER = false;  // OFF (no usamos SD)

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

// WiFi principal (Central URT) – opcional
const char* WIFI_SSID_CENTRAL = "TMONE_URT";
const char* WIFI_PASS_CENTRAL = "TMONE2025";

// WiFi secundaria: la REAL donde corre tu listener
const char* WIFI_SSID_LISTENER = "TMONE_Repeat";
const char* WIFI_PASS_LISTENER = "TMONE2025";

// Endpoints
const char* CENTRAL_API_HOST     = "172.20.10.3"; // URT / opcional
const uint16_t CENTRAL_API_PORT  = 8080;

const char* LISTENER_HOST        = "172.20.10.2";   // real
const uint16_t LISTENER_PORT     = 7070;

// Estado WiFi
enum WifiTarget {
  WIFI_NONE = 0,
  WIFI_TARGET_CENTRAL,
  WIFI_TARGET_LISTENER
};

WifiTarget   g_wifiTarget     = WIFI_NONE;
bool         g_wifiConnected  = false;
unsigned long g_lastWiFiCheck = 0;
const unsigned long WIFI_RECHECK_MS = 30000;  // 30s entre reintentos
uint8_t      g_wifiFailCount  = 0;

// =======================================================
//                      CONFIG NTP
// =======================================================

const char* NTP_SERVER      = "pool.ntp.org";
const long  GMT_OFFSET_SEC  = -3 * 3600;    // Chile -03
const int   DST_OFFSET_SEC  = 0;

// =======================================================
//                     CONFIG LoRa (NO usada por defecto)
// =======================================================

const long   LORA_FREQUENCY   = 915E6;
const int    LORA_SS_PIN      = 5;    // NSS
const int    LORA_RST_PIN     = 18;   // RST
const int    LORA_DIO0_PIN    = 26;   // DIO0

bool         g_loraOk        = false;
unsigned long g_lastLoRaDiag = 0;
const unsigned long LORA_DIAG_MS = 15000; // 15s

// =======================================================
//                     CONFIG SD (DESACTIVADA)
// =======================================================

const int SD_CS_PIN = 10;   // ejemplo
bool g_sdOk = false;
const char* SD_CONFIG_PATH  = "/zenit.cfg";
const char* SD_BUFFER_PATH  = "/buffer.log";

// =======================================================
//                      BLE GLOBAL
// =======================================================

BLEScan* g_scan = nullptr;

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

  // Leer archivo de configuración (si existe)
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

    // Configurar NTP
    logToSerialLine("NET", "Configurando NTP...");
    configTime(GMT_OFFSET_SEC, DST_OFFSET_SEC, NTP_SERVER);

    struct tm timeinfo;
    bool ntp_ok = false;
    for (int i = 0; i < 10; i++) {
      if (getLocalTime(&timeinfo)) {
        ntp_ok = true;
        break;
      }
      delay(300);
    }

    if (ntp_ok) {
      logToSerialLine("NET", "Hora NTP sincronizada.");
    } else {
      logToSerialLine("NET", "No se pudo obtener hora NTP (seguimos igual).");
    }

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

  // 1) Intentamos Central (si tiene SSID)
  if (strlen(WIFI_SSID_CENTRAL) > 0 &&
      connectWiFiTo(WIFI_SSID_CENTRAL, WIFI_PASS_CENTRAL, WIFI_TARGET_CENTRAL)) {
    logToSerialLine("NET", "Conectado a CENTRAL.");
    return;
  }

  // 2) Intentamos Listener
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
//                 ENVÍO DE FRAMES TCP
// =======================================================

void sendFrameTCP(const String& frame) {
  if (!ENABLE_WIFI) {
    logToSerialLine("TCP", "WiFi deshabilitada, no se envía.");
    return;
  }

  if (!g_wifiConnected || WiFi.status() != WL_CONNECTED) {
    logToSerialLine("TCP", "Sin WiFi, NO se envía (SD buffer OFF).");
    return;
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
    return;
  }

  WiFiClient client;
  Serial.printf("[TCP] Conectando a %s:%d...\n", host, port);

  if (!client.connect(host, port)) {
    logToSerialLine("TCP", "ERROR al conectar. No se guarda en SD (deshabilitado).");
    return;
  }

  client.println(frame);    // línea completa con \n
  client.flush();
  delay(5);
  client.stop();

  logToSerialLine("TCP", "Trama enviada OK.");
}

// =======================================================
//                  CALLBACK BLE
// =======================================================

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {

    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int    rssi = advertisedDevice.getRSSI();
    String ts   = getTimestampISO();

    // Trama ZENIT BLE:
    // AA:BB:CC:DD:EE:FF:BT:YYYY-MM-DDTHH:MM:SS:GW_BACKBONE_NORTE:EDGE_BASIC:ENTRADA_MINA_001:RSSI
    String frame = addr + ":BT:" + ts + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" + String(rssi);

    // Siempre a Serial
    Serial.println(frame);

    // Envío por TCP (si hay WiFi)
    sendFrameTCP(frame);
  }
};

// =======================================================
//                       SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== ZENIT EDGE PROD v1.1 - Pórtico ZENIT (WiFi + BLE) ===");
  Serial.printf("Pórtico ID   : %s\n", PORTICO_ID);
  Serial.printf("Backbone ID  : %s\n", BACKBONE_ID);
  Serial.printf("Edge kind    : %s\n", EDGE_KIND);

  // Watchdog DESACTIVADO por flag → no hacemos nada aquí
  if (ENABLE_WATCHDOG) {
    esp_task_wdt_config_t wdt_config = {
      .timeout_ms     = 30000,                        // 30s (si algún día lo activas)
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
      .trigger_panic  = true
    };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);
    logToSerialLine("WDT", "Watchdog habilitado (30s).");
  } else {
    logToSerialLine("WDT", "Watchdog deshabilitado.");
  }

  // SD (OFF por defecto, no hace nada)
  initSD();

  // WiFi inicial
  connectInitialWiFi();

  // BLE
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

  // LoRa (no hará nada porque ENABLE_LORA = false)
  initLoRa();

  Serial.println("=== SETUP COMPLETO ===");
}

// =======================================================
//                        LOOP
// =======================================================

void loop() {
  unsigned long now = millis();

  // Watchdog (OFF por flag)
  if (ENABLE_WATCHDOG) {
    esp_task_wdt_reset();
  }

  // Revisión WiFi periódica
  if (ENABLE_WIFI && (now - g_lastWiFiCheck) > WIFI_RECHECK_MS) {
    g_lastWiFiCheck = now;
    checkWiFiReconnection();
  }

  // Escaneo BLE
  if (ENABLE_BLE_SCAN && g_scan) {
    g_scan->start(1 /*seg*/, false);
    g_scan->clearResults();
  }

  // Diag LoRa (si algún día lo activas)
  if (ENABLE_LORA && g_loraOk && (now - g_lastLoRaDiag) > LORA_DIAG_MS) {
    g_lastLoRaDiag = now;
    sendLoRaDiag();
  }

  // Modo ahorro energía simple
  if (ENABLE_LOW_POWER_MODE) {
    delay(50);
  } else {
    delay(10);
  }
}
