/*
  ZENIT EDGE RECEIVER v1.7.2 (LoRa RX + BLE scan + TCP forward) - stable with BLE ON
  - Prioriza pollLoRa SIEMPRE
  - BLE throttled + budget por loop
  - TCP backoff cuando connect() falla (evita colapsar el loop)
  - Ring-buffer fijo + reintento 1 vez
*/

#include <WiFi.h>
#include <SPI.h>
#include <LoRa.h>

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>

// =======================================================
// FLAGS
// =======================================================
static constexpr bool ENABLE_WIFI     = true;
static constexpr bool ENABLE_LORA     = true;
static constexpr bool ENABLE_BLE_SCAN = true;   // <<<<<< habilitar BLE

// =======================================================
// Identidad Receiver (para BLE local)
// =======================================================
const char* PORTICO_ID  = "TMONE_TTE_RX_003";
const char* BACKBONE_ID = "GW_BACKBONE_RX_003";
const char* EDGE_KIND   = "EDGE_RECEIVER";
const char* BLE_NAME    = "TMONE_EDGE_RX_003";

// Timestamp (si quieres NTP real, lo agregamos después)
static const char* BLE_TS_FALLBACK = "1970-01-01T00:00:00";

// =======================================================
// WiFi / TCP (listener)
// =======================================================
const char* WIFI_SSID_LISTENER = "TMONE_Repeat";
const char* WIFI_PASS_LISTENER = "TMONE2025";

const char* LISTENER_HOST      = "172.20.10.2";
const uint16_t LISTENER_PORT   = 7070;

static bool g_wifiConnected = false;

// TCP backoff
static uint32_t g_tcpFailCount = 0;
static uint32_t g_tcpNextTryMs = 0;
static constexpr uint32_t TCP_BACKOFF_MS_BASE = 1200; // espera base si falla
static constexpr uint32_t TCP_BACKOFF_MS_MAX  = 8000; // máximo backoff

// =======================================================
// LoRa pins (tuyos)
// =======================================================
// SPI: SCK=12 MOSI=11 MISO=13
static constexpr int LORA_SCK  = 12;
static constexpr int LORA_MOSI = 11;
static constexpr int LORA_MISO = 13;

// LoRa control pins
static constexpr int LORA_NSS  = 16;
static constexpr int LORA_RST  = 15;
static constexpr int LORA_DIO0 = 38; // NO dependemos de onReceive()

// =======================================================
// Ajustes RF (MATCH sender)
// =======================================================
static constexpr uint32_t LORA_FREQ_HZ   = 915000000UL;
static constexpr int      LORA_SF        = 7;
static constexpr long     LORA_BW        = 125E3;
static constexpr uint8_t  LORA_SYNCWORD  = 0x12;
static constexpr bool     LORA_CRC       = true;

// Coding rate: deja 4/5
static constexpr int      LORA_CR        = 5;  // 4/5
static constexpr int      LORA_TX_POWER  = 14;

static bool g_loraOk = false;

// =======================================================
// BLE
// =======================================================
static BLEScan* g_scan = nullptr;

// BLE scan rate (más liviano para no matar LoRa)
static uint32_t g_lastBleScanMs = 0;
static constexpr uint32_t BLE_SCAN_EVERY_MS = 6000; // antes 3000, ahora 6000
static constexpr uint32_t BLE_SCAN_SECONDS  = 1;    // 1s

// BLE budget por loop (cuántas tramas BLE máximo aceptamos por loop)
static constexpr uint8_t BLE_FRAMES_BUDGET_PER_LOOP = 3;
static uint8_t g_bleFramesThisLoop = 0;

// =======================================================
// Cola ring-buffer -> TCP  (TIPOS ANTES DE FUNCIONES)
// =======================================================
enum FrameSrc : uint8_t { SRC_LORA = 1, SRC_BLE = 2 };

static constexpr int QUEUE_CAP = 64;
static constexpr int FRAME_MAX = 260;

struct FrameItem {
  FrameSrc src;
  uint16_t len;
  char     data[FRAME_MAX];
  uint8_t  retries; // 0/1
};

static FrameItem g_q[QUEUE_CAP];
static volatile int g_qHead = 0;
static volatile int g_qTail = 0;

static inline int qCount() {
  int c = g_qHead - g_qTail;
  if (c < 0) c += QUEUE_CAP;
  return c;
}

