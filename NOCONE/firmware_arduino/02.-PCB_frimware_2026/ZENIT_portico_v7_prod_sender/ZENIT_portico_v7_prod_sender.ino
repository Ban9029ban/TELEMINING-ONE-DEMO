#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <SD.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <WiFi.h>
#include <EthernetENC.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <time.h>
#include "../zenit_lora_common_types.h"
#include "../zenit_lora_radio_config.h"

/*
  ZENIT v7 - SENDER / MODEM UTP -> LoRa

  Logica principal:
  - Ethernet TCP server: recibe lineas desde la red UTP y las encola para LoRa.
  - Ethernet HTTP webhook: acepta POST estilo GAO/Impinj y los convierte a tramas RFID compactas para LoRa.
  - BLE opcional: sigue pudiendo generar tramas ZENIT y enviarlas por LoRa.
  - Sensores: quedan deshabilitados por ahora, con flag listo para activarlos despues.
  - SD: registra eventos y puede guardar buffer si una trama no se puede despachar.
  - WiFi: deshabilitado por defecto. Solo queda como opcion.
  - Consola: imprime trazas FLOW para seguir el camino Ethernet/WiFi/BLE/GAO -> LoRa.

  Nota:
  - ENC28J60 es el controlador Ethernet SPI.
  - Si la carrier usa otros pines para Ethernet, solo hay que ajustar el bloque ETH_*.

  MAPA RAPIDO DE FUNCIONES:
  - prepareSpiPins(): prepara CS/reset y evita choques entre LoRa y Ethernet.
  - initLoRa(): diagnostica SX1278 y configura parametros RF.
  - enqueueOutgoingFrame(): encola datos y fragmenta mensajes largos.
  - serviceLoRaTx(): envia, espera ACK, reintenta y recupera el radio.
  - pollLoRaRx()/handleAckFrame(): recibe y valida ACKs del receiver.
  - initEthernet()/serviceEthernetClient(): servicios TCP/HTTP de produccion.
  - serviceGaoClient(): entrada RFID desde el lector GAO si esta habilitado.
  - setup(): inicializa perifericos y registra OK/FAIL.
  - loop(): TEST ejecuta solo LoRa; PRODUCCION atiende todos los servicios.
*/

// =======================================================
// Flags de funcionalidad
// =======================================================

// Prueba de placa: deja activo exclusivamente el enlace LoRa.
// El sender emite una trama LORA_TEST cada 2 s y espera su ACK.
static constexpr bool ENABLE_LORA_TEST_MODE = ZenitLoRaConfig::TEST_MODE;

static constexpr bool ENABLE_LORA         = true;
static constexpr bool CONFIG_ENABLE_ETHERNET = true;
static constexpr bool CONFIG_ENABLE_WIFI = false;
// RFID-only test mode: dejar en false para aislar GAO RFID -> LoRa -> receiver.
static constexpr bool CONFIG_ENABLE_BLE_SCAN = false;
static constexpr bool ENABLE_SD_CARD      = false;
static constexpr bool CONFIG_ENABLE_SENSOR_READ = false;
static constexpr bool CONFIG_ENABLE_LORA_DIAG = false;
static constexpr bool CONFIG_ENABLE_LORA_LINK_HEARTBEAT = true;
static constexpr bool ENABLE_LOW_POWER    = false;
static constexpr bool ENABLE_ETH_ACK      = false;
static constexpr bool CONFIG_ENABLE_GAO_WEBHOOK = true;
static constexpr bool CONFIG_ENABLE_GAO_PULL_CLIENT = true;
static constexpr bool CONFIG_ENABLE_GAO_AUTO_START_INVENTORY = false;

static constexpr bool ENABLE_ETHERNET = CONFIG_ENABLE_ETHERNET && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_WIFI = CONFIG_ENABLE_WIFI && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_BLE_SCAN = CONFIG_ENABLE_BLE_SCAN && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_SENSOR_READ = CONFIG_ENABLE_SENSOR_READ && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_LORA_DIAG = CONFIG_ENABLE_LORA_DIAG && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_LORA_LINK_HEARTBEAT = CONFIG_ENABLE_LORA_LINK_HEARTBEAT && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_GAO_WEBHOOK = CONFIG_ENABLE_GAO_WEBHOOK && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_GAO_PULL_CLIENT = CONFIG_ENABLE_GAO_PULL_CLIENT && ENABLE_ETHERNET;

// =======================================================
// Identidad / formato
// =======================================================

static const char* PORTICO_ID  = ZenitLoRaConfig::SENDER_ID;
static const char* PAIR_ID     = ZenitLoRaConfig::PAIR_ID;
static const char* EXPECTED_RECEIVER_ID = ZenitLoRaConfig::RECEIVER_ID;
static const char* BACKBONE_ID = "GW_BACKBONE_SENDER_001";
static const char* EDGE_KIND   = "EDGE_SENDER";
static const char* BLE_NAME    = "TMONE_EDGE_SENDER_001";

// =======================================================
// WiFi opcional
// =======================================================

static const char* WIFI_SSID = "TMONE_Repeat";
static const char* WIFI_PASS = "TMONE2025";
static constexpr uint16_t WIFI_LISTEN_PORT = 7071;
static constexpr uint32_t WIFI_RECHECK_MS = 30000;

static bool g_wifiOk = false;
static uint32_t g_lastWiFiCheckMs = 0;

WiFiServer g_wifiServer(WIFI_LISTEN_PORT);
WiFiClient g_wifiClient;
String g_wifiLine;

// =======================================================
// Ethernet ENC28J60
// =======================================================

static constexpr int ETH_CS_PIN  = 39;
static constexpr int ETH_RST_PIN = 8;
static constexpr int ETH_INT_PIN = 10;
static constexpr bool ETH_USE_DHCP = false;
static constexpr uint16_t ETH_LISTEN_PORT = 7071;

byte g_ethMac[] = { 0x02, 0x54, 0x4D, 0x4F, 0x4E, 0x11 };
IPAddress g_ethStaticIp(192, 168, 100, 51);
IPAddress g_ethDns(192, 168, 100, 1);
IPAddress g_ethGateway(192, 168, 100, 1);
IPAddress g_ethMask(255, 255, 255, 0);

static bool g_ethOk = false;
static bool g_ethLinkUp = false;
static uint32_t g_lastEthernetInitAttemptMs = 0;
static uint32_t g_lastEthernetHealthCheckMs = 0;
EthernetServer g_ethServer(ETH_LISTEN_PORT);
EthernetClient g_ethClient;
String g_ethLine;

enum InboundClientMode : uint8_t {
  INBOUND_MODE_DETECT = 0,
  INBOUND_MODE_TEXT = 1,
  INBOUND_MODE_HTTP_HEADERS = 2,
  INBOUND_MODE_HTTP_BODY = 3
};

static InboundClientMode g_ethClientMode = INBOUND_MODE_DETECT;
static String g_ethHttpMethod;
static String g_ethHttpPath;
static int g_ethHttpContentLength = 0;
static String g_ethHttpBody;
static constexpr int HTTP_BODY_MAX = 4096;
static constexpr int HTTP_LINE_MAX = 512;
static constexpr int GAO_CANDIDATE_MAX = 16;

// Cliente activo para reader GAO/Impinj por Ethernet.
static const char* GAO_READER_HOST = "192.168.100.50";
static constexpr uint16_t GAO_READER_PORT = 80;
static const char* GAO_READER_USERNAME = "root";
static const char* GAO_READER_PASSWORD = "impinj";
static const char* GAO_STREAM_PATH = "/api/v1/data/stream";
static const char* GAO_INVENTORY_PRESET = "default";
static constexpr uint32_t GAO_RECONNECT_MS = 5000;
static constexpr uint32_t GAO_HTTP_TIMEOUT_MS = 5000;
static constexpr uint32_t GAO_STREAM_IDLE_TIMEOUT_MS = 90000;
static constexpr int GAO_STREAM_LINE_MAX = 1536;
static constexpr int GAO_HEADER_LINE_MAX = 320;
static constexpr int GAO_CHUNK_LINE_MAX = 32;
static constexpr size_t GAO_STREAM_RX_BUDGET_BYTES = 192;

// El ENC28J60 y el SX1278 comparten SPI. Para aislar completamente ambos
// flujos, el sender trabaja 45 s con la red/antena GAO y luego 45 s solo con
// LoRa. Las tramas leidas en red permanecen en la cola hasta la fase LoRa.
static constexpr uint32_t SENDER_NETWORK_WINDOW_MS = 45000UL;
static constexpr uint32_t SENDER_LORA_WINDOW_MS = 45000UL;
enum SenderTransportPhase : uint8_t {
  SENDER_PHASE_NETWORK = 0,
  SENDER_PHASE_LORA = 1
};
// En arranque se fuerza LoRa: RED/GAO no se habilita hasta recibir el LINK_ACK
// de la pareja configurada.
static SenderTransportPhase g_senderTransportPhase = SENDER_PHASE_LORA;
static uint32_t g_senderPhaseStartedMs = 0;

EthernetClient g_gaoClient;
static bool g_gaoHeadersDone = false;
static bool g_gaoChunked = false;
static int g_gaoStatusCode = 0;
static uint32_t g_lastGaoConnectAttemptMs = 0;
static uint32_t g_lastGaoByteMs = 0;
static String g_gaoHeaderLine;
static String g_gaoBodyLine;
static String g_gaoChunkLine;
static uint32_t g_gaoChunkBytesRemaining = 0;
static uint8_t g_gaoChunkTrailerBytesRemaining = 0;

// =======================================================
// LoRa - se mantienen los pines actuales
// =======================================================

enum LoRaFreqPreset : uint8_t {
  LORA_FREQ_433_000 = 0,
  LORA_FREQ_433_920 = 1,
  LORA_FREQ_434_000 = 2,
  LORA_FREQ_470_000 = 3,
  LORA_FREQ_868_000 = 4,
  LORA_FREQ_915_000 = 5,
  LORA_FREQ_CUSTOM  = 255
};

// Elegir el preset que quieras probar.
// Esta carrier Telemining 2026 usa SX1278, por lo que el valor seguro por defecto
// debe quedar en 433 MHz. 868/915 solo aplican si el modulo RF fuera otro.
static constexpr LoRaFreqPreset LORA_FREQ_PRESET = LORA_FREQ_CUSTOM;
static constexpr uint32_t LORA_CUSTOM_FREQUENCY = ZenitLoRaConfig::FREQUENCY_HZ;

// Placa Telemining 2026 - SPI compartido LoRa SX1278 + Ethernet ENC28J60.
// Ambos chips usan SCK=40, MOSI=41 y MISO=42; se separan por CS:
//   LoRa CS=38, Ethernet CS=39.
// Antes de acceder a uno se deja el CS del otro en HIGH y se espera el
// guard-time configurado. En modo TEST el ENC queda ademas en RESET bajo.
static constexpr int LORA_SCK_PIN  = ZenitLoRaConfig::SCK_PIN;
static constexpr int LORA_MISO_PIN = ZenitLoRaConfig::MISO_PIN;
static constexpr int LORA_MOSI_PIN = ZenitLoRaConfig::MOSI_PIN;
static constexpr int LORA_SS_PIN   = ZenitLoRaConfig::SS_PIN;
static constexpr int LORA_RST_PIN  = ZenitLoRaConfig::RST_PIN;
static constexpr int LORA_DIO0_PIN = ZenitLoRaConfig::DIO0_PIN;

static constexpr int     LORA_SF = ZenitLoRaConfig::SPREADING_FACTOR;
static constexpr long    LORA_BW = ZenitLoRaConfig::BANDWIDTH_HZ;
static constexpr int     LORA_CR = ZenitLoRaConfig::CODING_RATE_DENOMINATOR;
static constexpr uint8_t LORA_SYNCWORD = ZenitLoRaConfig::SYNC_WORD;
static constexpr int     LORA_TX_POWER = ZenitLoRaConfig::TX_POWER_DBM;
static constexpr uint32_t LORA_SPI_FREQUENCY = ZenitLoRaConfig::SPI_FREQUENCY_HZ;

static bool g_loraOk = false;
static uint32_t g_lastLoRaInitAttemptMs = 0;
static uint32_t g_loraTxOkCount = 0;
static uint32_t g_loraAckOkCount = 0;
static uint32_t g_loraRecoveryCount = 0;

// USB CDC puede bloquear print()/write() cuando no hay monitor serial y su
// buffer se llena. La consola es solo diagnostica: nunca debe frenar el loop,
// LoRa, Ethernet ni la lectura GAO.
static bool serialWriteNonBlocking(const char* text, size_t length) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS || !text || length == 0 || !Serial) return false;

  int available = Serial.availableForWrite();
  if (available < 0 || static_cast<size_t>(available) < length) return false;

  return Serial.write(reinterpret_cast<const uint8_t*>(text), length) == length;
}

static bool serialWriteNonBlocking(const String& text) {
  return serialWriteNonBlocking(text.c_str(), text.length());
}

