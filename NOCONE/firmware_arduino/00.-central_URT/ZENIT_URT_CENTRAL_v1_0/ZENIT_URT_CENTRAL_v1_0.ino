/*
  ZENIT_URT_CENTRAL_v1_0
  - ESP32-S3 módulo URT-Central
  - Escaneo BLE → trama ZENIT
  - Envío por WiFi a Raspberry Pi (listener local)
  - La Raspberry reenvía al Listener Central
*/

#include <WiFi.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <time.h>

// =======================================================
//        IDENTIDAD DEL URT / FORMATO DE TRAMA
// =======================================================

const char* URT_ID     = "URT_CENTRAL_001";   // ID de este módulo URT
const char* BACKBONE_ID = "GW_BACKBONE_NORTE";
const char* EDGE_KIND   = "URT_CENTRAL";
const char* BLE_NAME    = "ZENIT_URT_CENTRAL_001";

// =======================================================
//                CONFIG WIFI (Raspberry Pi)
// =======================================================

// WiFi donde está conectada la Raspberry
const char* WIFI_SSID_PI  = "TU_SSID_PI";      // <-- CAMBIAR
const char* WIFI_PASS_PI  = "TU_PASS_PI";      // <-- CAMBIAR

// IP/puerto de la Raspberry (bridge Python)
const char* PI_HOST       = "192.168.1.50";    // <-- IP de la Raspberry
const uint16_t PI_PORT    = 7070;              // Puerto donde escucha Python

bool g_wifiConnected = false;
unsigned long g_lastWiFiCheck = 0;
const unsigned long WIFI_RECHECK_MS = 30000;

// =======================================================
//                      CONFIG NTP
// =======================================================

const char* NTP_SERVER      = "pool.ntp.org";
const long  GMT_OFFSET_SEC  = -3 * 3600;    // Chile -03
const int   DST_OFFSET_SEC  = 0;

// =======================================================
//                      BLE GLOBAL
// =======================================================

BLEScan* g_scan = nullptr;

// =======================================================
//                 FUNCIONES AUXILIARES
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

void logLine(const char* tag, const String& msg) {
  Serial.print("[");
  Serial.print(tag);
  Serial.print("] ");
  Serial.println(msg);
}

// =======================================================
//                        WIFI
// =======================================================

bool connectWiFiToPi() {
  logLine("NET", String("Conectando a WiFi (Pi): ") + WIFI_SSID_PI);

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(500);

  WiFi.begin(WIFI_SSID_PI, WIFI_PASS_PI);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    logLine("NET", String("WiFi OK. IP local: ") + WiFi.localIP().toString());

    logLine("NET", "Configurando NTP...");
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
      logLine("NET", "Hora NTP sincronizada.");
    } else {
      logLine("NET", "No se pudo obtener hora NTP (seguimos igual).");
    }

    return true;
  } else {
    g_wifiConnected = false;
    logLine("NET", "ERROR: no se pudo conectar a WiFi (Pi).");
    return false;
  }
}

void checkWiFiReconnection() {
  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    return;
  }

  g_wifiConnected = false;
  logLine("NET", "WiFi caída. Probando reconexión a Pi...");
  connectWiFiToPi();
}

// =======================================================
//                 ENVÍO DE FRAMES A RASPBERRY
// =======================================================

void sendFrameToPi(const String& frame) {
  if (!g_wifiConnected || WiFi.status() != WL_CONNECTED) {
    logLine("TCP", "Sin WiFi, no se envía trama.");
    return;
  }

  WiFiClient client;
  Serial.printf("[TCP] Conectando a Raspberry %s:%d...\n", PI_HOST, PI_PORT);

  if (!client.connect(PI_HOST, PI_PORT)) {
    logLine("TCP", "ERROR al conectar con Raspberry.");
    return;
  }

  client.println(frame);  // línea completa con \n
  client.flush();
  delay(5);
  client.stop();

  logLine("TCP", "Trama enviada a Raspberry OK.");
}

// =======================================================
//                  CALLBACK BLE
// =======================================================

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {

    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int    rssi = advertisedDevice.getRSSI();
    String ts   = getTimestampISO();

    // Trama ZENIT BLE vía URT-CENTRAL:
    // AA:BB:CC:DD:EE:FF:BT:YYYY-MM-DDTHH:MM:SS:BACKBONE:URT_CENTRAL:URT_ID:RSSI
    String frame = addr + ":BT:" + ts + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + URT_ID + ":" + String(rssi);

    Serial.println(frame);      // siempre a Serial
    sendFrameToPi(frame);       // envío TCP hacia Raspberry
  }
};

// =======================================================
//                       SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== ZENIT URT-CENTRAL v1.0 (ESP32-S3) ===");
  Serial.printf("URT ID       : %s\n", URT_ID);
  Serial.printf("Backbone ID  : %s\n", BACKBONE_ID);
  Serial.printf("Edge kind    : %s\n", EDGE_KIND);

  // WiFi → Raspberry
  connectWiFiToPi();

  // BLE
  logLine("BLE", "Inicializando BLE...");
  BLEDevice::init(BLE_NAME);

  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
  g_scan->setActiveScan(true);
  g_scan->setInterval(50);
  g_scan->setWindow(45);

  logLine("BLE", "Escaneo listo (loop infinito).");

  Serial.println("=== SETUP COMPLETO URT-CENTRAL ===");
}

// =======================================================
//                        LOOP
// =======================================================

void loop() {
  unsigned long now = millis();

  // Revisión WiFi periódica
  if ((now - g_lastWiFiCheck) > WIFI_RECHECK_MS) {
    g_lastWiFiCheck = now;
    checkWiFiReconnection();
  }

  // Escaneo BLE continuo
  if (g_scan) {
    g_scan->start(1 /*seg*/, false);
    g_scan->clearResults();
  }

  delay(10);
}