static bool queuePush(FrameSrc src, const char* s, size_t n) {
  if (!s || n == 0) return false;
  if (n >= FRAME_MAX) n = FRAME_MAX - 1;

  int nextHead = g_qHead + 1;
  if (nextHead >= QUEUE_CAP) nextHead = 0;

  if (nextHead == g_qTail) return false; // full

  FrameItem &it = g_q[g_qHead];
  it.src = src;
  it.len = (uint16_t)n;
  memcpy(it.data, s, n);
  it.data[n] = '\0';
  it.retries = 0;

  g_qHead = nextHead;
  return true;
}

static bool queuePop(FrameItem &out) {
  if (g_qTail == g_qHead) return false;
  out = g_q[g_qTail];

  int nextTail = g_qTail + 1;
  if (nextTail >= QUEUE_CAP) nextTail = 0;
  g_qTail = nextTail;
  return true;
}

static bool queueRePush(const FrameItem &it) {
  return queuePush(it.src, it.data, it.len);
}

// =======================================================
// Logs
// =======================================================
static void logLine(const char* tag, const char* msg) {
  Serial.print("["); Serial.print(tag); Serial.print("] ");
  Serial.println(msg);
}

// =======================================================
// Tracking pórticos vistos por LoRa (campo 6)
// MAC:BT:TS:BACKBONE:EDGE_KIND:PORTICO_ID:RSSI
// =======================================================
struct PorticoSeen {
  char id[48];
  uint32_t count;
  uint32_t lastMs;
};

static PorticoSeen g_seen[32];
static int g_seenCount = 0;

static void trackPorticoFromFrame(const char* frame) {
  if (!frame) return;

  int field = 0;
  const char* p = frame;
  const char* start = frame;
  char portico[48] = {0};

  while (*p) {
    if (*p == ':') {
      if (field == 5) {
        int len = (int)(p - start);
        if (len > 0) {
          if (len >= (int)sizeof(portico)) len = (int)sizeof(portico) - 1;
          memcpy(portico, start, (size_t)len);
          portico[len] = 0;
        }
        break;
      }
      field++;
      start = p + 1;
    }
    p++;
  }

  if (!portico[0]) return;

  uint32_t now = millis();
  for (int i = 0; i < g_seenCount; i++) {
    if (strcmp(g_seen[i].id, portico) == 0) {
      g_seen[i].count++;
      g_seen[i].lastMs = now;
      return;
    }
  }

  if (g_seenCount < (int)(sizeof(g_seen) / sizeof(g_seen[0]))) {
    strncpy(g_seen[g_seenCount].id, portico, sizeof(g_seen[g_seenCount].id) - 1);
    g_seen[g_seenCount].id[sizeof(g_seen[g_seenCount].id) - 1] = 0;
    g_seen[g_seenCount].count = 1;
    g_seen[g_seenCount].lastMs = now;
    g_seenCount++;
  }
}

static void printSeenPorticos() {
  Serial.println("--------------------------------------------------");
  Serial.printf("[LORA] Porticos vistos (%d):\n", g_seenCount);
  for (int i = 0; i < g_seenCount; i++) {
    Serial.printf("  - %s | count=%lu | last=%lums\n",
                  g_seen[i].id,
                  (unsigned long)g_seen[i].count,
                  (unsigned long)(millis() - g_seen[i].lastMs));
  }
  Serial.println("--------------------------------------------------");
}