static void serialPrintfNonBlocking(const char* format, ...) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS || !format) return;

  char buffer[256];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);

  if (length <= 0) return;
  size_t safeLength = static_cast<size_t>(length);
  if (safeLength >= sizeof(buffer)) safeLength = sizeof(buffer) - 1;
  serialWriteNonBlocking(buffer, safeLength);
}

// Antes de cada acceso al SX1278 se deselecciona explicitamente el ENC28J60.
// Esto conserva el funcionamiento Ethernet normal, pero evita contencion en
// MISO cuando ambos dispositivos comparten el bus SPI.
static inline void selectLoRaOnSharedSpi() {
  digitalWrite(ETH_CS_PIN, HIGH);
  delayMicroseconds(ZenitLoRaConfig::SHARED_SPI_GUARD_US);
}

static inline void selectEthernetOnSharedSpi() {
  digitalWrite(LORA_SS_PIN, HIGH);
  delayMicroseconds(ZenitLoRaConfig::SHARED_SPI_GUARD_US);
}

// RegVersion (0x42) permite comprobar que el bus SPI llega al SX127x antes
// de depender de LoRa.begin(). SX1276/77/78/79 normalmente responde 0x12.
static uint8_t readLoRaRegister(uint8_t address) {
  selectLoRaOnSharedSpi();
  SPI.beginTransaction(SPISettings(LORA_SPI_FREQUENCY, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_SS_PIN, LOW);
  SPI.transfer(address & 0x7F);
  uint8_t value = SPI.transfer(0x00);
  digitalWrite(LORA_SS_PIN, HIGH);
  SPI.endTransaction();
  return value;
}

static void logLoRaChipDiagnostic() {
  uint8_t version = readLoRaRegister(0x42);
  char hexVersion[5];
  snprintf(hexVersion, sizeof(hexVersion), "0x%02X", version);
  if (version == 0x12) {
    serialPrintfNonBlocking("[LORA] SPI SX127x OK | RegVersion=%s\n", hexVersion);
  } else {
    serialPrintfNonBlocking("[LORA] ADVERTENCIA SPI | RegVersion=%s (se esperaba 0x12). Revisar CS/RST/MISO/alimentacion.\n", hexVersion);
  }
}

static uint32_t loraSelectedFrequencyHz() {
  switch (LORA_FREQ_PRESET) {
    case LORA_FREQ_433_000: return 433000000UL;
    case LORA_FREQ_433_920: return 433920000UL;
    case LORA_FREQ_434_000: return 434000000UL;
    case LORA_FREQ_470_000: return 470000000UL;
    case LORA_FREQ_868_000: return 868000000UL;
    case LORA_FREQ_915_000: return 915000000UL;
    case LORA_FREQ_CUSTOM:  return LORA_CUSTOM_FREQUENCY;
    default:                return 433000000UL;
  }
}

static const char* loraSelectedFrequencyLabel() {
  switch (LORA_FREQ_PRESET) {
    case LORA_FREQ_433_000: return "433.000 MHz";
    case LORA_FREQ_433_920: return "433.920 MHz";
    case LORA_FREQ_434_000: return "434.000 MHz";
    case LORA_FREQ_470_000: return "470.000 MHz";
    case LORA_FREQ_868_000: return "868.000 MHz";
    case LORA_FREQ_915_000: return "915.000 MHz";
    case LORA_FREQ_CUSTOM:  return ZenitLoRaConfig::FREQUENCY_LABEL;
    default:                return "433.000 MHz";
  }
}

static bool loraFrequencyLooksOutOfRangeForSX1278(uint32_t frequencyHz) {
  return frequencyHz < 137000000UL || frequencyHz > 525000000UL;
}

// =======================================================
// Timeslot LoRa
// =======================================================

static constexpr bool LORA_USE_TIMESLOT = !ENABLE_LORA_TEST_MODE;
static constexpr bool LORA_USE_JITTER   = false;
static constexpr uint32_t PERIOD_MS = 200;
static constexpr uint32_t WINDOW_MS = 40;
static constexpr uint32_t JITTER_MIN_MS = 20;
static constexpr uint32_t JITTER_MAX_MS = 150;
static constexpr uint32_t LORA_TX_WAIT_BUDGET_MS = 60;

static uint32_t g_timeslotOffsetMs = 0;
static uint32_t g_lastLoRaDiagMs = 0;
static constexpr uint32_t LORA_DIAG_MS = 30000;
static uint32_t g_lastLoRaHeartbeatMs = 0;
static uint32_t g_loraHeartbeatSeq = 0;
static constexpr uint32_t LORA_HEARTBEAT_MS = ZenitLoRaConfig::PAIR_HEARTBEAT_INTERVAL_MS;
static constexpr uint32_t LORA_SEARCH_MS = ZenitLoRaConfig::PAIR_SEARCH_INTERVAL_MS;
static constexpr uint32_t LORA_LINK_TIMEOUT_MS = ZenitLoRaConfig::PAIR_LINK_TIMEOUT_MS;
static uint32_t g_lastLoRaTestMs = 0;
static uint32_t g_loraTestSeq = 0;
static constexpr uint32_t LORA_TEST_TX_MS = 2000;
static uint32_t g_loraReliableSeq = 0;
static constexpr uint32_t LORA_ACK_TIMEOUT_MS = 1200;
static constexpr uint8_t LORA_ACK_MAX_RETRIES = 4;
static constexpr int LORA_WIRE_FRAME_MAX = 248;
static constexpr uint8_t ACK_KIND_NONE = 0;
static constexpr uint8_t ACK_KIND_DATA = 1;
static constexpr uint8_t ACK_KIND_LINK = 2;

static bool g_pendingAwaitingAck = false;
static uint8_t g_pendingExpectedAckKind = ACK_KIND_NONE;
static uint32_t g_pendingAckSeq = 0;
static uint32_t g_pendingAckSentMs = 0;
static char g_pendingWireFrame[LORA_WIRE_FRAME_MAX + 1] = {0};

struct LoRaAckPeer {
  char receiverId[48];
  uint32_t lastAckMs;
  uint32_t lastAckSeq;
  bool active;
};

static LoRaAckPeer g_ackPeer = {};

enum LoRaPairState : uint8_t {
  LORA_PAIR_SEARCHING = 0,
  LORA_PAIR_LINKED = 1
};

static LoRaPairState g_pairState = LORA_PAIR_SEARCHING;

// =======================================================
// SD
// =======================================================

// MicroSD en bus SPI dedicado informado por fabricante
static constexpr int SD_MISO_PIN = 47;
static constexpr int SD_MOSI_PIN = 14;
static constexpr int SD_SCK_PIN  = 21;
static constexpr int SD_CS_PIN   = 13;

#if defined(ARDUINO_ARCH_ESP32)
SPIClass g_sdSPI(HSPI);
#endif

static bool g_sdOk = false;
static const char* SD_LOG_PATH = "/zenit_sender_log.csv";
static const char* SD_BUFFER_PATH = "/zenit_sender_buffer.log";

// =======================================================
// BLE
// =======================================================

BLEScan* g_scan = nullptr;
static uint32_t g_lastBleScanMs = 0;
static constexpr uint32_t BLE_SCAN_EVERY_MS = 3000;
static constexpr uint32_t BLE_SCAN_SECONDS = 1;

// =======================================================
// Sensores - placeholder
// =======================================================

static constexpr uint32_t SENSOR_READ_EVERY_MS = 5000;
static uint32_t g_lastSensorReadMs = 0;

// ADC externo ADS1115 informado por fabricante.
// I2C: SDA=GPIO11, SCL=GPIO12, address=0x48.
static constexpr int I2C_SDA_PIN = 11;
static constexpr int I2C_SCL_PIN = 12;
static constexpr uint8_t ADS1115_ADDR = 0x48;
Adafruit_ADS1115 g_ads;
static bool g_adsOk = false;

// =======================================================
// Cola de salida hacia LoRa
// =======================================================

static constexpr FrameSrc SRC_ETH = 1;
static constexpr FrameSrc SRC_WIFI = 2;
static constexpr FrameSrc SRC_BLE = 3;
static constexpr FrameSrc SRC_SENSOR = 4;
static constexpr FrameSrc SRC_DIAG = 5;
static constexpr FrameSrc SRC_GAO = 6;
static constexpr FrameSrc SRC_LINK = 7;
static constexpr FrameSrc SRC_TEST = 8;

static constexpr int QUEUE_CAP = 64;
static constexpr int FRAME_MAX = 260;
// El sobreencabezado confiable ocupa espacio dentro de LORA_WIRE_FRAME_MAX.
// Las tramas largas se dividen en fragmentos antes de entrar a la cola.
static constexpr int LORA_APP_PAYLOAD_SAFE_MAX = 190;
static constexpr int LORA_FRAGMENT_CHUNK_MAX = 160;
static constexpr int QUEUE_GAO_RESERVE = 8;
static constexpr int GAO_QUEUE_HIGH_WATERMARK = 24;
static constexpr uint32_t GAO_MIN_SEND_GAP_MS = 1500;
static constexpr int GAO_RECENT_KEY_SLOTS = 48;

static FrameItem g_queue[QUEUE_CAP];
static volatile int g_qHead = 0;
static volatile int g_qTail = 0;

static bool g_hasPendingTx = false;
static FrameItem g_pendingTx = {};
static uint32_t g_loraFragmentMessageId = 0;

struct GaoRecentKeyItem {
  char key[96];
  uint32_t lastMs;
};

static GaoRecentKeyItem g_gaoRecentKeys[GAO_RECENT_KEY_SLOTS] = {};
static void enqueueOutgoingFrame(FrameSrc src, String frame);
static bool g_networkLogForwarding = false;

static int qCount() {
  int count = g_qHead - g_qTail;
  if (count < 0) count += QUEUE_CAP;
  return count;
}

static bool queuePush(FrameSrc src, const char* data, size_t len) {
  // Inserta al final de la cola circular. Aun no transmite: serviceLoRaTx()
  // es el unico encargado de sacar la trama y usar el radio.
  if (!data || len == 0) return false;
  if (len >= FRAME_MAX) len = FRAME_MAX - 1;

  int nextHead = g_qHead + 1;
  if (nextHead >= QUEUE_CAP) nextHead = 0;
  if (nextHead == g_qTail) return false;

  FrameItem& item = g_queue[g_qHead];
  item.src = src;
  item.len = (uint16_t)len;
  memcpy(item.data, data, len);
  item.data[len] = '\0';
  item.retries = 0;

  g_qHead = nextHead;
  return true;
}

static bool queuePush(FrameSrc src, const String& frame) {
  return queuePush(src, frame.c_str(), frame.length());
}

static bool queuePop(FrameItem& out) {
  if (g_qTail == g_qHead) return false;

  out = g_queue[g_qTail];
  int nextTail = g_qTail + 1;
  if (nextTail >= QUEUE_CAP) nextTail = 0;
  g_qTail = nextTail;
  return true;
}

// =======================================================
// Utilidades / logs
// =======================================================

static uint32_t computeOffsetFromPorticoId(const char* id) {
  if (!id) return 0;

  int n = (int)strlen(id);
  for (int i = n - 1; i >= 0; --i) {
    if (id[i] >= '0' && id[i] <= '9') {
      int d = id[i] - '0';
      if (d >= 1 && d <= 4) return (uint32_t)d * 50U;
      return 0;
    }
  }

  return 0;
}

static String timestampISO() {
  struct tm timeinfo;
  char ts[32];

  if ((ENABLE_WIFI && g_wifiOk) && getLocalTime(&timeinfo, 10)) {
    strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S", &timeinfo);
    return String(ts);
  }

  snprintf(ts, sizeof(ts), "UPTIME_%lu", (unsigned long)(millis() / 1000UL));
  return String(ts);
}

static void appendLogLineToSD(const String& line) {
  if (!ENABLE_SD_CARD || !g_sdOk) return;

  File f = SD.open(SD_LOG_PATH, FILE_APPEND);
  if (!f) return;
  f.println(line);
  f.close();
}

static void logLine(const char* tag, const String& msg) {
  if (ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS) {
    String line;
    line.reserve(msg.length() + strlen(tag) + 6);
    line += "[";
    line += tag;
    line += "] ";
    line += msg;
    line += "\r\n";
    serialWriteNonBlocking(line);
  }

  appendLogLineToSD(timestampISO() + "," + tag + ",\"" + msg + "\"");
  // Sender: sólo configuración, enlace y errores; evita inundar LoRa con FLOW.
  bool useful = strcmp(tag, "BOOT") == 0 || strcmp(tag, "ETH") == 0 ||
                strcmp(tag, "RECOVERY") == 0 || strcmp(tag, "PAIR") == 0 ||
                msg.indexOf("ERROR") >= 0 || msg.indexOf("FAIL") >= 0;
  if (ZenitLoRaConfig::ENABLE_NETWORK_DIAGNOSTICS && useful && !g_networkLogForwarding) {
    g_networkLogForwarding = true;
    enqueueOutgoingFrame(SRC_DIAG, String("LOG|SENDER|") + PORTICO_ID + "|" + tag + "|" + msg);
    g_networkLogForwarding = false;
  }
}

static bool appendBufferFrame(const String& frame) {
  if (!ENABLE_SD_CARD || !g_sdOk) return false;

  File f = SD.open(SD_BUFFER_PATH, FILE_APPEND);
  if (!f) return false;
  f.println(frame);
  f.close();
  return true;
}

static const char* frameSrcName(FrameSrc src) {
  switch (src) {
    case SRC_ETH: return "ETH";
    case SRC_WIFI: return "WIFI";
    case SRC_BLE: return "BLE";
    case SRC_SENSOR: return "SENSOR";
    case SRC_DIAG: return "DIAG";
    case SRC_GAO: return "GAO";
    case SRC_LINK: return "LINK";
    case SRC_TEST: return "TEST";
    default: return "UNK";
  }
}

static String trimFrame(String frame) {
  frame.trim();
  if (frame.length() >= FRAME_MAX) {
    frame = frame.substring(0, FRAME_MAX - 1);
  }
  return frame;
}

static String framePreview(const String& frame) {
  if (frame.length() <= 120) return frame;
  return frame.substring(0, 120) + "...";
}

static String sanitizeFrameField(String value, size_t maxLen) {
  value.trim();
  value.replace("\r", " ");
  value.replace("\n", " ");
  value.replace("|", "/");
  if (value.length() > (int)maxLen) {
    value = value.substring(0, (int)maxLen);
  }
  return value;
}

static bool parseLongValue(const String& text, long& out) {
  String trimmed = text;
  trimmed.trim();
  if (trimmed.length() == 0) return false;

  char* endPtr = nullptr;
  long value = strtol(trimmed.c_str(), &endPtr, 10);
  if (endPtr == trimmed.c_str()) return false;
  while (endPtr && *endPtr && isspace((unsigned char)*endPtr)) endPtr++;
  if (endPtr && *endPtr) return false;
  out = value;
  return true;
}

static bool parseFloatValue(const String& text, float& out) {
  String trimmed = text;
  trimmed.trim();
  if (trimmed.length() == 0) return false;

  char* endPtr = nullptr;
  float value = strtof(trimmed.c_str(), &endPtr);
  if (endPtr == trimmed.c_str()) return false;
  while (endPtr && *endPtr && isspace((unsigned char)*endPtr)) endPtr++;
  if (endPtr && *endPtr) return false;
  out = value;
  return true;
}

static bool looksLikeHexString(const String& value) {
  if (value.length() == 0 || (value.length() % 2) != 0) return false;
  for (int i = 0; i < value.length(); ++i) {
    char c = value[i];
    bool isHex =
      (c >= '0' && c <= '9') ||
      (c >= 'A' && c <= 'F') ||
      (c >= 'a' && c <= 'f');
    if (!isHex) return false;
  }
  return true;
}

static int base64CharValue(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62;
  if (c == '/' || c == '_') return 63;
  return -1;
}

static bool base64ToHex(const String& value, String& out) {
  out = "";
  uint32_t buffer = 0;
  int bits = 0;
  bool decodedAny = false;
  static const char* HEX_CHARS = "0123456789ABCDEF";

  for (int i = 0; i < value.length(); ++i) {
    char c = value[i];
    if (c == '=') break;
    if (c == ' ' || c == '\r' || c == '\n' || c == '\t') continue;

    int v = base64CharValue(c);
    if (v < 0) return false;

    buffer = (buffer << 6) | (uint32_t)v;
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      uint8_t byteVal = (uint8_t)((buffer >> bits) & 0xFFU);
      out += HEX_CHARS[(byteVal >> 4) & 0x0F];
      out += HEX_CHARS[byteVal & 0x0F];
      decodedAny = true;
    }
  }

  return decodedAny && out.length() > 0;
}

