#include <WiFi.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <time.h>

// =======================================================
//                 CONFIG WIFI / TCP
// =======================================================

// WiFi real donde está tu listener
const char* WIFI_SSID       = "WiFi_Mesh-637503";
const char* WIFI_PASS       = "Y3h4FS2x";

// IP/puerto del listener real
const char* LISTENER_HOST   = "192.168.1.14";
const uint16_t LISTENER_PORT = 7070;

// Flag simple: se logró conectar a WiFi en el setup o no
bool g_wifiConnected = false;

// =======================================================
//                    CONFIG NTP
// =======================================================

const char* NTP_SERVER      = "pool.ntp.org";
const long  GMT_OFFSET_SEC  = -3 * 3600;    // Chile -03
const int   DST_OFFSET_SEC  = 0;

// =======================================================
//        PROTOTIPO (usado dentro del callback BLE)
// =======================================================

void sendFrameToListener(const String& frame);

// =======================================================
//                 BLE GLOBAL
// =======================================================

BLEScan* g_scan = nullptr;

// =======================================================
//   CALLBACK BLE – se ejecuta cada vez que se ve un anuncio
// =======================================================

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {

    // MAC del dispositivo BLE (convertido a String de Arduino)
    String addr = String(advertisedDevice.getAddress().toString().c_str());
    int rssi    = advertisedDevice.getRSSI();

    // Timestamp local
    struct tm timeinfo;
    char ts[30];
    if (getLocalTime(&timeinfo)) {
      strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    } else {
      // Si no hay hora NTP, mandamos algo por defecto
      strcpy(ts, "1970-01-01T00:00:00");
    }

    // Trama con el formato acordado:
    // AA:BB:CC:DD:EE:FF:BT:YYYY-MM-DDTHH:MM:SS:GW_BACKBONE_NORTE:EDGE_BASIC:ENTRADA_MINA_001:RSSI
    String frame =
      addr + ":BT:" + String(ts) +
      ":GW_BACKBONE_NORTE:EDGE_BASIC:ENTRADA_MINA_001:" + String(rssi);

    // Siempre mostramos en el Serial
    Serial.println(frame);

    // Intentamos enviarla (si falla, sólo loguea error y seguimos)
    sendFrameToListener(frame);
  }
};

// =======================================================
//                    WIFI SIMPLE
// =======================================================

void connectWiFiOnce() {
  Serial.println("[NET] Conectando a WiFi (LISTENER)...");

  // Dejamos todo limpio
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(500);

  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    Serial.printf("[NET] WiFi OK. IP: %s\n", WiFi.localIP().toString().c_str());

    // Configurar NTP una sola vez
    Serial.println("[NET] Configurando NTP...");
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
      Serial.println("[NET] Hora NTP sincronizada.");
    } else {
      Serial.println("[NET] No se pudo obtener hora NTP (seguimos igual).");
    }

  } else {
    g_wifiConnected = false;
    Serial.println("[NET] ERROR: no se pudo conectar a WiFi. Seguiremos sólo con BLE + Serial.");
  }
}

// =======================================================
//                ENVÍO AL LISTENER
// =======================================================

void sendFrameToListener(const String& frame) {
  // No reintentamos WiFi aquí; si no conectó en setup, sólo hacemos Serial.
  if (!g_wifiConnected || WiFi.status() != WL_CONNECTED) {
    Serial.println("[TCP] Sin WiFi. Solo Serial BLE (no se envía).");
    return;
  }

  WiFiClient client;
  Serial.printf("[TCP] Intentando LISTENER %s:%d...\n", LISTENER_HOST, LISTENER_PORT);

  if (!client.connect(LISTENER_HOST, LISTENER_PORT)) {
    Serial.println("[TCP] ERROR al conectar con LISTENER. Seguimos sólo con Serial.");
    return;
  }

  client.print(frame);
  client.print("\n");
  client.stop();

  Serial.println("[TCP] Trama enviada a LISTENER OK.");
}

// =======================================================
//                     SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== ZENIT Pórtico ENTRADA_MINA_001  BLE + TCP (WiFi única) ===");

  // Intentamos WiFi una sola vez
  connectWiFiOnce();

  // Inicializar BLE
  Serial.println("[BLE] Inicializando BLE...");
  BLEDevice::init("ZENIT_EDGE_ENTRADA_MINA");

  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
  g_scan->setActiveScan(true);    // escaneo activo
  g_scan->setInterval(50);        // intervalo rápido
  g_scan->setWindow(45);          // casi continuo dentro del intervalo

  Serial.println("[BLE] Escaneo iniciado (loop infinito).");
}

// =======================================================
//                      LOOP
// =======================================================

void loop() {
  // Escaneo BLE en ventanas de 1 segundo, estable
  if (g_scan) {
    g_scan->start(1 /*seg*/, false);
    g_scan->clearResults();   // libera memoria de resultados anteriores
  }

  // Pequeño respiro para el scheduler
  delay(10);
}