// =======================================================
// WiFi connect
// =======================================================
static bool connectWiFi() {
  if (!ENABLE_WIFI) {
    logLine("NET", "WiFi deshabilitada.");
    g_wifiConnected = false;
    return false;
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(200);

  Serial.printf("[NET] Conectando WiFi -> %s\n", WIFI_SSID_LISTENER);
  WiFi.begin(WIFI_SSID_LISTENER, WIFI_PASS_LISTENER);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) {
    delay(300);
    Serial.print(".");
    tries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiConnected = true;
    Serial.printf("[NET] WiFi OK. IP=%s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  g_wifiConnected = false;
  logLine("NET", "WiFi FAIL.");
  return false;
}

// =======================================================
// TCP send (con backoff)
// =======================================================
static void tcpBackoffOnFail() {
  g_tcpFailCount++;
  uint32_t backoff = TCP_BACKOFF_MS_BASE * (g_tcpFailCount <= 6 ? (1U << (g_tcpFailCount - 1)) : 64U);
  if (backoff > TCP_BACKOFF_MS_MAX) backoff = TCP_BACKOFF_MS_MAX;
  g_tcpNextTryMs = millis() + backoff;
}

static void tcpResetOnSuccess() {
  g_tcpFailCount = 0;
  g_tcpNextTryMs = 0;
}

static bool sendFrameTCP(const char* frame) {
  if (!ENABLE_WIFI) return false;
  if (!g_wifiConnected || WiFi.status() != WL_CONNECTED) return false;

  uint32_t now = millis();
  if (g_tcpNextTryMs != 0 && now < g_tcpNextTryMs) {
    // todavía en backoff
    return false;
  }

  WiFiClient client;
  client.setTimeout(300); // más corto para no colgarse

  if (!client.connect(LISTENER_HOST, LISTENER_PORT)) {
    logLine("TCP", "ERROR: connect() falló.");
    tcpBackoffOnFail();
    return false;
  }

  client.println(frame);
  client.flush();
  delay(1);
  client.stop();

  logLine("TCP", "Trama enviada OK.");
  tcpResetOnSuccess();
  return true;
}

// =======================================================
// LoRa init + RF apply
// =======================================================
static void applyLoRaRF() {
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNCWORD);
  if (LORA_CRC) LoRa.enableCrc(); else LoRa.disableCrc();
  LoRa.setTxPower(LORA_TX_POWER);
}

static void initLoRa() {
  if (!ENABLE_LORA) {
    logLine("LORA", "LoRa deshabilitado.");
    g_loraOk = false;
    return;
  }

  logLine("LORA", "Inicializando LoRa (915 fijo, polling RX)...");
  Serial.printf("[LORA] SPI pins: SCK=%d MOSI=%d MISO=%d | NSS=%d RST=%d DIO0=%d\n",
                LORA_SCK, LORA_MOSI, LORA_MISO, LORA_NSS, LORA_RST, LORA_DIO0);

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

  bool ok = false;
  for (int i = 0; i < 5; i++) {
    Serial.printf("[LORA] LoRa.begin() intento #%d\n", i + 1);
    if (LoRa.begin((long)LORA_FREQ_HZ)) { ok = true; break; }
    delay(300);
  }

  if (!ok) {
    logLine("LORA", "ERROR: No se pudo inicializar LoRa.");
    g_loraOk = false;
    return;
  }

  applyLoRaRF();
  LoRa.receive();
  g_loraOk = true;

  Serial.printf("[LORA] OK RX @%.1fMHz | SF=%d | BW=%ld | CR=4/%d | SYNC=0x%02X | CRC=%s\n",
                (double)LORA_FREQ_HZ / 1e6,
                LORA_SF,
                (long)LORA_BW,
                LORA_CR,
                (unsigned)LORA_SYNCWORD,
                LORA_CRC ? "ON" : "OFF");
}

// =======================================================
// LoRa RX polling (prioridad)
// =======================================================
static uint32_t g_lastRxMs = 0;

static void pollLoRa() {
  if (!ENABLE_LORA || !g_loraOk) return;

  int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) return;

  char buf[FRAME_MAX];
  int idx = 0;

  while (LoRa.available() && idx < (FRAME_MAX - 1)) {
    int c = LoRa.read();
    if (c < 0) break;
    buf[idx++] = (char)c;
  }
  buf[idx] = '\0';

  g_lastRxMs = millis();

  Serial.println("--------------------------------------------------");
  Serial.printf("[LORA] TRAMA RECIBIDA (len=%d, rssi=%d, snr=%.2f):\n",
                idx, LoRa.packetRssi(), LoRa.packetSnr());
  Serial.println(buf);

  trackPorticoFromFrame(buf);

  if (!queuePush(SRC_LORA, buf, (size_t)idx)) {
    logLine("LORA", "COLA LLENA -> se descarta trama LoRa.");
  } else {
    logLine("LORA", "Trama LoRa encolada para TCP.");
  }

  LoRa.receive();
}

// =======================================================
// BLE scan (encola frames) - con budget
// =======================================================
class MyAdvCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice d) override {
    if (!ENABLE_BLE_SCAN) return;

    // budget por loop (evita spam BLE)
    if (g_bleFramesThisLoop >= BLE_FRAMES_BUDGET_PER_LOOP) return;
    g_bleFramesThisLoop++;

    const char* mac = d.getAddress().toString().c_str();
    int rssi = d.getRSSI();

    char frame[FRAME_MAX];
    int n = snprintf(frame, sizeof(frame),
                     "%s:BT:%s:%s:%s:%s:%d",
                     mac,
                     BLE_TS_FALLBACK,
                     BACKBONE_ID,
                     EDGE_KIND,
                     PORTICO_ID,
                     rssi);

    if (n <= 0) return;
    if (n >= (int)sizeof(frame)) n = (int)sizeof(frame) - 1;

    Serial.println("--------------------------------------------------");
    Serial.println("[BLE] TRAMA BLE LOCAL:");
    Serial.println(frame);