static String base64EncodeAscii(const String& value) {
  static const char* B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  String out;

  for (int i = 0; i < value.length(); i += 3) {
    uint32_t block = ((uint8_t)value[i]) << 16;
    bool hasB1 = (i + 1) < value.length();
    bool hasB2 = (i + 2) < value.length();

    if (hasB1) block |= ((uint8_t)value[i + 1]) << 8;
    if (hasB2) block |= (uint8_t)value[i + 2];

    out += B64[(block >> 18) & 0x3F];
    out += B64[(block >> 12) & 0x3F];
    out += hasB1 ? B64[(block >> 6) & 0x3F] : '=';
    out += hasB2 ? B64[block & 0x3F] : '=';
  }

  return out;
}

static String normalizeIdentifier(String value) {
  value.trim();
  if (value.length() == 0) return "";

  if (looksLikeHexString(value)) {
    value.toUpperCase();
    return value;
  }

  if (value.length() < 16 || (value.length() % 4) != 0) {
    return sanitizeFrameField(value, 64);
  }

  String decodedHex;
  if (base64ToHex(value, decodedHex)) {
    return decodedHex;
  }

  return sanitizeFrameField(value, 64);
}

static bool looksLikeIsoTimestamp(const String& value) {
  return value.indexOf('T') > 0 &&
         value.indexOf(':') > 0 &&
         (value.indexOf('-') > 0 || value.indexOf('/') > 0);
}

static bool jsonFindValueStart(const String& json, const char* key, int& valuePos) {
  String pattern = String("\"") + key + "\"";
  int keyPos = json.indexOf(pattern);
  if (keyPos < 0) return false;

  int colonPos = json.indexOf(':', keyPos + pattern.length());
  if (colonPos < 0) return false;

  valuePos = colonPos + 1;
  while (valuePos < json.length() && isspace((unsigned char)json[valuePos])) {
    valuePos++;
  }
  return valuePos < json.length();
}

static bool jsonExtractScalar(const String& json, const char* key, String& out) {
  int valuePos = 0;
  if (!jsonFindValueStart(json, key, valuePos)) return false;

  out = "";
  if (json[valuePos] == '"') {
    bool escaped = false;
    for (int i = valuePos + 1; i < json.length(); ++i) {
      char c = json[i];
      if (escaped) {
        out += c;
        escaped = false;
        continue;
      }
      if (c == '\\') {
        escaped = true;
        continue;
      }
      if (c == '"') {
        return true;
      }
      out += c;
    }
    return false;
  }

  int endPos = valuePos;
  while (endPos < json.length()) {
    char c = json[endPos];
    if (c == ',' || c == '}' || c == ']' || c == '\r' || c == '\n') break;
    endPos++;
  }

  out = json.substring(valuePos, endPos);
  out.trim();
  if (out == "null") out = "";
  return out.length() > 0;
}

static bool looksLikeHttpRequestLine(const String& line) {
  return line.startsWith("GET ") ||
         line.startsWith("POST ") ||
         line.startsWith("PUT ") ||
         line.startsWith("PATCH ") ||
         line.startsWith("DELETE ") ||
         line.startsWith("HEAD ") ||
         line.startsWith("OPTIONS ");
}

static void logFlow(const String& stage, FrameSrc src, const String& frame) {
  logLine("FLOW", stage +
                  " | src=" + frameSrcName(src) +
                  " | len=" + String(frame.length()) +
                  " | data=" + framePreview(frame));
}

// Centraliza el ingreso de cualquier productor a la cola de salida LoRa.
static void enqueueOutgoingFrame(FrameSrc src, String frame) {
  // Punto unico de entrada a LoRa. Evita que Ethernet/GAO/BLE transmitan
  // directamente mientras el radio esta ocupado esperando un ACK.
  frame = trimFrame(frame);
  if (frame.length() == 0) return;

  // LOG es opcional: no debe desplazar EPC/RFID ni provocar reintentos/SD.
  if (src == SRC_DIAG && qCount() >= (QUEUE_CAP - 16)) return;

  if (!ENABLE_LORA_TEST_MODE &&
      src != SRC_LINK &&
      g_pairState != LORA_PAIR_LINKED) {
    logLine("PAIR", String("Trama descartada mientras BUSCANDO pareja=") + PAIR_ID +
                    " | src=" + frameSrcName(src));
    return;
  }

  if (frame.length() > LORA_APP_PAYLOAD_SAFE_MAX) {
    const int total = (frame.length() + LORA_FRAGMENT_CHUNK_MAX - 1) / LORA_FRAGMENT_CHUNK_MAX;
    const uint32_t messageId = ++g_loraFragmentMessageId;
    if (total < 2 || total > 9 || (qCount() + total) >= QUEUE_CAP) {
      logLine("QUEUE", String("Trama larga no cabe para fragmentar; se guarda en SD | len=") +
                       String(frame.length()));
      appendBufferFrame(frame);
      return;
    }

    for (int part = 1; part <= total; ++part) {
      int start = (part - 1) * LORA_FRAGMENT_CHUNK_MAX;
      String fragment = String("LORA_FRAG|") + String(messageId) + "|" +
                        String(part) + "|" + String(total) + "|" +
                        frame.substring(start, start + LORA_FRAGMENT_CHUNK_MAX);
      if (!queuePush(src, fragment)) {
        logLine("QUEUE", "Fallo al encolar fragmento; trama original a SD.");
        appendBufferFrame(frame);
        return;
      }
    }
    logLine("LORA", String("Trama fragmentada msg=") + String(messageId) +
                    " partes=" + String(total) + " len=" + String(frame.length()));
    return;
  }

  if (src == SRC_GAO && qCount() >= (QUEUE_CAP - QUEUE_GAO_RESERVE)) {
    logLine("QUEUE", "Reserva de control activa. Se guarda en SD desde GAO");
    appendBufferFrame(frame);
    return;
  }

  if (!queuePush(src, frame)) {
    logLine("QUEUE", String("Cola llena. Se guarda en SD desde ") + frameSrcName(src));
    appendBufferFrame(frame);
    return;
  }

  logFlow("Cola LoRa OK", src, frame);
}

static int normalizeReaderRssi(long rawRssi) {
  long absValue = rawRssi < 0 ? -rawRssi : rawRssi;
  if (absValue >= 1000) {
    return (int)((rawRssi < 0) ? ((rawRssi - 50) / 100) : ((rawRssi + 50) / 100));
  }
  return (int)rawRssi;
}

static bool buildRfidCompactFrameFromJson(const String& json, const String& fallbackReaderCode, String& frameOut) {
  if (json.indexOf("\"tagInventoryEvent\"") < 0 &&
      json.indexOf("\"epc\"") < 0 &&
      json.indexOf("\"epcHex\"") < 0 &&
      json.indexOf("\"tid\"") < 0 &&
      json.indexOf("\"tidHex\"") < 0) {
    return false;
  }

  String rawValue;
  String epc = "";
  if (jsonExtractScalar(json, "epcHex", rawValue) || jsonExtractScalar(json, "epc", rawValue)) {
    epc = normalizeIdentifier(rawValue);
  }
  epc = sanitizeFrameField(epc, 64);
  if (epc.length() == 0) return false;

  String ts = "";
  if (!jsonExtractScalar(json, "ts_edge", ts) &&
      !jsonExtractScalar(json, "lastSeenTime", ts) &&
      !jsonExtractScalar(json, "eventTimestamp", ts) &&
      !jsonExtractScalar(json, "timestamp", ts)) {
    ts = timestampISO();
  }
  if (!looksLikeIsoTimestamp(ts)) {
    ts = timestampISO();
  }
  ts = sanitizeFrameField(ts, 40);

  String readerCode = "";
  if (!jsonExtractScalar(json, "hostname", readerCode) &&
      !jsonExtractScalar(json, "reader", readerCode) &&
      !jsonExtractScalar(json, "reader_code", readerCode)) {
    readerCode = fallbackReaderCode;
  }
  readerCode = sanitizeFrameField(readerCode, 32);

  String readerHost = "";
  if (!jsonExtractScalar(json, "readerHost", readerHost) &&
      !jsonExtractScalar(json, "reader_host", readerHost) &&
      !jsonExtractScalar(json, "host", readerHost)) {
    readerHost = fallbackReaderCode;
  }
  readerHost = sanitizeFrameField(readerHost, 32);

  String antennaPort = "";
  String antennaName = "";
  String rssi = "";
  String tid = "";
  String frequency = "";
  String phaseAngle = "";
  String txPower = "";

  if (jsonExtractScalar(json, "antennaPort", rawValue) || jsonExtractScalar(json, "antenna_port", rawValue)) {
    long portValue = 0;
    if (parseLongValue(rawValue, portValue)) antennaPort = String(portValue);
  }

  if (jsonExtractScalar(json, "antennaName", rawValue) || jsonExtractScalar(json, "antenna_name", rawValue)) {
    antennaName = sanitizeFrameField(rawValue, 24);
  }

  if (jsonExtractScalar(json, "peakRssiCdbm", rawValue) ||
      jsonExtractScalar(json, "peakRssi", rawValue) ||
      jsonExtractScalar(json, "rssi", rawValue)) {
    long rssiValue = 0;
    if (parseLongValue(rawValue, rssiValue)) {
      rssi = String(normalizeReaderRssi(rssiValue));
    }
  }

  if (jsonExtractScalar(json, "tidHex", rawValue) || jsonExtractScalar(json, "tid", rawValue)) {
    tid = sanitizeFrameField(normalizeIdentifier(rawValue), 64);
  }

  if (jsonExtractScalar(json, "frequency", rawValue)) {
    long freqValue = 0;
    if (parseLongValue(rawValue, freqValue)) frequency = String(freqValue);
  }

  if (jsonExtractScalar(json, "phaseAngle", rawValue) || jsonExtractScalar(json, "phase_angle", rawValue)) {
    float phaseValue = 0.0f;
    if (parseFloatValue(rawValue, phaseValue)) phaseAngle = String(phaseValue, 2);
  }

  if (jsonExtractScalar(json, "transmitPowerCdbm", rawValue) || jsonExtractScalar(json, "transmit_power_cdbm", rawValue)) {
    long txValue = 0;
    if (parseLongValue(rawValue, txValue)) txPower = String(txValue);
  }

  String frame = String("RFID|") + epc + "|" + ts + "|" + readerCode + "|" + readerHost + "|" +
                 antennaPort + "|" + antennaName + "|" + rssi + "|" + tid + "|" +
                 frequency + "|" + phaseAngle + "|" + txPower;

  frameOut = trimFrame(frame);
  return frameOut.startsWith("RFID|") && frameOut.length() > 10;
}

