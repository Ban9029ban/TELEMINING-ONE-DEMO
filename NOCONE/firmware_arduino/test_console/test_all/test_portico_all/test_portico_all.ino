// =======================================================
//   ZENIT – Firmware de Diagnóstico Universal ESP32-S3
//   BLE + WiFi/TCP + LoRa + SD + Sensores I2C
//   Con archivo de configuración desde SD
// =======================================================

// =======================================================
//            FLAGS (true/false) PARA HABILITAR MÓDULOS
// =======================================================
bool CFG_WIFI_ENABLED      = true;
bool CFG_BLE_ENABLED       = true;
bool CFG_LORA_ENABLED      = true;
bool CFG_SD_ENABLED        = true;
bool CFG_SENSORS_ENABLED   = true;
bool CFG_POWERMON_ENABLED  = false;   // Reservado

// =======================================================
//            LIBRERÍAS NECESARIAS (todas oficiales)
// =======================================================

#include <Arduino.h>

#if true
  #include <WiFi.h>
  #include <time.h>
#endif

#if true
  #include <BLEDevice.h>
  #include <BLEUtils.h>
  #include <BLEScan.h>
#endif

#if true
  #include <Wire.h>
#endif

#if true
  #include <SPI.h>
  #include <LoRa.h>
#endif

#if true
  #include <SD.h>
#endif

// =======================================================
//               VARIABLES LEÍDAS DESDE SD
// =======================================================

String PORTICO_ID   = "ENTRADA_MINA_001";
String BACKBONE_ID  = "GW_BACKBONE_NORTE";
String EDGE_KIND    = "EDGE_BASIC";

String WIFI_SSID    = "WiFi_Mesh-637503";
String WIFI_PASS    = "Y3h4FS2x";

String BLE_DEVICE_NAME = "ZENIT_EDGE_ENTRADA_MINA";

String LISTENER_HOST = "192.168.1.14";
int    LISTENER_PORT = 7070;

bool g_wifiConnected = false;

BLEScan* g_scan = nullptr;

// =======================================================
//                      PROTOTIPOS
// =======================================================

void loadConfigFromSD();
void writeDefaultConfig();
void sendFrameToListener(const String& frame);
void initLoRa();
void testLoRaOnce();
void scanI2CDevices();
void updateEnvData();
void handleCLI();

// =======================================================
//               LECTURA DE ARCHIVO DE CONFIG SD
// =======================================================

void loadConfigFromSD() {
  if (!CFG_SD_ENABLED) {
    Serial.println("[SD] Config: SD deshabilitada.");
    return;
  }

  if (!SD.begin()) {
    Serial.println("[SD] ERROR: No se puede iniciar SD.");
    return;
  }

  if (!SD.exists("/config.txt")) {
    Serial.println("[SD] No existe config.txt, creando...");
    writeDefaultConfig();
    return;
  }

  File f = SD.open("/config.txt", FILE_READ);
  if (!f) {
    Serial.println("[SD] ERROR al abrir config.txt");
    return;
  }

  Serial.println("[SD] Leyendo archivo de configuración:");
  while (f.available()) {
    String line = f.readStringUntil('\n');
    Serial.println("  " + line);

    line.trim();
    if (line.length() < 3) continue;

    int eq = line.indexOf('=');
    if (eq < 0) continue;

    String key = line.substring(0, eq);
    String val = line.substring(eq + 1);

    key.trim();
    val.trim();

    if (key == "PORTICO_ID") PORTICO_ID = val;
    if (key == "BACKBONE_ID") BACKBONE_ID = val;
    if (key == "EDGE_KIND") EDGE_KIND = val;

    if (key == "WIFI_SSID") WIFI_SSID = val;
    if (key == "WIFI_PASS") WIFI_PASS = val;

    if (key == "LISTENER_HOST") LISTENER_HOST = val;
    if (key == "LISTENER_PORT") LISTENER_PORT = val.toInt();

    if (key == "BLE_NAME") BLE_DEVICE_NAME = val;
  }

  f.close();
  Serial.println("[SD] Config cargada OK.");
}

// =======================================================
//            CREAR ARCHIVO DE CONFIG POR DEFECTO
// =======================================================

void writeDefaultConfig() {
  File f = SD.open("/config.txt", FILE_WRITE);
  if (!f) {
    Serial.println("[SD] ERROR creando config.txt");
    return;
  }

  f.println("PORTICO_ID=ENTRADA_MINA_001");
  f.println("BACKBONE_ID=GW_BACKBONE_NORTE");
  f.println("EDGE_KIND=EDGE_BASIC");
  f.println("WIFI_SSID=WiFi_Mesh-637503");
  f.println("WIFI_PASS=Y3h4FS2x");
  f.println("LISTENER_HOST=192.168.1.14");
  f.println("LISTENER_PORT=7070");
  f.println("BLE_NAME=ZENIT_EDGE_ENTRADA_MINA");

  f.close();
  Serial.println("[SD] Archivo config.txt creado con valores por defecto.");
}

// =======================================================
//                    WIFI + NTP
// =======================================================