    if (!queuePush(SRC_BLE, frame, (size_t)n)) {
      logLine("BLE", "COLA LLENA -> se descarta trama BLE.");
    } else {
      logLine("BLE", "Trama BLE encolada para TCP.");
    }
  }
};

static void initBLE() {
  if (!ENABLE_BLE_SCAN) {
    logLine("BLE", "BLE deshabilitado.");
    return;
  }

  logLine("BLE", "Inicializando BLE...");
  BLEDevice::init(BLE_NAME);

  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new MyAdvCallbacks());
  g_scan->setActiveScan(true);

  // similar al sender
  g_scan->setInterval(50);
  g_scan->setWindow(45);

  logLine("BLE", "Scan listo.");
}

static void pollBLE() {
  if (!ENABLE_BLE_SCAN || !g_scan) return;

  uint32_t now = millis();
  if (now - g_lastBleScanMs < BLE_SCAN_EVERY_MS) return;
  g_lastBleScanMs = now;

  // reset budget para esta ronda
  g_bleFramesThisLoop = 0;

  // 1 segundo de scan cada 6 segundos (más liviano)
  g_scan->start((int)BLE_SCAN_SECONDS, false);
  g_scan->clearResults();
}

// =======================================================
// Cola -> TCP (reintento 1 vez) con budget de tiempo
// =======================================================
static void processQueueAndSendTCP() {
  // Budget de tiempo por loop para no comerse el RX
  uint32_t start = millis();
  static constexpr uint32_t TCP_LOOP_BUDGET_MS = 6;

  FrameItem it;
  while (queuePop(it)) {
    // siempre corta por tiempo
    if (millis() - start > TCP_LOOP_BUDGET_MS) {
      // devuelve el item al final si no alcanzamos (para no perderlo)
      queueRePush(it);
      return;
    }

    bool ok = sendFrameTCP(it.data);

    if (!ok) {
      it.retries++;
      logLine("TCP", "FALLÓ envío a TCP.");
      if (it.retries <= 1) {
        logLine("TCP", "Re-encolando (1 vez)...");
        if (!queueRePush(it)) logLine("TCP", "COLA LLENA re-encolando -> se descarta.");
      }
      return; // no insistir este loop (evita colapso)
    } else {
      logLine("TCP", "TRAMA ENVIADA A TCP OK.");
    }

    delay(1);
  }
}

// =======================================================
// SETUP / LOOP
// =======================================================
static unsigned long g_lastSeenPrint = 0;
static constexpr unsigned long SEEN_PRINT_MS = 15000;

static unsigned long g_lastSysPrint = 0;
static constexpr unsigned long SYS_PRINT_MS = 5000;

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println();
  Serial.println("=== ZENIT EDGE RECEIVER v1.7.2 (LoRa RX + BLE + TCP) ===");
  Serial.printf("PORTICO_ID  : %s\n", PORTICO_ID);
  Serial.printf("BACKBONE_ID : %s\n", BACKBONE_ID);
  Serial.printf("EDGE_KIND   : %s\n", EDGE_KIND);
  Serial.printf("[CFG] BLE_SCAN_EVERY_MS=%lu BLE_SCAN_SECONDS=%lu\n",
                (unsigned long)BLE_SCAN_EVERY_MS, (unsigned long)BLE_SCAN_SECONDS);
  Serial.println("-------------------------------------------------------------");

  if (ENABLE_WIFI) connectWiFi();
  initLoRa();
  initBLE();

  g_lastRxMs = millis();

  Serial.println("=== SETUP COMPLETO (receiver) ===");
}

void loop() {
  // Mantener WiFi vivo
  if (ENABLE_WIFI) {
    if (WiFi.status() != WL_CONNECTED) {
      g_wifiConnected = false;
      connectWiFi();
    } else {
      g_wifiConnected = true;
    }
  }

  // 1) RX LoRa (lo más crítico)
  pollLoRa();

  // 2) BLE scan (throttled)
  pollBLE();

  // 3) Enviar cola -> TCP (budgeted + backoff)
  processQueueAndSendTCP();

  // Logs periódicos
  unsigned long now = millis();

  if (now - g_lastSeenPrint > SEEN_PRINT_MS) {
    g_lastSeenPrint = now;
    printSeenPorticos();
  }

  if (now - g_lastSysPrint > SYS_PRINT_MS) {
    g_lastSysPrint = now;
    Serial.printf("[SYS] Queue=%d | FreeHeap=%lu | lastRx=%lums | tcpFails=%lu\n",
                  qCount(),
                  (unsigned long)ESP.getFreeHeap(),
                  (unsigned long)(now - g_lastRxMs),
                  (unsigned long)g_tcpFailCount);
  }

  delay(2);
}