static int extractJsonCandidates(const String& body, String* out, int maxOut) {
  if (!out || maxOut <= 0) return 0;

  String trimmed = trimFrame(body);
  if (trimmed.length() == 0) return 0;

  int count = 0;
  if (trimmed[0] == '{') {
    out[count++] = trimmed;
    return count;
  }

  if (trimmed[0] != '[') {
    out[count++] = trimmed;
    return count;
  }

  bool inString = false;
  bool escaped = false;
  int arrayDepth = 0;
  int objectDepth = 0;
  int objectStart = -1;

  for (int i = 0; i < trimmed.length() && count < maxOut; ++i) {
    char c = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c == '\\') {
        escaped = true;
      } else if (c == '"') {
        inString = false;
      }
      continue;
    }

    if (c == '"') {
      inString = true;
      continue;
    }

    if (c == '[') {
      arrayDepth++;
      continue;
    }

    if (c == ']') {
      if (arrayDepth > 0) arrayDepth--;
      continue;
    }

    if (c == '{') {
      if (arrayDepth == 1 && objectDepth == 0) {
        objectStart = i;
      }
      objectDepth++;
      continue;
    }

    if (c == '}') {
      if (objectDepth > 0) objectDepth--;
      if (arrayDepth == 1 && objectDepth == 0 && objectStart >= 0) {
        out[count++] = trimmed.substring(objectStart, i + 1);
        objectStart = -1;
      }
    }
  }

  if (count == 0) {
    out[count++] = trimmed;
  }

  return count;
}

static String frameDedupKey(const String& frame) {
  String fields[12];
  int fieldIndex = 0;
  int start = 0;

  for (int i = 0; i <= frame.length() && fieldIndex < 12; ++i) {
    if (i == frame.length() || frame[i] == '|') {
      fields[fieldIndex++] = frame.substring(start, i);
      start = i + 1;
    }
  }

  if (fieldIndex < 8) return frame;
  return fields[1] + "|" + fields[2] + "|" + fields[5] + "|" + fields[6] + "|" + fields[7] + "|" + fields[8];
}

static String gaoFlowKey(const String& frame) {
  if (!frame.startsWith("RFID|")) return frame;

  String fields[6];
  int fieldIndex = 0;
  int start = 0;

  for (int i = 0; i <= frame.length() && fieldIndex < 6; ++i) {
    if (i == frame.length() || frame[i] == '|') {
      fields[fieldIndex++] = frame.substring(start, i);
      start = i + 1;
    }
  }

  if (fieldIndex < 6) return frame;
  return fields[1] + "|" + fields[3] + "|" + fields[5];
}

static bool shouldEnqueueGaoFrame(const String& frame) {
  String key = gaoFlowKey(frame);
  if (key.length() == 0) return false;

  uint32_t now = millis();
  int freeSlot = -1;
  int oldestSlot = 0;
  uint32_t oldestMs = g_gaoRecentKeys[0].lastMs;

  for (int i = 0; i < GAO_RECENT_KEY_SLOTS; ++i) {
    if (g_gaoRecentKeys[i].key[0] == '\0') {
      if (freeSlot < 0) freeSlot = i;
      continue;
    }

    if (strcmp(g_gaoRecentKeys[i].key, key.c_str()) == 0) {
      if ((now - g_gaoRecentKeys[i].lastMs) < GAO_MIN_SEND_GAP_MS) {
        return false;
      }
      g_gaoRecentKeys[i].lastMs = now;
      return true;
    }

    if (g_gaoRecentKeys[i].lastMs < oldestMs) {
      oldestMs = g_gaoRecentKeys[i].lastMs;
      oldestSlot = i;
    }
  }

  int slot = (freeSlot >= 0) ? freeSlot : oldestSlot;
  strncpy(g_gaoRecentKeys[slot].key, key.c_str(), sizeof(g_gaoRecentKeys[slot].key) - 1);
  g_gaoRecentKeys[slot].key[sizeof(g_gaoRecentKeys[slot].key) - 1] = '\0';
  g_gaoRecentKeys[slot].lastMs = now;
  return true;
}

static bool frameAlreadyQueued(const String* emitted, int emittedCount, const String& frame) {
  String wantedKey = frameDedupKey(frame);
  for (int i = 0; i < emittedCount; ++i) {
    if (frameDedupKey(emitted[i]) == wantedKey) return true;
  }
  return false;
}

static int enqueueGaoFramesFromPayload(const String& payload, const String& fallbackReaderCode) {
  String candidates[GAO_CANDIDATE_MAX];
  String emitted[GAO_CANDIDATE_MAX];
  int candidateCount = extractJsonCandidates(payload, candidates, GAO_CANDIDATE_MAX);
  int emittedCount = 0;
  int accepted = 0;

  for (int i = 0; i < candidateCount; ++i) {
    String frame;
    if (!buildRfidCompactFrameFromJson(candidates[i], fallbackReaderCode, frame)) {
      continue;
    }
    if (frameAlreadyQueued(emitted, emittedCount, frame)) {
      continue;
    }
    if (!shouldEnqueueGaoFrame(frame)) {
      continue;
    }

    if (emittedCount < GAO_CANDIDATE_MAX) {
      emitted[emittedCount++] = frame;
    }

    logFlow("GAO RX -> cola LoRa", SRC_GAO, frame);
    enqueueOutgoingFrame(SRC_GAO, frame);
    accepted++;
  }

  return accepted;
}

static void resetEthernetClientState() {
  g_ethLine = "";
  g_ethClientMode = INBOUND_MODE_DETECT;
  g_ethHttpMethod = "";
  g_ethHttpPath = "";
  g_ethHttpContentLength = 0;
  g_ethHttpBody = "";
}

static bool parseHttpRequestLine(const String& line, String& method, String& path) {
  int firstSpace = line.indexOf(' ');
  if (firstSpace <= 0) return false;

  int secondSpace = line.indexOf(' ', firstSpace + 1);
  if (secondSpace <= firstSpace) return false;

  method = line.substring(0, firstSpace);
  path = line.substring(firstSpace + 1, secondSpace);
  method.trim();
  path.trim();
  return method.length() > 0 && path.length() > 0;
}

static void parseHttpHeaderLine(const String& line) {
  int colonPos = line.indexOf(':');
  if (colonPos <= 0) return;

  String key = line.substring(0, colonPos);
  String value = line.substring(colonPos + 1);
  key.trim();
  value.trim();
  key.toLowerCase();

  if (key == "content-length") {
    long parsedLength = 0;
    if (parseLongValue(value, parsedLength) && parsedLength >= 0) {
      g_ethHttpContentLength = (int)parsedLength;
    }
  }
}

static void sendHttpResponse(EthernetClient& client, int statusCode, const String& contentType, const String& body) {
  const char* reason = "OK";
  if (statusCode == 400) reason = "Bad Request";
  else if (statusCode == 405) reason = "Method Not Allowed";
  else if (statusCode == 413) reason = "Payload Too Large";

  client.print(String("HTTP/1.1 ") + String(statusCode) + " " + reason + "\r\n");
  client.print(String("Content-Type: ") + contentType + "\r\n");
  client.print(String("Content-Length: ") + String(body.length()) + "\r\n");
  client.print("Connection: close\r\n\r\n");
  client.print(body);
}

static void finalizeHttpRequest(EthernetClient& client) {
  if (g_ethHttpMethod == "GET") {
    sendHttpResponse(client, 200, "text/plain; charset=utf-8", "ZENIT sender ingest activo\n");
    client.stop();
    resetEthernetClientState();
    return;
  }

  if (g_ethHttpMethod != "POST") {
    sendHttpResponse(client, 405, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"method_not_allowed\"}");
    client.stop();
    resetEthernetClientState();
    return;
  }

  String fallbackReaderCode = client.remoteIP().toString();
  int accepted = ENABLE_GAO_WEBHOOK ? enqueueGaoFramesFromPayload(g_ethHttpBody, fallbackReaderCode) : 0;

  logLine("GAO", String("Webhook HTTP path=") + g_ethHttpPath +
                 " accepted=" + String(accepted) +
                 " bytes=" + String(g_ethHttpBody.length()) +
                 " from=" + fallbackReaderCode);

  String response = String("{\"ok\":true,\"accepted\":") + String(accepted) + "}";
  sendHttpResponse(client, 200, "application/json; charset=utf-8", response);
  client.stop();
  resetEthernetClientState();
}

static String gaoBasicAuthValue() {
  return base64EncodeAscii(String(GAO_READER_USERNAME) + ":" + GAO_READER_PASSWORD);
}

static void resetGaoClientState(bool stopClient = false) {
  if (stopClient && g_gaoClient) {
    g_gaoClient.stop();
  }

  g_gaoHeadersDone = false;
  g_gaoChunked = false;
  g_gaoStatusCode = 0;
  g_gaoHeaderLine = "";
  g_gaoBodyLine = "";
  g_gaoChunkLine = "";
  g_gaoChunkBytesRemaining = 0;
  g_gaoChunkTrailerBytesRemaining = 0;
  g_lastGaoByteMs = 0;
}

static void closeNetworkInputsForLoRaWindow() {
  // No dejar sockets del GAO ni del webhook abiertos mientras se modula LoRa.
  resetGaoClientState(true);
  if (g_ethClient) {
    g_ethClient.stop();
  }
  resetEthernetClientState();
}

static bool senderInNetworkWindow() {
  return g_senderTransportPhase == SENDER_PHASE_NETWORK;
}

static void serviceSenderTransportSchedule() {
  uint32_t now = millis();
  uint32_t windowMs = senderInNetworkWindow() ? SENDER_NETWORK_WINDOW_MS : SENDER_LORA_WINDOW_MS;
  if ((uint32_t)(now - g_senderPhaseStartedMs) < windowMs) return;

  g_senderPhaseStartedMs = now;
  if (senderInNetworkWindow()) {
    closeNetworkInputsForLoRaWindow();
    g_senderTransportPhase = SENDER_PHASE_LORA;
    logLine("SCHED", "Sender: ventana RED finalizada; 45 s exclusivos LoRa.");
  } else {
    g_senderTransportPhase = SENDER_PHASE_NETWORK;
    logLine("SCHED", "Sender: ventana LoRa finalizada; 45 s de lectura RED/GAO.");
  }
}

static bool parseHttpStatusCode(const String& line, int& statusCode) {
  int firstSpace = line.indexOf(' ');
  if (firstSpace < 0) return false;

  int secondSpace = line.indexOf(' ', firstSpace + 1);
  String codeText = (secondSpace > firstSpace)
                  ? line.substring(firstSpace + 1, secondSpace)
                  : line.substring(firstSpace + 1);

  long parsed = 0;
  if (!parseLongValue(codeText, parsed)) return false;
  statusCode = (int)parsed;
  return statusCode > 0;
}

static bool parseHexUInt32(String text, uint32_t& out) {
  int semiPos = text.indexOf(';');
  if (semiPos >= 0) text = text.substring(0, semiPos);
  text.trim();
  if (text.length() == 0) return false;

  uint32_t value = 0;
  for (int i = 0; i < text.length(); ++i) {
    char c = text[i];
    uint8_t digit = 0;
    if (c >= '0' && c <= '9') digit = (uint8_t)(c - '0');
    else if (c >= 'A' && c <= 'F') digit = (uint8_t)(c - 'A' + 10);
    else if (c >= 'a' && c <= 'f') digit = (uint8_t)(c - 'a' + 10);
    else return false;
    value = (value << 4) | digit;
  }

  out = value;
  return true;
}

static void handleGaoStreamPayloadLine(String line) {
  line = trimFrame(line);
  if (line.length() == 0) return;

  if (line.startsWith("data:")) {
    line = trimFrame(line.substring(5));
  } else if (line.startsWith(":") || line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) {
    return;
  }

  if (line.length() == 0) return;

  int accepted = enqueueGaoFramesFromPayload(line, String(GAO_READER_HOST));
  if (accepted > 0) {
    logLine("GAO", String("Stream event accepted=") + String(accepted));
  }
}