void connectWiFiOnce() {
  if (!CFG_WIFI_ENABLED) return;

  Serial.printf("[NET] Conectando a WiFi: %s ...\n", WIFI_SSID.c_str());

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID.c_str(), WIFI_PASS.c_str());

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    Serial.printf("[NET] WiFi OK, IP=%s\n", WiFi.localIP().toString().c_str());

    configTime(-3 * 3600, 0, "pool.ntp.org");
    delay(2000);
  } else {
    Serial.println("[NET] ERROR: No conectó a WiFi.");
    g_wifiConnected = false;
  }
}

// =======================================================
//                 ENVÍO DE TRAMA TCP
// =======================================================

void sendFrameToListener(const String& frame) {
  if (!CFG_WIFI_ENABLED || !g_wifiConnected) return;

  WiFiClient client;
  if (!client.connect(LISTENER_HOST.c_str(), LISTENER_PORT)) {
    Serial.println("[TCP] ERROR al conectar al listener.");
    return;
  }

  client.println(frame);
  client.flush();
  client.stop();

  Serial.println("[TCP] Trama enviada OK.");
}

// =======================================================
//          CALLBACK BLE PARA PUBLICIDAD ESCANEADA
// =======================================================

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice d) override {

    char ts[30];
    time_t now;
    struct tm ti;

    time(&now);
    localtime_r(&now, &ti);
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &ti);

    String frame = String(d.getAddress().toString().c_str()) +
                   ":BT:" + ts + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" +
                   d.getRSSI();

    Serial.println(frame);

    sendFrameToListener(frame);
  }
};

// =======================================================
//                I2C / Sensores (scan simple)
// =======================================================

void scanI2CDevices() {
  Serial.println("[I2C] Escaneando I2C...");
  Wire.begin();
  byte count = 0;
  for (byte i = 1; i < 127; i++) {
    Wire.beginTransmission(i);
    if (Wire.endTransmission() == 0) {
      Serial.printf("[I2C] Dispositivo en 0x%02X\n", i);
      count++;
    }
  }
  Serial.printf("[I2C] Total encontrados: %d\n", count);
}

// =======================================================
//                        LoRa
// =======================================================

void initLoRa() {
  if (!CFG_LORA_ENABLED) return;

  Serial.println("[LoRa] Iniciando @ 915 MHz...");
  SPI.begin(5, 6, 7, 8);   // AJUSTA pines si es necesario
  LoRa.setPins(8, 9, 10);

  if (!LoRa.begin(915E6)) {
    Serial.println("[LoRa] ERROR al iniciar radio.");
    CFG_LORA_ENABLED = false;
    return;
  }

  Serial.println("[LoRa] Inicialización OK.");
}

void testLoRaOnce() {
  if (!CFG_LORA_ENABLED) return;

  LoRa.beginPacket();
  LoRa.print("ZENIT TEST PACKET");
  LoRa.endPacket();

  Serial.println("[LoRa] Paquete enviado.");
}

// =======================================================
//                      CLI POR SERIAL
// =======================================================

void handleCLI() {
  if (!Serial.available()) return;
  char c = Serial.read();

  switch (c) {
    case 'h':
      Serial.println("Comandos:");
      Serial.println("  h = ayuda");
      Serial.println("  w = estado WiFi");
      Serial.println("  b = scan BLE");
      Serial.println("  i = scan I2C");
      Serial.println("  l = LoRa test");
      Serial.println("  c = Mostrar configuración cargada");
      break;

    case 'w':
      Serial.printf("[WiFi] status=%d IP=%s\n",
                    WiFi.status(),
                    WiFi.localIP().toString().c_str());
      break;

    case 'b':
      Serial.println("[CLI] Scan BLE 1 seg...");
      g_scan->start(1, false);
      g_scan->clearResults();
      break;

    case 'i':
      scanI2CDevices();
      break;

    case 'l':
      testLoRaOnce();
      break;

    case 'c':
      Serial.println("=== CONFIG ACTUAL ===");
      Serial.println("PORTICO_ID=" + PORTICO_ID);
      Serial.println("BACKBONE_ID=" + BACKBONE_ID);
      Serial.println("EDGE_KIND=" + EDGE_KIND);
      Serial.println("SSID=" + WIFI_SSID);
      Serial.println("Listener=" + LISTENER_HOST + ":" + String(LISTENER_PORT));
      Serial.println("BLE=" + BLE_DEVICE_NAME);
      break;
  }
}

// =======================================================
//                       SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ZENIT DIAG v2.0 ===");

  if (CFG_SD_ENABLED) loadConfigFromSD();

  if (CFG_WIFI_ENABLED) connectWiFiOnce();

  if (CFG_SENSORS_ENABLED) scanI2CDevices();

  if (CFG_LORA_ENABLED) initLoRa();

  if (CFG_BLE_ENABLED) {
    BLEDevice::init(BLE_DEVICE_NAME.c_str());
    g_scan = BLEDevice::getScan();
    g_scan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
    g_scan->setActiveScan(true);
    g_scan->setInterval(50);
    g_scan->setWindow(45);
    Serial.println("[BLE] Escaneo iniciado.");
  }
}

// =======================================================
//                       LOOP
// =======================================================

void loop() {
  handleCLI();

  if (CFG_BLE_ENABLED && g_scan) {
    g_scan->start(1, false);
    g_scan->clearResults();
  }

  delay(10);
}