static void handleGaoBodyByte(char c) {
  if (c == '\r') return;

  if (c == '\n') {
    String line = g_gaoBodyLine;
    g_gaoBodyLine = "";
    handleGaoStreamPayloadLine(line);
    return;
  }

  if (g_gaoBodyLine.length() < GAO_STREAM_LINE_MAX) {
    g_gaoBodyLine += c;
  }
}

static void handleGaoResponseHeaderLine(String line) {
  if (line.length() == 0) {
    g_gaoHeadersDone = true;
    if (g_gaoStatusCode != 200) {
      logLine("GAO", String("HTTP stream respondio status=") + String(g_gaoStatusCode));
      resetGaoClientState(true);
      return;
    }

    g_lastGaoByteMs = millis();
    logLine("GAO", String("Stream conectado en ") + GAO_STREAM_PATH +
                   " status=200 chunked=" + (g_gaoChunked ? "YES" : "NO"));
    return;
  }

  if (g_gaoStatusCode == 0 && line.startsWith("HTTP/")) {
    int statusCode = 0;
    if (parseHttpStatusCode(line, statusCode)) {
      g_gaoStatusCode = statusCode;
    }
    return;
  }

  String lower = line;
  lower.toLowerCase();
  if (lower.startsWith("transfer-encoding:") && lower.indexOf("chunked") >= 0) {
    g_gaoChunked = true;
  }
}

static bool gaoWaitForHttpResponse(EthernetClient& client, int& statusCode, uint32_t timeoutMs) {
  String line = "";
  bool statusParsed = false;
  uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    while (client.available()) {
      char c = (char)client.read();
      if (c == '\r') continue;

      if (c == '\n') {
        if (!statusParsed) {
          if (!parseHttpStatusCode(line, statusCode)) return false;
          statusParsed = true;
        } else if (line.length() == 0) {
          return true;
        }
        line = "";
      } else if (line.length() < GAO_HEADER_LINE_MAX) {
        line += c;
      }
    }

    if (!client.connected()) break;
    delay(1);
  }

  return statusParsed;
}

static bool startGaoInventoryIfConfigured() {
  if (!ENABLE_GAO_PULL_CLIENT || !CONFIG_ENABLE_GAO_AUTO_START_INVENTORY) return true;

  EthernetClient client;
  if (!client.connect(GAO_READER_HOST, GAO_READER_PORT)) {
    logLine("GAO", String("No se pudo conectar para iniciar inventory en ") + GAO_READER_HOST);
    return false;
  }

  String path = String("/api/v1/profiles/inventory/presets/") + GAO_INVENTORY_PRESET + "/start";
  client.print(String("POST ") + path + " HTTP/1.1\r\n");
  client.print(String("Host: ") + GAO_READER_HOST + "\r\n");
  client.print(String("Authorization: Basic ") + gaoBasicAuthValue() + "\r\n");
  client.print("Content-Length: 0\r\n");
  client.print("Connection: close\r\n\r\n");

  int statusCode = 0;
  bool ok = gaoWaitForHttpResponse(client, statusCode, GAO_HTTP_TIMEOUT_MS) &&
            statusCode >= 200 && statusCode < 300;
  client.stop();

  logLine("GAO", String("Auto-start inventory preset=") + GAO_INVENTORY_PRESET +
                 " status=" + String(statusCode) +
                 " ok=" + (ok ? "YES" : "NO"));
  return ok;
}

static void connectGaoStreamIfNeeded() {
  if (!ENABLE_GAO_PULL_CLIENT || !g_ethOk || g_gaoClient) return;

  uint32_t now = millis();
  if (g_lastGaoConnectAttemptMs != 0 && (now - g_lastGaoConnectAttemptMs) < GAO_RECONNECT_MS) {
    return;
  }
  g_lastGaoConnectAttemptMs = now;

  resetGaoClientState(true);
  startGaoInventoryIfConfigured();

  logLine("GAO", String("Conectando stream a ") + GAO_READER_HOST + ":" + String(GAO_READER_PORT));
  if (!g_gaoClient.connect(GAO_READER_HOST, GAO_READER_PORT)) {
    logLine("GAO", "ERROR: no se pudo abrir socket hacia reader.");
    resetGaoClientState(true);
    return;
  }

  g_gaoClient.print(String("GET ") + GAO_STREAM_PATH + " HTTP/1.1\r\n");
  g_gaoClient.print(String("Host: ") + GAO_READER_HOST + "\r\n");
  g_gaoClient.print(String("Authorization: Basic ") + gaoBasicAuthValue() + "\r\n");
  g_gaoClient.print("Accept: text/event-stream\r\n");
  g_gaoClient.print("Cache-Control: no-cache\r\n");
  g_gaoClient.print("Connection: keep-alive\r\n\r\n");
}

static void serviceGaoChunkedByte(char c) {
  if (g_gaoChunkTrailerBytesRemaining > 0) {
    g_gaoChunkTrailerBytesRemaining--;
    return;
  }

  if (g_gaoChunkBytesRemaining > 0) {
    handleGaoBodyByte(c);
    g_gaoChunkBytesRemaining--;
    if (g_gaoChunkBytesRemaining == 0) {
      g_gaoChunkTrailerBytesRemaining = 2;
    }
    return;
  }

  if (c == '\r') return;

  if (c == '\n') {
    uint32_t chunkSize = 0;
    if (!parseHexUInt32(g_gaoChunkLine, chunkSize)) {
      logLine("GAO", String("Chunk size invalido: ") + g_gaoChunkLine);
      resetGaoClientState(true);
      return;
    }

    g_gaoChunkLine = "";
    if (chunkSize == 0) {
      logLine("GAO", "Stream chunked finalizado por reader.");
      resetGaoClientState(true);
      return;
    }

    g_gaoChunkBytesRemaining = chunkSize;
    return;
  }

  if (g_gaoChunkLine.length() < GAO_CHUNK_LINE_MAX) {
    g_gaoChunkLine += c;
  }
}

static void serviceGaoClient() {
  if (!ENABLE_GAO_PULL_CLIENT) return;

  connectGaoStreamIfNeeded();
  if (!g_gaoClient) return;
  if (g_gaoHeadersDone && qCount() >= GAO_QUEUE_HIGH_WATERMARK) {
    return;
  }

  size_t processedBytes = 0;
  while (g_gaoClient.available() && processedBytes < GAO_STREAM_RX_BUDGET_BYTES) {
    char c = (char)g_gaoClient.read();
    processedBytes++;
    g_lastGaoByteMs = millis();

    if (!g_gaoHeadersDone) {
      if (c == '\r') continue;
      if (c == '\n') {
        String line = g_gaoHeaderLine;
        g_gaoHeaderLine = "";
        handleGaoResponseHeaderLine(line);
        if (!g_gaoClient) return;
      } else if (g_gaoHeaderLine.length() < GAO_HEADER_LINE_MAX) {
        g_gaoHeaderLine += c;
      }
      continue;
    }

    if (g_gaoChunked) {
      serviceGaoChunkedByte(c);
    } else {
      handleGaoBodyByte(c);
    }

    if (!g_gaoClient) return;
  }

  if (g_gaoClient && g_gaoHeadersDone && g_lastGaoByteMs != 0 &&
      (millis() - g_lastGaoByteMs) > GAO_STREAM_IDLE_TIMEOUT_MS) {
    logLine("GAO", String("Stream inactivo hace ") +
                   String(millis() - g_lastGaoByteMs) +
                   " ms. Reconexion.");
    resetGaoClientState(true);
    return;
  }

  if (g_gaoClient && !g_gaoClient.connected() && !g_gaoClient.available()) {
    logLine("GAO", "Stream desconectado. Reintentando...");
    resetGaoClientState(true);
  }
}

// =======================================================
// SPI / SD
// =======================================================

static void prepareSpiPins() {
  pinMode(LORA_SS_PIN, OUTPUT);
  digitalWrite(LORA_SS_PIN, HIGH);

  if (ENABLE_SD_CARD) {
    pinMode(SD_CS_PIN, OUTPUT);
    digitalWrite(SD_CS_PIN, HIGH);
  }

  // LoRa y ENC28J60 comparten MISO/MOSI/SCK. CS debe quedar definido aun
  // cuando Ethernet este deshabilitada: un CS flotante puede dejar al ENC
  // manejando MISO e impedir que el SX1278 responda.
  pinMode(ETH_CS_PIN, OUTPUT);
  digitalWrite(ETH_CS_PIN, HIGH);
  pinMode(ETH_INT_PIN, INPUT_PULLUP);

  if (ETH_RST_PIN >= 0) {
    pinMode(ETH_RST_PIN, OUTPUT);
    if (ENABLE_ETHERNET) {
      digitalWrite(ETH_RST_PIN, LOW);
      delay(10);
      digitalWrite(ETH_RST_PIN, HIGH);
      delay(50);
    } else {
      // En la prueba LoRa se mantiene el ENC en reset para que libere el bus.
      digitalWrite(ETH_RST_PIN, LOW);
    }
  }

  // SPI global para LoRa SX1278 y Ethernet ENC28J60. No hay accesos en
  // paralelo: el loop es secuencial y cada driver libera su CS al terminar.
  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_SS_PIN);
  delay(10);

#if defined(ARDUINO_ARCH_ESP32)
  if (ENABLE_SD_CARD) {
    // SPI dedicado para MicroSD.
    g_sdSPI.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);
  }
#endif
}

static void initSD() {
  if (!ENABLE_SD_CARD) {
    logLine("SD", "SD deshabilitada.");
    return;
  }

  if (!SD.begin(SD_CS_PIN, g_sdSPI, 10000000)) {
    g_sdOk = false;
    logLine("SD", "ERROR: SD.begin() fallo.");
    return;
  }

  g_sdOk = true;
  logLine("SD", "MicroSD OK.");
}

// =======================================================
// LoRa
// =======================================================

static bool loraInWindow(uint32_t nowMs) {
  if (!LORA_USE_TIMESLOT) return true;
  return (((nowMs + g_timeslotOffsetMs) % PERIOD_MS) < WINDOW_MS);
}

static void loraMaybeJitter() {
  if (!LORA_USE_JITTER) return;
  delay(random(JITTER_MIN_MS, JITTER_MAX_MS + 1));
}

static void clearPendingAckState() {
  g_pendingAwaitingAck = false;
  g_pendingExpectedAckKind = ACK_KIND_NONE;
  g_pendingAckSeq = 0;
  g_pendingAckSentMs = 0;
  g_pendingWireFrame[0] = '\0';
}

static bool isSenderPairLinked() {
  return g_pairState == LORA_PAIR_LINKED &&
         g_ackPeer.active &&
         g_ackPeer.lastAckMs != 0 &&
         (uint32_t)(millis() - g_ackPeer.lastAckMs) < LORA_LINK_TIMEOUT_MS;
}

static void enterSenderSearchingMode(const String& reason) {
  if (g_pairState == LORA_PAIR_SEARCHING) return;

  closeNetworkInputsForLoRaWindow();
  g_pairState = LORA_PAIR_SEARCHING;
  g_ackPeer.active = false;
  g_ackPeer.receiverId[0] = '\0';
  g_senderTransportPhase = SENDER_PHASE_LORA;
  g_senderPhaseStartedMs = millis();

  // No retransmitir lecturas antiguas mientras se intenta recuperar la pareja.
  g_qHead = 0;
  g_qTail = 0;
  g_hasPendingTx = false;
  clearPendingAckState();

  logLine("PAIR", String("Estado BUSCANDO | pareja=") + PAIR_ID +
                  " | receiver=" + EXPECTED_RECEIVER_ID +
                  " | motivo=" + reason);
}

static void monitorSenderPairLink() {
  if (g_pairState != LORA_PAIR_LINKED || !g_ackPeer.active || g_ackPeer.lastAckMs == 0) return;

  uint32_t ageMs = millis() - g_ackPeer.lastAckMs;
  if (ageMs < LORA_LINK_TIMEOUT_MS) return;

  enterSenderSearchingMode(String("sin ACK hace ") + String(ageMs) + " ms");
}

static bool parseTrailingSeqField(const String& frame, uint32_t& seqOut) {
  int lastSep = frame.lastIndexOf('|');
  if (lastSep < 0 || lastSep >= (frame.length() - 1)) return false;

  String seqText = trimFrame(frame.substring(lastSep + 1));
  if (seqText.length() == 0) return false;

  seqOut = (uint32_t)strtoul(seqText.c_str(), nullptr, 10);
  return true;
}

static bool buildPendingWireFrame() {
  if (!g_hasPendingTx) return false;
  if (g_pendingWireFrame[0]) return true;

  String payload = trimFrame(String(g_pendingTx.data));
  if (payload.length() == 0) return false;

  if (payload.startsWith("LORA_LINK|")) {
    g_pendingExpectedAckKind = ACK_KIND_LINK;
    if (!parseTrailingSeqField(payload, g_pendingAckSeq)) return false;
    if (payload.length() > LORA_WIRE_FRAME_MAX) return false;
    strncpy(g_pendingWireFrame, payload.c_str(), sizeof(g_pendingWireFrame) - 1);
    g_pendingWireFrame[sizeof(g_pendingWireFrame) - 1] = 0;
    return true;
  }

  if (payload.startsWith("LORA_TEST|")) {
    g_pendingExpectedAckKind = ACK_KIND_DATA;
    if (!parseTrailingSeqField(payload, g_pendingAckSeq)) return false;
    if (payload.length() > LORA_WIRE_FRAME_MAX) return false;
    strncpy(g_pendingWireFrame, payload.c_str(), sizeof(g_pendingWireFrame) - 1);
    g_pendingWireFrame[sizeof(g_pendingWireFrame) - 1] = 0;
    return true;
  }

  g_pendingExpectedAckKind = ACK_KIND_DATA;
  g_pendingAckSeq = ++g_loraReliableSeq;

  String wire = String("LORA_DATA|") + PAIR_ID + "|" + PORTICO_ID + "|" +
                String(g_pendingAckSeq) + "|" + payload;
  if (wire.length() > LORA_WIRE_FRAME_MAX) return false;

  strncpy(g_pendingWireFrame, wire.c_str(), sizeof(g_pendingWireFrame) - 1);
  g_pendingWireFrame[sizeof(g_pendingWireFrame) - 1] = 0;
  return true;
}

static void markAckPeerSeen(const String& receiverId, uint32_t seq) {
  bool changedPeer = (strcmp(g_ackPeer.receiverId, receiverId.c_str()) != 0);
  bool wasSearching = g_pairState != LORA_PAIR_LINKED || !g_ackPeer.active;

  strncpy(g_ackPeer.receiverId, receiverId.c_str(), sizeof(g_ackPeer.receiverId) - 1);
  g_ackPeer.receiverId[sizeof(g_ackPeer.receiverId) - 1] = 0;
  g_ackPeer.lastAckMs = millis();
  g_ackPeer.lastAckSeq = seq;
  g_ackPeer.active = true;
  g_pairState = LORA_PAIR_LINKED;

  if (wasSearching) {
    // La primera tarea despues del enlace es abrir la ventana RED/GAO.
    g_senderTransportPhase = SENDER_PHASE_NETWORK;
    g_senderPhaseStartedMs = millis();
    logLine("PAIR", String("Estado ENLAZADO | pareja=") + PAIR_ID +
                    " | receiver=" + g_ackPeer.receiverId +
                    " | ack_seq=" + String(g_ackPeer.lastAckSeq) +
                    " | inicia ventana RED/GAO");
  } else if (changedPeer) {
    logLine("PAIR", String("Receiver actualizado=") + g_ackPeer.receiverId +
                    " | pareja=" + PAIR_ID);
  }
}

static bool parseAckFrameFields(
  const String& frame,
  const char* prefix,
  String& pairId,
  String& receiverId,
  String& targetId,
  uint32_t& seqOut,
  String& statusOut
) {
  if (!frame.startsWith(prefix)) return false;

  int firstSep = frame.indexOf('|');
  int secondSep = frame.indexOf('|', firstSep + 1);
  int thirdSep = frame.indexOf('|', secondSep + 1);
  int fourthSep = frame.indexOf('|', thirdSep + 1);
  int fifthSep = frame.indexOf('|', fourthSep + 1);

  if (firstSep < 0 || secondSep <= firstSep || thirdSep <= secondSep ||
      fourthSep <= thirdSep || fifthSep <= fourthSep) {
    return false;
  }

  pairId = trimFrame(frame.substring(firstSep + 1, secondSep));
  receiverId = trimFrame(frame.substring(secondSep + 1, thirdSep));
  targetId = trimFrame(frame.substring(thirdSep + 1, fourthSep));
  String seqText = trimFrame(frame.substring(fourthSep + 1, fifthSep));
  statusOut = trimFrame(frame.substring(fifthSep + 1));

  if (pairId.length() == 0 || receiverId.length() == 0 ||
      targetId.length() == 0 || seqText.length() == 0) return false;
  seqOut = (uint32_t)strtoul(seqText.c_str(), nullptr, 10);
  return true;
}

static void handleAckFrame(const String& frame) {
  // Solo libera la trama pendiente si el ACK coincide en tipo y secuencia.
  String pairId;
  String receiverId;
  String targetId;
  String status;
  uint32_t seq = 0;
  uint8_t ackKind = ACK_KIND_NONE;

  if (parseAckFrameFields(frame, "LORA_LINK_ACK|", pairId, receiverId, targetId, seq, status)) {
    ackKind = ACK_KIND_LINK;
  } else if (parseAckFrameFields(frame, "LORA_ACK|", pairId, receiverId, targetId, seq, status)) {
    ackKind = ACK_KIND_DATA;
  } else {
    logLine("LORA", String("RX control desconocido descartado | data=") + framePreview(frame));
    return;
  }

  if (pairId != PAIR_ID) {
    logLine("PAIR", String("ACK de otra pareja descartado | recibido=") + pairId +
                    " | esperado=" + PAIR_ID);
    return;
  }

  if (receiverId != EXPECTED_RECEIVER_ID) {
    logLine("PAIR", String("ACK de receiver no autorizado descartado | recibido=") + receiverId +
                    " | esperado=" + EXPECTED_RECEIVER_ID);
    return;
  }

  if (targetId != PORTICO_ID) {
    logLine("LORA", String("ACK para otro destino descartado | target=") + targetId +
                    " | data=" + framePreview(frame));
    return;
  }

  if (status != "OK") {
    logLine("PAIR", String("ACK rechazado por receiver | status=") + status +
                    " | receiver=" + receiverId);
    return;
  }

  if (ackKind == ACK_KIND_LINK || ENABLE_LORA_TEST_MODE) {
    markAckPeerSeen(receiverId, seq);
  } else if (isSenderPairLinked()) {
    g_ackPeer.lastAckMs = millis();
    g_ackPeer.lastAckSeq = seq;
  } else {
    logLine("PAIR", String("ACK DATA descartado sin enlace previo | pareja=") + PAIR_ID);
    return;
  }
  logLine("LORA", String("ACK RX kind=") + ((ackKind == ACK_KIND_LINK) ? "LINK" : "DATA") +
                  " from=" + receiverId +
                  " seq=" + String(seq) +
                  " status=" + status);

  if (!g_hasPendingTx || !g_pendingAwaitingAck) return;
  if (ackKind != g_pendingExpectedAckKind) return;
  if (seq != g_pendingAckSeq) return;

  String delivered = trimFrame(String(g_pendingTx.data));
  logLine("FLOW", String("LoRa ACK OK | src=") + frameSrcName(g_pendingTx.src) +
                  " | seq=" + String(seq) +
                  " | data=" + framePreview(delivered));

  g_loraAckOkCount++;

  g_hasPendingTx = false;
  clearPendingAckState();
}

static void pollLoRaRx() {
  // El sender normalmente recibe control (ACK o LINK_ACK), por polling.
  if (!ENABLE_LORA || !g_loraOk) return;

  selectLoRaOnSharedSpi();
  int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) return;

  char raw[LORA_WIRE_FRAME_MAX + 1] = {0};
  int idx = 0;
  while (LoRa.available() && idx < LORA_WIRE_FRAME_MAX) {
    int c = LoRa.read();
    if (c < 0) break;
    raw[idx++] = (char)c;
  }
  raw[idx] = 0;

  String frame = trimFrame(String(raw));
  if (frame.length() == 0) {
    LoRa.receive();
    return;
  }

  handleAckFrame(frame);
  LoRa.receive();
}

static void initLoRa() {
  // Reinicia SX1278, verifica SPI y aplica la configuracion de radio comun.
  if (!ENABLE_LORA) {
    logLine("LORA", "LoRa deshabilitado.");
    return;
  }

  g_lastLoRaInitAttemptMs = millis();
  uint32_t frequencyHz = loraSelectedFrequencyHz();
  if (loraFrequencyLooksOutOfRangeForSX1278(frequencyHz)) {
    logLine("LORA", String("ADVERTENCIA: frecuencia ") +
                    String((double)frequencyHz / 1e6, 3) +
                    " MHz fuera de rango para SX1278. Revisar preset/modulo RF.");
  }
  // Aislar el otro esclavo SPI y estabilizar el SX1278 antes de leerlo.
  selectLoRaOnSharedSpi();
  pinMode(LORA_RST_PIN, OUTPUT);
  digitalWrite(LORA_RST_PIN, LOW);
  delay(10);
  digitalWrite(LORA_RST_PIN, HIGH);
  delay(20);

  LoRa.setPins(LORA_SS_PIN, LORA_RST_PIN, LORA_DIO0_PIN);
  // SPI mas conservador para el SX1278 en esta carrier compartida con ENC28J60.
  LoRa.setSPIFrequency(LORA_SPI_FREQUENCY);
  logLoRaChipDiagnostic();

  bool ok = false;
  for (int i = 0; i < 5; ++i) {
    logLine("LORA", String("LoRa.begin intento #") + String(i + 1));
    if (LoRa.begin((long)frequencyHz)) {
      ok = true;
      break;
    }
    delay(300);
  }

  if (!ok) {
    g_loraOk = false;
    logLine("LORA", "ERROR: no se pudo inicializar LoRa.");
    return;
  }

  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setSyncWord(LORA_SYNCWORD);
  LoRa.enableCrc();
  LoRa.setTxPower(LORA_TX_POWER);
  LoRa.receive();

  g_loraOk = true;
  randomSeed((uint32_t)esp_random());

  serialPrintfNonBlocking("[LORA] OK @%.1fMHz | SF=%d | BW=%ld | CR=4/%d | SYNC=0x%02X\n",
                          (double)frequencyHz / 1e6,
                          LORA_SF,
                          (long)LORA_BW,
                          LORA_CR,
                          (unsigned)LORA_SYNCWORD);
  logLine("LORA", String("Frecuencia LoRa seleccionada=") + loraSelectedFrequencyLabel());
  logLine("LORA", String("SPI LoRa=") + String(LORA_SPI_FREQUENCY) + "Hz");
}

static void serviceLoRaRecovery() {
  if (!ENABLE_LORA || g_loraOk) return;

  uint32_t now = millis();
  if (g_lastLoRaInitAttemptMs != 0 &&
      (uint32_t)(now - g_lastLoRaInitAttemptMs) < ZenitLoRaConfig::PERIPHERAL_RECOVERY_MS) {
    return;
  }

  logLine("RECOVERY", "LoRa no disponible; reintentando inicializacion.");
  initLoRa();
  logLine("RECOVERY", String("LoRa recovery=") + (g_loraOk ? "OK" : "FAIL"));
}

static bool sendFrameLoRaNow(const char* data, size_t len) {
  // TX bloqueante; al terminar vuelve de inmediato a RX para recibir el ACK.
  if (!ENABLE_LORA || !g_loraOk || !data || len == 0) return false;

  loraMaybeJitter();
  selectLoRaOnSharedSpi();

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.write((const uint8_t*)data, len);
  bool ok = (LoRa.endPacket() == 1);
  LoRa.receive();
  if (ok) g_loraTxOkCount++;
  return ok;
}

// Despacha la cola respetando la ventana de TX configurada para LoRa.
static void serviceLoRaTx() {
  // Maquina de estados: cola -> TX -> espera ACK -> OK/reintento/recuperacion.
  if (!ENABLE_LORA || !g_loraOk) return;

  if (g_pendingAwaitingAck) {
    if ((millis() - g_pendingAckSentMs) < LORA_ACK_TIMEOUT_MS) {
      return;
    }

    g_pendingTx.retries++;
    if (g_pendingTx.retries > LORA_ACK_MAX_RETRIES) {
      String rawFrame = trimFrame(String(g_pendingTx.data));
      bool linkWasActive = g_pairState == LORA_PAIR_LINKED;
      logLine("FLOW", String("LoRa ACK agotado -> buffer SD | src=") + frameSrcName(g_pendingTx.src) +
                      " | seq=" + String(g_pendingAckSeq) +
                      " | data=" + framePreview(rawFrame));
      appendBufferFrame(rawFrame);
      g_hasPendingTx = false;
      clearPendingAckState();
      if (linkWasActive) {
        enterSenderSearchingMode("ACK agotado; receiver dejo de responder");
      }
      return;
    }

    String wire = String(g_pendingWireFrame);
    logLine("LORA", String("ACK timeout. Reenvio #") + String(g_pendingTx.retries) +
                    " seq=" + String(g_pendingAckSeq));
    logFlow("LoRa RETRY START", g_pendingTx.src, wire);
    if (sendFrameLoRaNow(g_pendingWireFrame, strlen(g_pendingWireFrame))) {
      logFlow("LoRa RETRY OK", g_pendingTx.src, wire);
      g_pendingAckSentMs = millis();
    } else {
      logFlow("LoRa RETRY FAIL", g_pendingTx.src, wire);
    }
    return;
  }

  if (!g_hasPendingTx) {
    if (!queuePop(g_pendingTx)) {
      clearPendingAckState();
      return;
    }
    g_hasPendingTx = true;
    clearPendingAckState();
  }

  if (LORA_USE_TIMESLOT) {
    uint32_t start = millis();
    while (!loraInWindow(millis())) {
      delay(2);
      if (millis() - start >= LORA_TX_WAIT_BUDGET_MS) {
        return;
      }
    }
  }

  if (!buildPendingWireFrame()) {
    String rawFrame = trimFrame(String(g_pendingTx.data));
    logLine("LORA", String("ERROR: no se pudo armar trama confiable | src=") +
                    frameSrcName(g_pendingTx.src) +
                    " | data=" + framePreview(rawFrame));
    appendBufferFrame(rawFrame);
    g_hasPendingTx = false;
    clearPendingAckState();
    return;
  }

  String wireFrame = String(g_pendingWireFrame);
  logFlow("LoRa TX START", g_pendingTx.src, wireFrame);

  if (sendFrameLoRaNow(g_pendingWireFrame, strlen(g_pendingWireFrame))) {
    logFlow("LoRa TX OK", g_pendingTx.src, wireFrame);
    if (g_pendingExpectedAckKind == ACK_KIND_NONE) {
      g_hasPendingTx = false;
      clearPendingAckState();
      return;
    }
    g_pendingAwaitingAck = true;
    g_pendingAckSentMs = millis();
    return;
  }

  g_pendingTx.retries++;
  logLine("FLOW", String("LoRa TX FAIL | src=") + frameSrcName(g_pendingTx.src) +
                  " | retry=" + String(g_pendingTx.retries) +
                  " | data=" + framePreview(wireFrame));
  logLine("LORA", String("Fallo TX. Reintento #") + String(g_pendingTx.retries));

  if (g_pendingTx.retries > LORA_ACK_MAX_RETRIES) {
    String rawFrame = trimFrame(String(g_pendingTx.data));
    bool linkWasActive = g_pairState == LORA_PAIR_LINKED;
    appendBufferFrame(rawFrame);
    logLine("FLOW", String("LoRa TX -> buffer SD | src=") + frameSrcName(g_pendingTx.src) +
                    " | data=" + framePreview(rawFrame));
    logLine("LORA", "Trama movida a buffer SD.");
    g_hasPendingTx = false;
    clearPendingAckState();
    g_loraRecoveryCount++;
    logLine("LORA", "Recuperando SX1278 tras agotar ACK.");
    initLoRa();
    if (linkWasActive) {
      enterSenderSearchingMode("radio sin entrega; reinicio de busqueda");
    }
  }
}

static void enqueueLoRaDiag() {
  if (!ENABLE_LORA_DIAG || !ENABLE_LORA || !g_loraOk) return;

  String frame = String("ZENIT_DIAG:") + PORTICO_ID + ":" + timestampISO();
  enqueueOutgoingFrame(SRC_DIAG, frame);
}

static void enqueueLoRaLinkHeartbeat() {
  if (!ENABLE_LORA_LINK_HEARTBEAT || !ENABLE_LORA || !g_loraOk) return;

  uint32_t seq = ++g_loraHeartbeatSeq;
  String frame = String("LORA_LINK|") + PAIR_ID + "|" + PORTICO_ID + "|" + BACKBONE_ID + "|" +
                 timestampISO() + "|" + String(seq);
  logLine("PAIR", String(g_pairState == LORA_PAIR_LINKED ? "Heartbeat" : "Busqueda") +
                  " LoRa encolada | pareja=" + PAIR_ID +
                  " | seq=" + String(seq));
  enqueueOutgoingFrame(SRC_LINK, frame);
}

static void enqueueLoRaTestFrame() {
  if (!ENABLE_LORA_TEST_MODE || !ENABLE_LORA || !g_loraOk) return;

  uint32_t seq = ++g_loraTestSeq;
  String frame = String("LORA_TEST|") + PORTICO_ID + "|" +
                 loraSelectedFrequencyLabel() + "|" +
                 timestampISO() + "|" + String(seq);
  logLine("LORA", String("Test LoRa encolado seq=") + String(seq));
  enqueueOutgoingFrame(SRC_TEST, frame);
}

// =======================================================
// Ethernet / WiFi
// =======================================================

static void resetEthernetChip() {
  if (ETH_RST_PIN < 0) return;

  digitalWrite(ETH_RST_PIN, LOW);
  delay(50);
  digitalWrite(ETH_RST_PIN, HIGH);
  delay(200);
}

static bool initEthernet() {
  // En produccion: reinicia ENC28J60, configura IP y comprueba interfaz.
  if (!ENABLE_ETHERNET) {
    logLine("ETH", "Ethernet deshabilitado.");
    return false;
  }

  g_lastEthernetInitAttemptMs = millis();
  g_ethOk = false;
  g_ethLinkUp = false;
  selectEthernetOnSharedSpi();
  resetEthernetChip();
  Ethernet.init(ETH_CS_PIN);

  int dhcpResult = 0;
  bool usedDhcp = false;
  if (ETH_USE_DHCP) {
    dhcpResult = Ethernet.begin(g_ethMac);
    usedDhcp = (dhcpResult != 0);
  }

  if (!ETH_USE_DHCP || dhcpResult == 0) {
    Ethernet.begin(g_ethMac, g_ethStaticIp, g_ethDns, g_ethGateway, g_ethMask);
  }

  delay(500);
  EthernetHardwareStatus hardware = Ethernet.hardwareStatus();
  g_ethOk = (hardware == EthernetENC28J60);

  if (!g_ethOk) {
    logLine("ETH", "ERROR: ENC28J60 no responde por SPI; se reintentara automaticamente.");
    return false;
  }

  g_ethLinkUp = (Ethernet.linkStatus() == LinkON);
  g_ethServer.begin();
  logLine("ETH", String("Ethernet OK mode=") + (usedDhcp ? "DHCP" : "STATIC") +
                 " IP=" + Ethernet.localIP().toString() +
                 " GW=" + g_ethGateway.toString() +
                 " listen=" + String(ETH_LISTEN_PORT) +
                 " LINK=" + (g_ethLinkUp ? "UP" : "DOWN"));
  return true;
}

static void serviceEthernetRecovery() {
  if (!ENABLE_ETHERNET) return;

  uint32_t now = millis();
  if (g_lastEthernetHealthCheckMs != 0 &&
      (uint32_t)(now - g_lastEthernetHealthCheckMs) < ZenitLoRaConfig::PERIPHERAL_RECOVERY_MS) {
    return;
  }
  g_lastEthernetHealthCheckMs = now;

  selectEthernetOnSharedSpi();
  if (g_ethOk) {
    EthernetHardwareStatus hardware = Ethernet.hardwareStatus();
    if (hardware == EthernetENC28J60) {
      bool linkUp = (Ethernet.linkStatus() == LinkON);
      if (linkUp != g_ethLinkUp) {
        g_ethLinkUp = linkUp;
        logLine("ETH", String("Cambio de enlace fisico LINK=") + (g_ethLinkUp ? "UP" : "DOWN"));
      }
      return;
    }

    g_ethOk = false;
    g_ethLinkUp = false;
    closeNetworkInputsForLoRaWindow();
    logLine("RECOVERY", "ENC28J60 dejo de responder; se reiniciara.");
  }

  if (g_lastEthernetInitAttemptMs != 0 &&
      (uint32_t)(now - g_lastEthernetInitAttemptMs) < ZenitLoRaConfig::PERIPHERAL_RECOVERY_MS) {
    return;
  }

  bool recovered = initEthernet();
  logLine("RECOVERY", String("Ethernet recovery=") + (recovered ? "OK" : "FAIL"));
}

static bool initWiFi() {
  if (!ENABLE_WIFI) {
    logLine("WIFI", "WiFi deshabilitada por defecto.");
    return false;
  }

  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(250);
  }

  g_wifiOk = (WiFi.status() == WL_CONNECTED);
  if (!g_wifiOk) {
    logLine("WIFI", "ERROR: no se pudo conectar.");
    return false;
  }

  g_wifiServer.begin();
  configTime(-3 * 3600, 0, "pool.ntp.org");

  logLine("WIFI", String("WiFi OK. IP=") + WiFi.localIP().toString() +
                  " listen=" + String(WIFI_LISTEN_PORT));
  return true;
}

static void checkWiFi() {
  if (!ENABLE_WIFI) return;
  if (millis() - g_lastWiFiCheckMs < WIFI_RECHECK_MS) return;
  g_lastWiFiCheckMs = millis();

  if (WiFi.status() == WL_CONNECTED) {
    g_wifiOk = true;
    return;
  }

  g_wifiOk = false;
  logLine("WIFI", "WiFi caida, reconectando...");
  initWiFi();
}

// Cada linea TCP recibida se trata como una trama completa a modular por LoRa.
static void processInboundLine(String line, FrameSrc src) {
  line = trimFrame(line);
  if (line.length() == 0) return;
  logFlow(String(frameSrcName(src)) + " RX -> cola LoRa", src, line);
  enqueueOutgoingFrame(src, line);
}

// Atiende un cliente TCP por vez y arma tramas separadas por CR/LF.
static void serviceEthernetClient() {
  if (!ENABLE_ETHERNET || !g_ethOk) return;

  if (!g_ethClient || !g_ethClient.connected()) {
    EthernetClient incoming = g_ethServer.available();
    if (incoming) {
      g_ethClient = incoming;
      resetEthernetClientState();
      logLine("ETH", String("Cliente conectado al sender desde ") + incoming.remoteIP().toString());
    }
  }

  if (!g_ethClient) return;

  while (g_ethClient.available()) {
    if (g_ethClientMode == INBOUND_MODE_HTTP_BODY) {
      while (g_ethClient.available() && g_ethHttpBody.length() < g_ethHttpContentLength) {
        char c = (char)g_ethClient.read();
        if (g_ethHttpBody.length() < HTTP_BODY_MAX) {
          g_ethHttpBody += c;
        }
      }

      if (g_ethHttpContentLength > HTTP_BODY_MAX) {
        sendHttpResponse(g_ethClient, 413, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"payload_too_large\"}");
        g_ethClient.stop();
        resetEthernetClientState();
        return;
      }

      if (g_ethHttpBody.length() >= g_ethHttpContentLength) {
        finalizeHttpRequest(g_ethClient);
        return;
      }
      break;
    }

    char c = (char)g_ethClient.read();
    if (c == '\r') continue;

    if (c == '\n') {
      String line = g_ethLine;
      g_ethLine = "";

      if (g_ethClientMode == INBOUND_MODE_DETECT) {
        if (line.length() == 0) continue;

        if (looksLikeHttpRequestLine(line)) {
          if (!parseHttpRequestLine(line, g_ethHttpMethod, g_ethHttpPath)) {
            sendHttpResponse(g_ethClient, 400, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"bad_request_line\"}");
            g_ethClient.stop();
            resetEthernetClientState();
            return;
          }
          g_ethClientMode = INBOUND_MODE_HTTP_HEADERS;
          continue;
        }

        g_ethClientMode = INBOUND_MODE_TEXT;
        processInboundLine(line, SRC_ETH);
        if (ENABLE_ETH_ACK) g_ethClient.println("OK");
        continue;
      }

      if (g_ethClientMode == INBOUND_MODE_TEXT) {
        if (line.length() > 0) {
          processInboundLine(line, SRC_ETH);
          if (ENABLE_ETH_ACK) g_ethClient.println("OK");
        }
        continue;
      }

      if (g_ethClientMode == INBOUND_MODE_HTTP_HEADERS) {
        if (line.length() == 0) {
          if (g_ethHttpContentLength > HTTP_BODY_MAX) {
            sendHttpResponse(g_ethClient, 413, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"payload_too_large\"}");
            g_ethClient.stop();
            resetEthernetClientState();
            return;
          }

          if (g_ethHttpContentLength > 0) {
            g_ethClientMode = INBOUND_MODE_HTTP_BODY;
          } else {
            finalizeHttpRequest(g_ethClient);
            return;
          }
        } else {
          parseHttpHeaderLine(line);
        }
      }
    } else if (g_ethLine.length() < HTTP_LINE_MAX) {
      g_ethLine += c;
    }
  }

  if (!g_ethClient.connected()) {
    if (g_ethClientMode == INBOUND_MODE_TEXT && g_ethLine.length() > 0) {
      processInboundLine(g_ethLine, SRC_ETH);
    }
    resetEthernetClientState();
    g_ethClient.stop();
    logLine("ETH", "Cliente TCP desconectado.");
  }
}

// Mismo flujo que Ethernet, pero conservado como canal alternativo opcional.
static void serviceWiFiClient() {
  if (!ENABLE_WIFI || !g_wifiOk) return;

  if (!g_wifiClient || !g_wifiClient.connected()) {
    WiFiClient incoming = g_wifiServer.available();
    if (incoming) {
      g_wifiClient = incoming;
      g_wifiLine = "";
      logLine("WIFI", "Cliente TCP conectado al sender. Esperando lineas para LoRa.");
    }
  }

  if (!g_wifiClient) return;

  while (g_wifiClient.available()) {
    char c = (char)g_wifiClient.read();

    if (c == '\n' || c == '\r') {
      if (g_wifiLine.length() > 0) {
        processInboundLine(g_wifiLine, SRC_WIFI);
        g_wifiLine = "";
      }
    } else if (g_wifiLine.length() < (FRAME_MAX - 1)) {
      g_wifiLine += c;
    }
  }

  if (!g_wifiClient.connected()) {
    if (g_wifiLine.length() > 0) {
      processInboundLine(g_wifiLine, SRC_WIFI);
      g_wifiLine = "";
    }
    g_wifiClient.stop();
    logLine("WIFI", "Cliente TCP desconectado.");
  }
}

// =======================================================
// BLE
// =======================================================

class SenderBleCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    if (!ENABLE_BLE_SCAN) return;

    String addr = String(advertisedDevice.getAddress().toString().c_str());
    String frame = addr + ":BT:" + timestampISO() + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" +
                   String(advertisedDevice.getRSSI());

    enqueueOutgoingFrame(SRC_BLE, frame);
  }
};

static void initBLE() {
  if (!ENABLE_BLE_SCAN) {
    logLine("BLE", "BLE deshabilitado.");
    return;
  }

  BLEDevice::init(BLE_NAME);
  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new SenderBleCallbacks());
  g_scan->setActiveScan(true);
  g_scan->setInterval(50);
  g_scan->setWindow(45);

  logLine("BLE", "BLE scan listo.");
}

static void pollBLE() {
  if (!ENABLE_BLE_SCAN || !g_scan) return;
  if (millis() - g_lastBleScanMs < BLE_SCAN_EVERY_MS) return;

  g_lastBleScanMs = millis();
  g_scan->start((int)BLE_SCAN_SECONDS, false);
  g_scan->clearResults();
}

// =======================================================
// Sensores - pendiente
// =======================================================

static void initSensors() {
  if (!ENABLE_SENSOR_READ) {
    logLine("SNS", "Sensores deshabilitados.");
    return;
  }

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (!g_ads.begin(ADS1115_ADDR, &Wire)) {
    g_adsOk = false;
    logLine("SNS", "ERROR: no se detecta ADS1115 en I2C 0x48.");
    return;
  }

  // ADS1115 alimentado a 5V. GAIN_TWOTHIRDS permite medir hasta +/-6.144V.
  // Esto cubre A1 4-20mA con shunt 249 ohm (~0.996V a ~4.98V)
  // y A4 0-10V con divisor 100k/100k (~0V a ~5V).
  g_ads.setGain(GAIN_TWOTHIRDS);
  g_adsOk = true;
  logLine("SNS", "ADS1115 OK. Canales A1=A0, A2=A1, A3=A2, A4=A3.");
}

static void pollSensors() {
  if (!ENABLE_SENSOR_READ || !g_adsOk) return;
  if (millis() - g_lastSensorReadMs < SENSOR_READ_EVERY_MS) return;

  g_lastSensorReadMs = millis();

  int16_t rawA1 = g_ads.readADC_SingleEnded(0);
  int16_t rawA2 = g_ads.readADC_SingleEnded(1);
  int16_t rawA3 = g_ads.readADC_SingleEnded(2);
  int16_t rawA4 = g_ads.readADC_SingleEnded(3);

  float vA1 = g_ads.computeVolts(rawA1);
  float vA2 = g_ads.computeVolts(rawA2);
  float vA3 = g_ads.computeVolts(rawA3);
  float vA4 = g_ads.computeVolts(rawA4);

  // Conversiones de referencia para hardware final:
  // A1 4-20mA con Rshunt=249 ohm: I(mA)=V/249*1000
  // A4 0-10V con divisor 100k/100k: Vin=Vadc*2
  float a1_mA = (vA1 / 249.0f) * 1000.0f;
  float a4_Vin = vA4 * 2.0f;

  String frame = String("SNS:") + PORTICO_ID + ":" + timestampISO() +
                 ":A1_mA=" + String(a1_mA, 3) +
                 ":A2_V=" + String(vA2, 4) +
                 ":A3_V=" + String(vA3, 4) +
                 ":A4_V=" + String(a4_Vin, 3);

  logLine("SNS", frame);

  enqueueOutgoingFrame(SRC_SENSOR, frame);
}

// =======================================================
// Setup / loop
// =======================================================

void setup() {
  // Inicializacion ordenada con logs INIT ...=OK/FAIL.
  if (ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS) Serial.begin(115200);
  // Espera fija de alimentacion: no depende de que el USB/CDC este conectado.
  delay(ZenitLoRaConfig::POWER_ON_SETTLE_MS);
  const char* bootBanner = "\r\n=== ZENIT v7 SENDER - MODEM UTP -> LoRa ===\r\n";
  if (ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS) {
    serialWriteNonBlocking(bootBanner, strlen(bootBanner));
  }

  g_timeslotOffsetMs = computeOffsetFromPorticoId(PORTICO_ID);
  prepareSpiPins();
  if (!ENABLE_LORA_TEST_MODE) {
    initSD();
    logLine("BOOT", String("INIT SD=") + (g_sdOk ? "OK" : "FAIL"));
    delay(ZenitLoRaConfig::INIT_SETTLE_MS);
  }

  logLine("BOOT", String("PORTICO_ID=") + PORTICO_ID);
  logLine("BOOT", String("PAIR_ID=") + PAIR_ID +
                  " RECEIVER_ESPERADO=" + EXPECTED_RECEIVER_ID);
  logLine("BOOT", String("ETH=") + (ENABLE_ETHERNET ? "ON" : "OFF") +
                  " WIFI=" + (ENABLE_WIFI ? "ON" : "OFF") +
                  " BLE=" + (ENABLE_BLE_SCAN ? "ON" : "OFF") +
                  " SD=" + (ENABLE_SD_CARD ? "ON" : "OFF") +
                  " SNS=" + (ENABLE_SENSOR_READ ? "ON" : "OFF") +
                  " GAO_PUSH=" + (ENABLE_GAO_WEBHOOK ? "ON" : "OFF") +
                  " GAO_PULL=" + (ENABLE_GAO_PULL_CLIENT ? "ON" : "OFF"));
  logLine("BOOT", String("LoRa test mode=") + (ENABLE_LORA_TEST_MODE ? "ON" : "OFF"));
  g_senderPhaseStartedMs = millis();

  initLoRa();
  logLine("BOOT", String("INIT LoRa=") + (g_loraOk ? "OK" : "FAIL"));
  delay(ZenitLoRaConfig::INIT_SETTLE_MS);
  if (!ENABLE_LORA_TEST_MODE) {
    bool ethernetOk = initEthernet();
    logLine("BOOT", String("INIT Ethernet=") + (ethernetOk ? "OK" : "FAIL"));
    delay(ZenitLoRaConfig::INIT_SETTLE_MS);

    bool wifiOk = initWiFi();
    logLine("BOOT", String("INIT WiFi=") + (wifiOk ? "OK" : "FAIL"));
    delay(ZenitLoRaConfig::INIT_SETTLE_MS);

    initBLE();
    logLine("BOOT", String("INIT BLE=") + (ENABLE_BLE_SCAN ? (g_scan ? "OK" : "FAIL") : "OFF"));
    delay(ZenitLoRaConfig::INIT_SETTLE_MS);

    initSensors();
    logLine("BOOT", String("INIT Sensores=") + (ENABLE_SENSOR_READ ? (g_adsOk ? "OK" : "FAIL") : "OFF"));
  }

  logLine("BOOT", String("Timeslot offset=") + String(g_timeslotOffsetMs) + "ms");
  logLine("BOOT", String("Heartbeat LoRa=") + (ENABLE_LORA_LINK_HEARTBEAT ? "ON" : "OFF") +
                  " cada " + String(LORA_HEARTBEAT_MS) + "ms");
  if (ENABLE_GAO_WEBHOOK) {
    logLine("BOOT", g_ethOk
                    ? String("GAO webhook/TCP listener=ETH:") + Ethernet.localIP().toString() +
                      ":" + String(ETH_LISTEN_PORT)
                    : String("GAO webhook/TCP pendiente de recovery Ethernet"));
  }
  if (ENABLE_GAO_PULL_CLIENT) {
    logLine("BOOT", String("GAO stream reader=") + GAO_READER_HOST +
                    ":" + String(GAO_READER_PORT) +
                    " path=" + GAO_STREAM_PATH +
                    " autoStart=" + (CONFIG_ENABLE_GAO_AUTO_START_INVENTORY ? "ON" : "OFF"));
  }
  if (ENABLE_LORA_TEST_MODE) {
    logLine("BOOT", String("Modo TEST LoRa activo. Solo envia LORA_TEST cada ") +
                    String(LORA_TEST_TX_MS) + "ms.");
    logLine("BOOT", "ENC28J60 aislado: CS alto y RESET bajo.");
  }
  if (!ENABLE_LORA_TEST_MODE) {
    logLine("BOOT", "Estado inicial BUSCANDO: solo LoRa hasta enlazar la pareja.");
    logLine("BOOT", "Luego: RED/GAO 45 s -> LoRa 45 s (SPI aislado).");
  }
  logLine("BOOT", "Setup completo.");
}

void loop() {
  // TEST: solo radio. PRODUCCION: radio primero y luego fuentes/red.
  serviceLoRaRecovery();

  if (ENABLE_LORA_TEST_MODE) {
    // Ruta exclusiva de la prueba: no se atiende ningun periferico adicional.
    if (millis() - g_lastLoRaTestMs >= LORA_TEST_TX_MS) {
      g_lastLoRaTestMs = millis();
      if (qCount() < (QUEUE_CAP - 1)) enqueueLoRaTestFrame();
    }
    pollLoRaRx();
    serviceLoRaTx();
    pollLoRaRx();
    delay(5);
    return;
  }

  // La busqueda no depende de los slots RED/LoRa: ambos extremos permanecen
  // en radio hasta completar el handshake exclusivo de su PAIR_ID.
  pollLoRaRx();
  monitorSenderPairLink();
  if (!isSenderPairLinked()) {
    g_senderTransportPhase = SENDER_PHASE_LORA;

    uint32_t now = millis();
    if ((g_lastLoRaHeartbeatMs == 0 || (now - g_lastLoRaHeartbeatMs) >= LORA_SEARCH_MS) &&
        !g_hasPendingTx &&
        qCount() == 0) {
      g_lastLoRaHeartbeatMs = now;
      enqueueLoRaLinkHeartbeat();
    }

    serviceLoRaTx();
    pollLoRaRx();

    static uint32_t lastSearchLogMs = 0;
    if (now - lastSearchLogMs >= 10000UL) {
      lastSearchLogMs = now;
      logLine("PAIR", String("BUSCANDO pareja=") + PAIR_ID +
                      " sender=" + PORTICO_ID +
                      " receiver=" + EXPECTED_RECEIVER_ID);
    }

    delay(ENABLE_LOW_POWER ? 50 : 5);
    return;
  }

  serviceSenderTransportSchedule();

  if (ENABLE_ETHERNET && senderInNetworkWindow()) {
    serviceEthernetRecovery();
    if (g_ethOk) {
      selectEthernetOnSharedSpi();
      Ethernet.maintain();
    }
  }

  if (senderInNetworkWindow()) {
    checkWiFi();
    serviceEthernetClient();
    serviceGaoClient();
    serviceWiFiClient();
  } else {
    serviceLoRaTx();
  }
  pollBLE();
  pollSensors();

  if (ENABLE_LORA_TEST_MODE && (millis() - g_lastLoRaTestMs >= LORA_TEST_TX_MS)) {
    g_lastLoRaTestMs = millis();
    if (qCount() < (QUEUE_CAP - 1)) {
      enqueueLoRaTestFrame();
    }
  }

  if (!senderInNetworkWindow() && ENABLE_LORA_LINK_HEARTBEAT &&
      (millis() - g_lastLoRaHeartbeatMs >= LORA_HEARTBEAT_MS)) {
    g_lastLoRaHeartbeatMs = millis();
    if (qCount() < (QUEUE_CAP - 1)) {
      enqueueLoRaLinkHeartbeat();
    }
  }

  if (!senderInNetworkWindow()) serviceLoRaTx();
  pollLoRaRx();

  if (ENABLE_LORA_DIAG && (millis() - g_lastLoRaDiagMs > LORA_DIAG_MS)) {
    g_lastLoRaDiagMs = millis();
    enqueueLoRaDiag();
  }

  static uint32_t lastSysMs = 0;
  if (millis() - lastSysMs > 10000) {
    lastSysMs = millis();
    logLine("SYS", String("Queue=") + qCount() +
                    " Pending=" + (g_hasPendingTx ? "1" : "0") +
                    " AckWait=" + (g_pendingAwaitingAck ? "1" : "0") +
                    " AckSeq=" + String(g_pendingAckSeq) +
                    " Pair=" + PAIR_ID +
                    " State=" + (isSenderPairLinked() ? "ENLAZADO" : "BUSCANDO") +
                    " TxOk=" + String(g_loraTxOkCount) +
                    " AckOk=" + String(g_loraAckOkCount) +
                    " Recover=" + String(g_loraRecoveryCount) +
                    " Eth=" + (g_ethOk ? "OK" : "RECOVERY") +
                    " Link=" + (g_ethLinkUp ? "UP" : "DOWN") +
                    " Heap=" + ESP.getFreeHeap());
  }

  delay(ENABLE_LOW_POWER ? 50 : 5);
}
