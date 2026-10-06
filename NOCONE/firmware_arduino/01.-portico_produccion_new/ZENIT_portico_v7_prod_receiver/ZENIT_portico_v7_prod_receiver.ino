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
#include <stdarg.h>
#include <time.h>
#include "../zenit_lora_common_types.h"
#include "../zenit_lora_radio_config.h"

/*
  ZENIT v7 - RECEIVER / MODEM LoRa -> UTP

  Logica principal:
  - Recibe LoRa y reenvia la trama por TCP hacia la red.
  - Ethernet queda activo por defecto.
  - WiFi queda deshabilitado por defecto.
  - BLE local y sensores quedan como modulos opcionales.
  - SD registra eventos y puede guardar buffer si la red no esta disponible.
  - Consola: imprime trazas FLOW para seguir el camino LoRa -> Ethernet/WiFi.

  MAPA RAPIDO DE FUNCIONES:
  - prepareSpiPins(): prepara CS/reset y evita choques entre LoRa y Ethernet.
  - initLoRa(): diagnostica SX1278 y configura parametros RF.
  - pollLoRa(): recibe bytes, mide RSSI/SNR y dirige cada tipo de trama.
  - handleLoRaLinkFrame(): heartbeat del sender y respuesta LINK_ACK.
  - handleLoRaTestFrame(): prueba RF y respuesta LORA_ACK.
  - handleLoRaDataFrame(): valida, ACKea, elimina duplicados y entrega payload.
  - handleLoRaFragment(): reensambla payloads largos antes de enviarlos a red.
  - enqueueInboundFrame()/processOutboundQueue(): cola y reenvia TCP.
  - setup(): inicializa perifericos y registra OK/FAIL.
  - loop(): TEST ejecuta solo LoRa; PRODUCCION atiende todos los servicios.
*/

// =======================================================
// Flags de funcionalidad
// =======================================================

// Prueba de placa: deja activo exclusivamente el enlace LoRa.
// Recibe LORA_TEST del sender y responde con un ACK.
static constexpr bool ENABLE_LORA_TEST_MODE = ZenitLoRaConfig::TEST_MODE;

static constexpr bool ENABLE_LORA        = true;
static constexpr bool CONFIG_ENABLE_ETHERNET = true;
static constexpr bool CONFIG_ENABLE_WIFI = false;
static constexpr bool ENABLE_SD_CARD     = false;
// RFID-only test mode: dejar en false para aislar sender RFID -> LoRa -> listener.
static constexpr bool CONFIG_ENABLE_LOCAL_BLE = false;
static constexpr bool CONFIG_ENABLE_SENSOR_READ = false;
static constexpr bool ENABLE_LOW_POWER   = false;
static constexpr uint32_t LORA_IDLE_LOG_MS = 8000;

static constexpr bool ENABLE_ETHERNET = CONFIG_ENABLE_ETHERNET && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_WIFI = CONFIG_ENABLE_WIFI && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_LOCAL_BLE = CONFIG_ENABLE_LOCAL_BLE && !ENABLE_LORA_TEST_MODE;
static constexpr bool ENABLE_SENSOR_READ = CONFIG_ENABLE_SENSOR_READ && !ENABLE_LORA_TEST_MODE;

// =======================================================
// Identidad
// =======================================================

static const char* PORTICO_ID  = ZenitLoRaConfig::RECEIVER_ID;
static const char* PAIR_ID = ZenitLoRaConfig::PAIR_ID;
static const char* EXPECTED_SENDER_ID = ZenitLoRaConfig::SENDER_ID;
static const char* BACKBONE_ID = "GW_BACKBONE_RECEIVER_001";
static const char* EDGE_KIND   = "EDGE_RECEIVER";
static const char* BLE_NAME    = "TMONE_EDGE_RECEIVER_001";

// =======================================================
// Destino TCP
// =======================================================

static const char* DEST_HOST = "192.168.100.10";
static constexpr uint16_t DEST_PORT = 7070;
static IPAddress g_destIp;
static bool g_destHostIsIp = false;

// =======================================================
// WiFi opcional
// =======================================================

static const char* WIFI_SSID = "TMONE_Repeat";
static const char* WIFI_PASS = "TMONE2025";
static constexpr uint32_t WIFI_RECHECK_MS = 30000;

static bool g_wifiOk = false;
static uint32_t g_lastWiFiCheckMs = 0;

// =======================================================
// Ethernet ENC28J60
// =======================================================

static constexpr int ETH_CS_PIN  = 39;
static constexpr int ETH_RST_PIN = 8;
static constexpr int ETH_INT_PIN = 10;
static constexpr bool ETH_USE_DHCP = false;

byte g_ethMac[] = { 0x02, 0x54, 0x4D, 0x4F, 0x4E, 0x13 };
IPAddress g_ethStaticIp(192, 168, 100, 53);
IPAddress g_ethDns(192, 168, 100, 1);
IPAddress g_ethGateway(192, 168, 100, 1);
IPAddress g_ethMask(255, 255, 255, 0);

static bool g_ethOk = false;
static bool g_ethLinkUp = false;
static uint32_t g_lastEthernetInitAttemptMs = 0;
static uint32_t g_lastEthernetHealthCheckMs = 0;

// Las tramas LoRa se reciben y ACKean de inmediato para no perder radio; la
// entrega TCP se concentra cada 45 s. Asi el ENC28J60 solo se usa en una
// ventana breve, con el socket cerrado al terminar cada despacho.
static constexpr uint32_t RECEIVER_NETWORK_FLUSH_MS = 45000UL;
static uint32_t g_lastReceiverNetworkFlushMs = 0;

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
static uint32_t g_lastRxMs = 0;

// Una consola USB CDC sin host puede quedarse sin espacio y bloquear el loop.
// Los logs son diagnosticos y se descartan si el puerto no esta abierto o no
// hay espacio suficiente; LoRa y Ethernet nunca deben esperar a la consola.
static bool usbConsoleWriteNonBlocking(const char* text, size_t length) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS || !text || length == 0 || !Serial) return false;

  int available = Serial.availableForWrite();
  if (available < 0 || static_cast<size_t>(available) < length) return false;

  return Serial.write(reinterpret_cast<const uint8_t*>(text), length) == length;
}

static void usbConsolePrintfNonBlocking(const char* format, ...) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS || !format) return;

  char buffer[256];
  va_list args;
  va_start(args, format);
  int length = vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);

  if (length <= 0) return;
  size_t safeLength = static_cast<size_t>(length);
  if (safeLength >= sizeof(buffer)) safeLength = sizeof(buffer) - 1;
  usbConsoleWriteNonBlocking(buffer, safeLength);
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
    usbConsolePrintfNonBlocking("[LORA] SPI SX127x OK | RegVersion=%s\n", hexVersion);
  } else {
    usbConsolePrintfNonBlocking("[LORA] ADVERTENCIA SPI | RegVersion=%s (se esperaba 0x12). Revisar CS/RST/MISO/alimentacion.\n", hexVersion);
  }
}
static uint32_t g_lastIdleLoRaLogMs = 0;
static bool g_consoleUsbReady = false;
static bool g_consoleUartReady = false;

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
static const char* SD_LOG_PATH = "/zenit_receiver_log.csv";
static const char* SD_BUFFER_PATH = "/zenit_receiver_buffer.log";

// =======================================================
// BLE local opcional
// =======================================================

BLEScan* g_scan = nullptr;
static uint32_t g_lastBleScanMs = 0;
static constexpr uint32_t BLE_SCAN_EVERY_MS = 6000;
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
// Cola hacia red
// =======================================================

static constexpr FrameSrc SRC_LORA = 1;
static constexpr FrameSrc SRC_BLE = 2;
static constexpr FrameSrc SRC_SENSOR = 3;
static constexpr FrameSrc SRC_DIAG = 4;

static constexpr int QUEUE_CAP = 96;
static constexpr int FRAME_MAX = 260;

static FrameItem g_queue[QUEUE_CAP];
static volatile int g_qHead = 0;
static volatile int g_qTail = 0;

static uint32_t g_tcpFailCount = 0;
static uint32_t g_tcpNextTryMs = 0;
static constexpr uint32_t TCP_BACKOFF_MS_BASE = 1200;
static constexpr uint32_t TCP_BACKOFF_MS_MAX = 8000;
static constexpr uint32_t RECEIVER_HEARTBEAT_MS = 5000;
static uint32_t g_lastReceiverHeartbeatMs = 0;

// =======================================================
// Tracking de porticos vistos
// =======================================================

struct PorticoSeen {
  char id[48];
  uint32_t count;
  uint32_t lastMs;
};

static PorticoSeen g_seen[32];
static int g_seenCount = 0;

struct LoRaLinkPeer {
  char senderId[48];
  char backboneId[48];
  uint32_t lastSeenMs;
  uint32_t lastSeq;
  int lastRssi;
  float lastSnr;
  bool active;
};

static LoRaLinkPeer g_linkPeer = {};
static bool g_linkTimeoutLogged = false;
static constexpr uint32_t LORA_LINK_TIMEOUT_MS = ZenitLoRaConfig::PAIR_LINK_TIMEOUT_MS;
static char g_lastReliableSenderId[48] = {0};
static uint32_t g_lastReliableSeq = 0;

// Declarada mas abajo, despues de las utilidades de cola.
static void enqueueInboundFrame(FrameSrc src, String frame);
static bool g_networkLogForwarding = false;

// Reensamble de una trama larga. El sender envia sus fragmentos de forma
// confiable y secuencial, por lo que una sola sesion activa es suficiente.
struct LoRaFragmentAssembly {
  uint32_t messageId;
  uint8_t total;
  uint8_t nextPart;
  uint32_t lastMs;
  String payload;
  bool active;
};

static LoRaFragmentAssembly g_fragmentAssembly = {};
static constexpr uint32_t LORA_FRAGMENT_TIMEOUT_MS = 15000;

// =======================================================
// Cola
// =======================================================

static int qCount() {
  int count = g_qHead - g_qTail;
  if (count < 0) count += QUEUE_CAP;
  return count;
}

static bool queuePush(FrameSrc src, const char* data, size_t len);
static bool queuePop(FrameItem& out);

// Los diagnósticos nunca son tráfico crítico. Al superar este umbral se
// compacta la cola y se eliminan sólo LOG; RFID/LoRa/BLE se conservan.
static void purgeQueuedDiagnostics() {
  FrameItem kept[QUEUE_CAP];
  int keptCount = 0;
  FrameItem item;
  while (queuePop(item)) {
    if (item.src != SRC_DIAG && keptCount < (QUEUE_CAP - 1)) kept[keptCount++] = item;
  }
  g_qHead = 0;
  g_qTail = 0;
  for (int i = 0; i < keptCount; ++i) queuePush(kept[i].src, kept[i].data, kept[i].len);
}

static bool queuePush(FrameSrc src, const char* data, size_t len) {
  // Inserta al final de la cola circular; processOutboundQueue() la entregara
  // despues para que la recepcion LoRa no quede bloqueada por TCP.
  if (!data || len == 0) return false;
  if (len >= FRAME_MAX) len = FRAME_MAX - 1;
  if (src == SRC_DIAG && qCount() >= (QUEUE_CAP - 24)) {
    purgeQueuedDiagnostics(); // limpia logs antiguos aun si no entra RFID nuevo
    return true; // descarta el log actual sin reintento
  }
  if (src != SRC_DIAG && qCount() >= (QUEUE_CAP - 12)) purgeQueuedDiagnostics();

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
  if (g_qHead == g_qTail) return false;

  out = g_queue[g_qTail];
  int nextTail = g_qTail + 1;
  if (nextTail >= QUEUE_CAP) nextTail = 0;
  g_qTail = nextTail;
  return true;
}

static bool queueRePush(const FrameItem& item) {
  int nextHead = g_qHead + 1;
  if (nextHead >= QUEUE_CAP) nextHead = 0;
  if (nextHead == g_qTail) return false;

  g_queue[g_qHead] = item;
  g_qHead = nextHead;
  return true;
}

// =======================================================
// Utilidades / logs
// =======================================================

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

static void debugPrintRaw(const char* text) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS || !text) return;
  size_t length = strlen(text);

  if (g_consoleUsbReady) {
    usbConsoleWriteNonBlocking(text, length);
  }

#if defined(ARDUINO_ARCH_ESP32)
  if (g_consoleUartReady) {
    int available = Serial0.availableForWrite();
    if (available >= 0 && static_cast<size_t>(available) >= length) {
      Serial0.write(reinterpret_cast<const uint8_t*>(text), length);
    }
  }
#endif
}

static void debugPrintRaw(const String& text) {
  debugPrintRaw(text.c_str());
}

static void debugPrintLine(const char* text = "") {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS) return;
  String line(text ? text : "");
  line += "\r\n";
  debugPrintRaw(line);
}

static void debugPrintf(const char* fmt, ...) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS || !fmt) return;

  char buf[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);

  debugPrintRaw(buf);
}

static void initConsole() {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS) {
    g_consoleUsbReady = false;
    g_consoleUartReady = false;
    return;
  }
  Serial.begin(115200);
  g_consoleUsbReady = true;

#if defined(ARDUINO_ARCH_ESP32)
  Serial0.begin(115200);
  g_consoleUartReady = true;
#endif

  uint32_t start = millis();
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  while (!Serial && (millis() - start) < 4000) {
    delay(10);
  }
#else
  while (!Serial && (millis() - start) < 250) {
    delay(10);
  }
#endif

  delay(150);
  debugPrintLine();
  debugPrintLine("=== ZENIT v7 RECEIVER - MODEM LoRa -> UTP ===");
  debugPrintLine("[BOOT] Consola serial lista por USB CDC / UART0.");
}

static void appendLogLineToSD(const String& line) {
  if (!ENABLE_SD_CARD || !g_sdOk) return;

  File f = SD.open(SD_LOG_PATH, FILE_APPEND);
  if (!f) return;
  f.println(line);
  f.close();
}

static void consoleLine(const char* tag, const String& msg) {
  if (!ZenitLoRaConfig::ENABLE_SERIAL_DIAGNOSTICS) return;
  String line;
  line.reserve(msg.length() + strlen(tag) + 4);
  line += "[";
  line += tag;
  line += "] ";
  line += msg;
  debugPrintLine(line.c_str());
}

static void logLine(const char* tag, const String& msg) {
  consoleLine(tag, msg);

  appendLogLineToSD(timestampISO() + "," + tag + ",\"" + msg + "\"");
  // Los logs son diagnÃ³stico: nunca deben consumir los Ãºltimos espacios de la
  // cola que transporta RFID. Al liberar la cola circular se libera tambiÃ©n la
  // memoria de cada trama; no se acumulan Strings indefinidamente.
  if (ZenitLoRaConfig::ENABLE_NETWORK_DIAGNOSTICS &&
      !g_networkLogForwarding && qCount() < (QUEUE_CAP - 8)) {
    g_networkLogForwarding = true;
    enqueueInboundFrame(SRC_DIAG, String("LOG|RECEIVER|") + PORTICO_ID + "|" + tag + "|" + msg);
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
    case SRC_LORA: return "LORA";
    case SRC_BLE: return "BLE";
    case SRC_SENSOR: return "SENSOR";
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

static bool isPrintableFrameByte(uint8_t c) {
  return c == '\r' || c == '\n' || c == '\t' || (c >= 32 && c <= 126);
}

static String bytesHexPreview(const uint8_t* data, int len, int maxBytes = 24) {
  if (!data || len <= 0) return "";

  String out;
  int shown = len;
  if (shown > maxBytes) shown = maxBytes;

  for (int i = 0; i < shown; ++i) {
    char hex[4];
    snprintf(hex, sizeof(hex), "%02X", data[i]);
    if (i > 0) out += " ";
    out += hex;
  }

  if (len > shown) out += " ...";
  return out;
}

static String framePreview(const String& frame) {
  String preview;
  int limit = frame.length();
  if (limit > 120) limit = 120;

  for (int i = 0; i < limit; ++i) {
    uint8_t c = (uint8_t)frame[i];
    if (isPrintableFrameByte(c)) {
      preview += (char)c;
      continue;
    }

    char escaped[5];
    snprintf(escaped, sizeof(escaped), "\\x%02X", c);
    preview += escaped;
  }

  if (frame.length() > limit) preview += "...";
  return preview;
}

static void logFlow(const String& stage, FrameSrc src, const String& frame) {
  logLine("FLOW", stage +
                  " | src=" + frameSrcName(src) +
                  " | len=" + String(frame.length()) +
                  " | data=" + framePreview(frame));
}

static void logNetworkFlow(const char* stage, const char* link, const String& frame) {
  logLine("FLOW", String(stage) +
                  " | via=" + link +
                  " | dest=" + DEST_HOST + ":" + String(DEST_PORT) +
                  " | len=" + String(frame.length()) +
                  " | data=" + framePreview(frame));
}

static bool connectNetworkClient(EthernetClient& client) {
  if (g_destHostIsIp) {
    return client.connect(g_destIp, DEST_PORT);
  }
  return client.connect(DEST_HOST, DEST_PORT);
}

static bool connectNetworkClient(WiFiClient& client) {
  if (g_destHostIsIp) {
    return client.connect(g_destIp, DEST_PORT);
  }
  return client.connect(DEST_HOST, DEST_PORT);
}

static void trackSeenPortico(const String& porticoId) {
  String cleanId = trimFrame(porticoId);
  if (cleanId.length() == 0) return;

  char portico[48] = {0};
  int len = cleanId.length();
  if (len >= (int)sizeof(portico)) len = (int)sizeof(portico) - 1;
  memcpy(portico, cleanId.c_str(), (size_t)len);
  portico[len] = 0;

  uint32_t now = millis();
  for (int i = 0; i < g_seenCount; ++i) {
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

static void trackPorticoFromFrame(const String& frame) {
  if (frame.length() == 0) return;

  if (frame.startsWith("LORA_DATA|")) {
    int firstSep = frame.indexOf('|');
    int secondSep = frame.indexOf('|', firstSep + 1);
    int thirdSep = frame.indexOf('|', secondSep + 1);
    int fourthSep = frame.indexOf('|', thirdSep + 1);
    if (firstSep > 0 && secondSep > (firstSep + 1) &&
        thirdSep > (secondSep + 1) && fourthSep > (thirdSep + 1)) {
      trackSeenPortico(frame.substring(secondSep + 1, thirdSep));
      trackPorticoFromFrame(trimFrame(frame.substring(fourthSep + 1)));
    }
    return;
  }

  if (frame.startsWith("LORA_LINK|")) {
    int firstSep = frame.indexOf('|');
    int secondSep = frame.indexOf('|', firstSep + 1);
    int thirdSep = frame.indexOf('|', secondSep + 1);
    if (firstSep > 0 && secondSep > (firstSep + 1) && thirdSep > (secondSep + 1)) {
      trackSeenPortico(frame.substring(secondSep + 1, thirdSep));
    }
    return;
  }

  int btMarker = frame.indexOf(":BT:");
  if (btMarker > 0) {
    int field = 0;
    int start = 0;
    for (int i = 0; i <= frame.length(); ++i) {
      if (i == frame.length() || frame[i] == ':') {
        if (field == 5) {
          trackSeenPortico(frame.substring(start, i));
          return;
        }
        field++;
        start = i + 1;
      }
    }
    return;
  }

  if (frame.startsWith("SNS:") || frame.startsWith("ZENIT_DIAG:")) {
    int firstSep = frame.indexOf(':');
    int secondSep = frame.indexOf(':', firstSep + 1);
    if (firstSep >= 0 && secondSep > (firstSep + 1)) {
      trackSeenPortico(frame.substring(firstSep + 1, secondSep));
    }
  }
}

static bool isTextLoRaPayload(const uint8_t* data, int len) {
  if (!data || len <= 0) return false;
  for (int i = 0; i < len; ++i) {
    if (!isPrintableFrameByte(data[i])) return false;
  }
  return true;
}

static String loRaPayloadToString(const uint8_t* data, int len) {
  String frame;
  frame.reserve(len);
  for (int i = 0; i < len; ++i) {
    frame += (char)data[i];
  }
  return frame;
}

static bool sendLoRaControlFrame(const String& frame) {
  if (!ENABLE_LORA || !g_loraOk || frame.length() == 0) return false;

  selectLoRaOnSharedSpi();
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.write((const uint8_t*)frame.c_str(), frame.length());
  bool ok = (LoRa.endPacket() == 1);
  LoRa.receive();
  return ok;
}

static void sendLoRaAckFrame(const char* prefix, const String& senderId, uint32_t seq) {
  String ack = String(prefix) + PAIR_ID + "|" + PORTICO_ID + "|" +
               senderId + "|" + String(seq) + "|OK";
  if (sendLoRaControlFrame(ack)) {
    logLine("LORA", String("ACK TX OK sender=") + senderId +
                    " seq=" + String(seq) +
                    " data=" + framePreview(ack));
  } else {
    logLine("LORA", String("ACK TX FAIL sender=") + senderId +
                    " seq=" + String(seq) +
                    " data=" + framePreview(ack));
  }
}

static bool parseReliableDataFrame(
  const String& frame,
  String& pairId,
  String& senderId,
  uint32_t& seqOut,
  String& payloadOut
) {
  if (!frame.startsWith("LORA_DATA|")) return false;

  int firstSep = frame.indexOf('|');
  int secondSep = frame.indexOf('|', firstSep + 1);
  int thirdSep = frame.indexOf('|', secondSep + 1);
  int fourthSep = frame.indexOf('|', thirdSep + 1);

  if (firstSep < 0 || secondSep <= firstSep ||
      thirdSep <= secondSep || fourthSep <= thirdSep) return false;

  pairId = trimFrame(frame.substring(firstSep + 1, secondSep));
  senderId = trimFrame(frame.substring(secondSep + 1, thirdSep));
  String seqText = trimFrame(frame.substring(thirdSep + 1, fourthSep));
  payloadOut = trimFrame(frame.substring(fourthSep + 1));

  if (pairId.length() == 0 || senderId.length() == 0 ||
      seqText.length() == 0 || payloadOut.length() == 0) return false;
  seqOut = (uint32_t)strtoul(seqText.c_str(), nullptr, 10);
  return true;
}

static bool isDuplicateReliableData(const String& senderId, uint32_t seq) {
  return (strcmp(g_lastReliableSenderId, senderId.c_str()) == 0) && (g_lastReliableSeq == seq);
}

static void rememberReliableData(const String& senderId, uint32_t seq) {
  strncpy(g_lastReliableSenderId, senderId.c_str(), sizeof(g_lastReliableSenderId) - 1);
  g_lastReliableSenderId[sizeof(g_lastReliableSenderId) - 1] = 0;
  g_lastReliableSeq = seq;
}

static bool isAllowedSender(const String& senderId) {
  return senderId == EXPECTED_SENDER_ID;
}

static bool handleLoRaFragment(const String& payload) {
  // Une partes LORA_FRAG. Solo entrega a la red cuando el mensaje esta completo.
  if (!payload.startsWith("LORA_FRAG|")) return false;

  int first = payload.indexOf('|');
  int second = payload.indexOf('|', first + 1);
  int third = payload.indexOf('|', second + 1);
  int fourth = payload.indexOf('|', third + 1);
  if (first < 0 || second <= first || third <= second || fourth <= third) {
    logLine("LORA", "Fragmento invalido descartado.");
    return true;
  }

  uint32_t messageId = (uint32_t)strtoul(payload.substring(first + 1, second).c_str(), nullptr, 10);
  int part = payload.substring(second + 1, third).toInt();
  int total = payload.substring(third + 1, fourth).toInt();
  String chunk = payload.substring(fourth + 1);
  if (messageId == 0 || part < 1 || total < 2 || total > 9 || part > total || chunk.length() == 0) {
    logLine("LORA", "Campos de fragmento invalidos.");
    return true;
  }

  bool expired = g_fragmentAssembly.active &&
                 (millis() - g_fragmentAssembly.lastMs > LORA_FRAGMENT_TIMEOUT_MS);
  if (expired || !g_fragmentAssembly.active || g_fragmentAssembly.messageId != messageId) {
    if (part != 1) {
      logLine("LORA", String("Fragmento fuera de secuencia msg=") + String(messageId));
      return true;
    }
    g_fragmentAssembly.messageId = messageId;
    g_fragmentAssembly.total = (uint8_t)total;
    g_fragmentAssembly.nextPart = 1;
    g_fragmentAssembly.payload = "";
    g_fragmentAssembly.active = true;
  }

  if (g_fragmentAssembly.total != total || g_fragmentAssembly.nextPart != part) {
    logLine("LORA", String("Fragmento duplicado/fuera de orden msg=") + String(messageId));
    return true;
  }

  g_fragmentAssembly.payload += chunk;
  g_fragmentAssembly.lastMs = millis();
  g_fragmentAssembly.nextPart++;
  if (part != total) return true;

  String complete = trimFrame(g_fragmentAssembly.payload);
  g_fragmentAssembly.active = false;
  if (complete.length() > 0) {
    logLine("LORA", String("Trama reensamblada msg=") + String(messageId) +
                    " len=" + String(complete.length()));
    enqueueInboundFrame(SRC_LORA, complete);
  }
  return true;
}

static bool handleLoRaLinkFrame(const String& frame, int rssi, float snr) {
  // Heartbeat del sender: actualiza enlace y responde LINK_ACK.
  if (!frame.startsWith("LORA_LINK|")) return false;

  int firstSep = frame.indexOf('|');
  int secondSep = frame.indexOf('|', firstSep + 1);
  int thirdSep = frame.indexOf('|', secondSep + 1);
  int fourthSep = frame.indexOf('|', thirdSep + 1);
  int fifthSep = frame.indexOf('|', fourthSep + 1);

  if (firstSep < 0 || secondSep <= firstSep || thirdSep <= secondSep ||
      fourthSep <= thirdSep || fifthSep <= fourthSep) {
    logLine("LORA", String("Heartbeat LoRa invalido descartado | data=") + framePreview(frame));
    return true;
  }

  String pairId = trimFrame(frame.substring(firstSep + 1, secondSep));
  String senderId = trimFrame(frame.substring(secondSep + 1, thirdSep));
  String backboneId = trimFrame(frame.substring(thirdSep + 1, fourthSep));
  String seqText = trimFrame(frame.substring(fifthSep + 1));
  uint32_t seq = (uint32_t)strtoul(seqText.c_str(), nullptr, 10);

  if (pairId != PAIR_ID) {
    logLine("PAIR", String("Solicitud de otra pareja descartada | recibida=") + pairId +
                    " | esperada=" + PAIR_ID);
    return true;
  }

  if (!isAllowedSender(senderId)) {
    logLine("LORA", String("Heartbeat de sender no autorizado descartado: ") + senderId);
    return true;
  }

  bool hadActivePeer = g_linkPeer.active;
  bool linkWasTimedOut = g_linkTimeoutLogged;
  bool changedPeer = (strcmp(g_linkPeer.senderId, senderId.c_str()) != 0) ||
                     (strcmp(g_linkPeer.backboneId, backboneId.c_str()) != 0);

  strncpy(g_linkPeer.senderId, senderId.c_str(), sizeof(g_linkPeer.senderId) - 1);
  g_linkPeer.senderId[sizeof(g_linkPeer.senderId) - 1] = 0;
  strncpy(g_linkPeer.backboneId, backboneId.c_str(), sizeof(g_linkPeer.backboneId) - 1);
  g_linkPeer.backboneId[sizeof(g_linkPeer.backboneId) - 1] = 0;
  g_linkPeer.lastSeenMs = millis();
  g_linkPeer.lastSeq = seq;
  g_linkPeer.lastRssi = rssi;
  g_linkPeer.lastSnr = snr;
  g_linkPeer.active = true;
  g_linkTimeoutLogged = false;

  trackPorticoFromFrame(frame);

  if (!hadActivePeer || changedPeer || linkWasTimedOut || seq <= 1) {
    logLine("PAIR", String("Estado ENLAZADO | pareja=") + PAIR_ID +
                    " | sender=" + g_linkPeer.senderId +
                    " backbone=" + g_linkPeer.backboneId +
                    " seq=" + String(g_linkPeer.lastSeq) +
                    " rssi=" + String(g_linkPeer.lastRssi) +
                    " snr=" + String(g_linkPeer.lastSnr, 2));
  }

  sendLoRaAckFrame("LORA_LINK_ACK|", senderId, seq);

  return true;
}

static bool handleLoRaTestFrame(const String& frame, int rssi, float snr) {
  // Trama generada por sender mientras TEST_MODE=true.
  if (!frame.startsWith("LORA_TEST|")) return false;

  int firstSep = frame.indexOf('|');
  int secondSep = frame.indexOf('|', firstSep + 1);
  int thirdSep = frame.indexOf('|', secondSep + 1);
  int fourthSep = frame.indexOf('|', thirdSep + 1);

  if (firstSep < 0 || secondSep <= firstSep || thirdSep <= secondSep || fourthSep <= thirdSep) {
    logLine("LORA", String("Test LoRa invalido descartado | data=") + framePreview(frame));
    return true;
  }

  String senderId = trimFrame(frame.substring(firstSep + 1, secondSep));
  String freqLabel = trimFrame(frame.substring(secondSep + 1, thirdSep));
  String seqText = trimFrame(frame.substring(fourthSep + 1));

  if (!isAllowedSender(senderId)) {
    logLine("LORA", String("TEST de sender no autorizado descartado: ") + senderId);
    return true;
  }

  trackSeenPortico(senderId);
  logLine("LORA", String("TEST RX sender=") + senderId +
                  " freq=" + freqLabel +
                  " seq=" + seqText +
                  " rssi=" + String(rssi) +
                  " snr=" + String(snr, 2));
  uint32_t seq = (uint32_t)strtoul(seqText.c_str(), nullptr, 10);
  sendLoRaAckFrame("LORA_ACK|", senderId, seq);
  return true;
}

static bool handleLoRaDataFrame(const String& frame, int rssi, float snr) {
  // Produccion: valida sender, ACKea, descarta duplicados y procesa payload.
  String senderId;
  String pairId;
  String payload;
  uint32_t seq = 0;

  if (!parseReliableDataFrame(frame, pairId, senderId, seq, payload)) return false;

  if (pairId != PAIR_ID) {
    logLine("PAIR", String("DATA de otra pareja descartado | recibida=") + pairId +
                    " | esperada=" + PAIR_ID);
    return true;
  }

  if (!isAllowedSender(senderId)) {
    logLine("LORA", String("DATA de sender no autorizado descartado: ") + senderId);
    return true;
  }

  if (!isLoRaLinkAlive() || strcmp(g_linkPeer.senderId, senderId.c_str()) != 0) {
    logLine("PAIR", String("DATA descartado sin enlace previo | pareja=") + PAIR_ID +
                    " | sender=" + senderId);
    return true;
  }

  sendLoRaAckFrame("LORA_ACK|", senderId, seq);
  trackSeenPortico(senderId);

  if (strcmp(g_linkPeer.senderId, senderId.c_str()) == 0) {
    g_linkPeer.lastSeenMs = millis();
    g_linkPeer.lastRssi = rssi;
    g_linkPeer.lastSnr = snr;
  }

  if (isDuplicateReliableData(senderId, seq)) {
    logLine("LORA", String("DATA duplicado ACKeado sender=") + senderId +
                    " seq=" + String(seq) +
                    " data=" + framePreview(payload));
    return true;
  }

  rememberReliableData(senderId, seq);
  trackPorticoFromFrame(payload);

  if (handleLoRaFragment(payload)) return true;

  // Confirmacion visible en el Monitor Serie: las tramas compactas RFID son
  // las que el sender construye a partir de la antena/lector GAO.
  if (payload.startsWith("RFID|")) {
    logLine("GAO", String("RFID recibido por LoRa desde sender=") + senderId +
                   " seq=" + String(seq) +
                   " rssi=" + String(rssi) +
                   " snr=" + String(snr, 2) +
                   " data=" + framePreview(payload));
  }

  logLine("LORA", String("DATA RX sender=") + senderId +
                  " seq=" + String(seq) +
                  " rssi=" + String(rssi) +
                  " snr=" + String(snr, 2) +
                  " data=" + framePreview(payload));
  logFlow("LoRa RX -> cola red", SRC_LORA, payload);
  enqueueInboundFrame(SRC_LORA, payload);
  return true;
}

static void monitorLoRaLink() {
  if (!g_linkPeer.active || g_linkPeer.lastSeenMs == 0) return;

  uint32_t ageMs = millis() - g_linkPeer.lastSeenMs;
  if (ageMs < LORA_LINK_TIMEOUT_MS) return;

  g_linkPeer.active = false;
  g_linkTimeoutLogged = true;
  g_fragmentAssembly.active = false;
  logLine("PAIR", String("Estado BUSCANDO | pareja=") + PAIR_ID +
                  " | sender perdido=" + g_linkPeer.senderId +
                  " | sin tramas hace " + String(ageMs) + " ms");
}

static bool isLoRaLinkAlive() {
  return g_linkPeer.active &&
         g_linkPeer.lastSeenMs != 0 &&
         (millis() - g_linkPeer.lastSeenMs) < LORA_LINK_TIMEOUT_MS;
}

static void printSeenPorticos() {
  debugPrintLine("--------------------------------------------------");
  debugPrintf("[LORA] Porticos vistos (%d):\n", g_seenCount);
  for (int i = 0; i < g_seenCount; ++i) {
    debugPrintf("  - %s | count=%lu | last=%lums\n",
                g_seen[i].id,
                (unsigned long)g_seen[i].count,
                (unsigned long)(millis() - g_seen[i].lastMs));
  }
  debugPrintLine("--------------------------------------------------");
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
  selectLoRaOnSharedSpi();
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
  digitalWrite(ETH_CS_PIN, HIGH);
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
  g_lastIdleLoRaLogMs = millis();

  debugPrintf("[LORA] OK RX @%.1fMHz | SF=%d | BW=%ld | CR=4/%d | SYNC=0x%02X\n",
              (double)frequencyHz / 1e6,
              LORA_SF,
              (long)LORA_BW,
              LORA_CR,
              (unsigned)LORA_SYNCWORD);
  logLine("LORA", String("Frecuencia LoRa seleccionada=") + loraSelectedFrequencyLabel());
  logLine("LORA", String("SPI LoRa=") + String(LORA_SPI_FREQUENCY) + "Hz");
  logLine("LORA", "Radio en modo RX. Esperando tramas...");
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

// Centraliza todo lo que termina publicado hacia la red por TCP.
static void enqueueInboundFrame(FrameSrc src, String frame) {
  frame = trimFrame(frame);
  if (frame.length() == 0) return;

  // Una presencia RFID sostenida genera muchas tramas iguales. Conservamos una
  // renovacion cada 30 s, suficiente para last_seen, sin saturar la cola TCP.
  static String lastRfidEpc;
  static uint32_t lastRfidQueuedMs = 0;
  if (src == SRC_LORA && frame.startsWith("RFID|")) {
    int epcEnd = frame.indexOf('|', 5);
    String epc = epcEnd > 5 ? frame.substring(5, epcEnd) : frame;
    if (epc == lastRfidEpc && (uint32_t)(millis() - lastRfidQueuedMs) < 30000UL) {
      logLine("QUEUE", "RFID repetido coalescido; se mantiene presencia.");
      return;
    }
    lastRfidEpc = epc;
    lastRfidQueuedMs = millis();
  }

  if (!queuePush(src, frame)) {
    logLine("QUEUE", String("Cola llena. Se guarda en SD desde ") + frameSrcName(src));
    appendBufferFrame(frame);
    return;
  }

  logFlow("Cola red OK", src, frame);
}

// Lee una trama LoRa completa, registra su metadata y la publica a la cola de red.
static void pollLoRa() {
  // Lee paquete, registra RSSI/SNR y deriva a LINK, TEST, DATA o payload clasico.
  if (!ENABLE_LORA || !g_loraOk) return;

  selectLoRaOnSharedSpi();
  int packetSize = LoRa.parsePacket();
  if (packetSize <= 0) {
    uint32_t now = millis();
    if (now - g_lastIdleLoRaLogMs >= LORA_IDLE_LOG_MS) {
      g_lastIdleLoRaLogMs = now;
      if (g_lastRxMs == 0) {
        consoleLine("LORA", "Esperando primera trama LoRa...");
      } else {
        consoleLine("LORA", String("Sin tramas nuevas desde hace ") +
                            String(now - g_lastRxMs) +
                            " ms. RX sigue activo.");
      }
    }
    return;
  }

  uint8_t raw[FRAME_MAX];
  int idx = 0;

  while (LoRa.available() && idx < (FRAME_MAX - 1)) {
    int c = LoRa.read();
    if (c < 0) break;
    raw[idx++] = (uint8_t)c;
  }

  g_lastRxMs = millis();
  g_lastIdleLoRaLogMs = g_lastRxMs;

  int packetRssi = LoRa.packetRssi();
  float packetSnr = LoRa.packetSnr();
  if (!isTextLoRaPayload(raw, idx)) {
    logLine("LORA", String("RX descartado no-texto len=") + String(idx) +
                    " rssi=" + String(packetRssi) +
                    " snr=" + String(packetSnr, 2) +
                    " hex=" + bytesHexPreview(raw, idx));
    LoRa.receive();
    return;
  }

  String frame = trimFrame(loRaPayloadToString(raw, idx));
  if (frame.length() == 0) {
    logLine("LORA", String("RX texto vacio descartado len=") + String(idx));
    LoRa.receive();
    return;
  }

  if (handleLoRaLinkFrame(frame, packetRssi, packetSnr)) {
    LoRa.receive();
    return;
  }

  if (handleLoRaTestFrame(frame, packetRssi, packetSnr)) {
    LoRa.receive();
    return;
  }

  if (handleLoRaDataFrame(frame, packetRssi, packetSnr)) {
    LoRa.receive();
    return;
  }

  logLine("PAIR", String("Trama sin protocolo de pareja descartada | len=") + String(frame.length()) +
                  " rssi=" + String(packetRssi) +
                  " snr=" + String(packetSnr, 2) +
                  " data=" + framePreview(frame));

  LoRa.receive();
}

// =======================================================
// Ethernet / WiFi
// =======================================================

static void tcpBackoffOnFail() {
  g_tcpFailCount++;
  uint32_t factor = (g_tcpFailCount <= 6) ? (1U << (g_tcpFailCount - 1)) : 64U;
  uint32_t backoff = TCP_BACKOFF_MS_BASE * factor;
  if (backoff > TCP_BACKOFF_MS_MAX) backoff = TCP_BACKOFF_MS_MAX;
  g_tcpNextTryMs = millis() + backoff;
}

static void tcpResetOnSuccess() {
  g_tcpFailCount = 0;
  g_tcpNextTryMs = 0;
}

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
  logLine("ETH", String("Ethernet OK mode=") + (usedDhcp ? "DHCP" : "STATIC") +
                 " IP=" + Ethernet.localIP().toString() +
                 " GW=" + g_ethGateway.toString() +
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

  configTime(-3 * 3600, 0, "pool.ntp.org");
  logLine("WIFI", String("WiFi OK. IP=") + WiFi.localIP().toString());
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

// Intenta entregar la trama por Ethernet primero y deja WiFi como respaldo.
static bool sendFrameToNetwork(const char* frame, bool verbose = true) {
  if (!frame || !frame[0]) return false;

  String frameStr(frame);
  uint32_t now = millis();
  if (g_tcpNextTryMs != 0 && now < g_tcpNextTryMs) {
    return false;
  }

  if (ENABLE_ETHERNET && g_ethOk) {
    if (verbose) {
      logNetworkFlow("RED TX START", "ETH", frameStr);
    }
    EthernetClient client;
    if (connectNetworkClient(client)) {
      client.println(frame);
      client.stop();
      if (verbose) {
        logLine("TCP", String("ETH -> ") + framePreview(frameStr));
        logNetworkFlow("RED TX OK", "ETH", frameStr);
      }
      tcpResetOnSuccess();
      return true;
    }

    if (verbose) {
      logNetworkFlow("RED TX FAIL", "ETH", frameStr);
    }
  }

  if (ENABLE_WIFI && g_wifiOk) {
    if (verbose) {
      logNetworkFlow("RED TX START", "WIFI", frameStr);
    }
    WiFiClient client;
    if (connectNetworkClient(client)) {
      client.println(frame);
      client.stop();
      if (verbose) {
        logLine("TCP", String("WIFI -> ") + framePreview(frameStr));
        logNetworkFlow("RED TX OK", "WIFI", frameStr);
      }
      tcpResetOnSuccess();
      return true;
    }

    if (verbose) {
      logNetworkFlow("RED TX FAIL", "WIFI", frameStr);
    }
  }

  tcpBackoffOnFail();
  if (verbose) {
    logLine("TCP", "ERROR: no se pudo enviar la trama a la red.");
  }
  return false;
}

static String networkSourceIp() {
  if (ENABLE_ETHERNET && g_ethOk) {
    return Ethernet.localIP().toString();
  }
  if (ENABLE_WIFI && g_wifiOk) {
    return WiFi.localIP().toString();
  }
  return "";
}

static String buildReceiverHeartbeatFrame() {
  String lastLoRaRxMs = g_lastRxMs == 0 ? "" : String(millis() - g_lastRxMs);
  bool linkAlive = isLoRaLinkAlive();
  String linkedSender = linkAlive ? String(g_linkPeer.senderId) : "";
  String linkAgeMs = linkAlive ? String(millis() - g_linkPeer.lastSeenMs) : "";
  String lastRssi = g_linkPeer.lastSeenMs != 0 ? String(g_linkPeer.lastRssi) : "";
  String lastSnr = g_linkPeer.lastSeenMs != 0 ? String(g_linkPeer.lastSnr, 2) : "";

  return String("RCV_HEARTBEAT|") + PORTICO_ID +
         "|" + BACKBONE_ID +
         "|" + networkSourceIp() +
         "|" + String(qCount()) +
         "|" + String(g_tcpFailCount) +
         "|" + lastLoRaRxMs +
         "|" + linkedSender +
         "|" + linkAgeMs +
         "|" + String(linkAlive ? 1 : 0) +
         "|" + lastRssi +
         "|" + lastSnr +
         "|" + DEST_HOST + ":" + String(DEST_PORT);
}

static void serviceReceiverHeartbeat() {
  if ((!ENABLE_ETHERNET || !g_ethOk) && (!ENABLE_WIFI || !g_wifiOk)) return;

  uint32_t now = millis();
  if (g_lastReceiverHeartbeatMs != 0 && (now - g_lastReceiverHeartbeatMs) < RECEIVER_HEARTBEAT_MS) {
    return;
  }

  String frame = buildReceiverHeartbeatFrame();
  bool ok = sendFrameToNetwork(frame.c_str(), false);
  g_lastReceiverHeartbeatMs = now;

  if (ok) {
    logLine("HEART", String("Listener heartbeat OK | receiver=") + PORTICO_ID +
                     " | sender=" + (isLoRaLinkAlive() ? String(g_linkPeer.senderId) : String("-")) +
                     " | target=" + DEST_HOST + ":" + String(DEST_PORT));
    return;
  }

  logLine("HEART", String("Listener heartbeat FAIL | receiver=") + PORTICO_ID +
                   " | queue=" + String(qCount()) +
                   " | tcpFails=" + String(g_tcpFailCount) +
                   " | target=" + DEST_HOST + ":" + String(DEST_PORT));
}

// Procesa la cola en pequenos bloques para no bloquear el loop principal.
static void processOutboundQueue() {
  // Entrega cola al listener TCP; si falla reintenta y despues usa SD.
  uint32_t start = millis();
  static constexpr uint32_t TCP_BUDGET_MS = 8;

  FrameItem item;
  while (queuePop(item)) {
    if (millis() - start > TCP_BUDGET_MS) {
      queueRePush(item);
      return;
    }

    bool ok = sendFrameToNetwork(item.data);
    if (!ok) {
      item.retries++;
      if (item.retries <= 2) {
        if (!queueRePush(item)) {
          appendBufferFrame(String(item.data));
          logLine("FLOW", String("Requeue fallo -> buffer SD | data=") +
                          framePreview(String(item.data)));
        }
      } else {
        appendBufferFrame(String(item.data));
        logLine("FLOW", String("RED TX agotado -> buffer SD | retries=") +
                        String(item.retries) +
                        " | data=" + framePreview(String(item.data)));
      }
      return;
    }

    delay(1);
  }
}

static void serviceReceiverNetworkWindow() {
  uint32_t now = millis();
  if ((uint32_t)(now - g_lastReceiverNetworkFlushMs) < RECEIVER_NETWORK_FLUSH_MS) return;

  g_lastReceiverNetworkFlushMs = now;
  logLine("SCHED", String("Receiver: despacho RED tras 45 s de escucha LoRa | cola=") + String(qCount()));
  if (ENABLE_ETHERNET && g_ethOk) {
    selectEthernetOnSharedSpi();
    Ethernet.maintain();
  }
  processOutboundQueue();
}

// =======================================================
// BLE local opcional
// =======================================================

class ReceiverBleCallbacks : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    if (!ENABLE_LOCAL_BLE) return;

    String addr = String(advertisedDevice.getAddress().toString().c_str());
    String frame = addr + ":BT:" + timestampISO() + ":" +
                   BACKBONE_ID + ":" + EDGE_KIND + ":" + PORTICO_ID + ":" +
                   String(advertisedDevice.getRSSI());

    enqueueInboundFrame(SRC_BLE, frame);
  }
};

static void initBLE() {
  if (!ENABLE_LOCAL_BLE) {
    logLine("BLE", "BLE local deshabilitado.");
    return;
  }

  BLEDevice::init(BLE_NAME);
  g_scan = BLEDevice::getScan();
  g_scan->setAdvertisedDeviceCallbacks(new ReceiverBleCallbacks());
  g_scan->setActiveScan(true);
  g_scan->setInterval(50);
  g_scan->setWindow(45);

  logLine("BLE", "BLE local listo.");
}

static void pollBLE() {
  if (!ENABLE_LOCAL_BLE || !g_scan) return;
  if (millis() - g_lastBleScanMs < BLE_SCAN_EVERY_MS) return;

  g_lastBleScanMs = millis();
  g_scan->start((int)BLE_SCAN_SECONDS, false);
  g_scan->clearResults();
}

// =======================================================
// Sensores - placeholder
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

  float a1_mA = (vA1 / 249.0f) * 1000.0f;
  float a4_Vin = vA4 * 2.0f;

  String frame = String("SNS:") + PORTICO_ID + ":" + timestampISO() +
                 ":A1_mA=" + String(a1_mA, 3) +
                 ":A2_V=" + String(vA2, 4) +
                 ":A3_V=" + String(vA3, 4) +
                 ":A4_V=" + String(a4_Vin, 3);

  logLine("SNS", frame);
  enqueueInboundFrame(SRC_SENSOR, frame);
}

// =======================================================
// Setup / loop
// =======================================================

void setup() {
  // Inicializacion ordenada con logs INIT ...=OK/FAIL.
  uint32_t setupStartedMs = millis();
  initConsole();
  uint32_t setupElapsedMs = millis() - setupStartedMs;
  if (setupElapsedMs < ZenitLoRaConfig::POWER_ON_SETTLE_MS) {
    delay(ZenitLoRaConfig::POWER_ON_SETTLE_MS - setupElapsedMs);
  }

  g_destHostIsIp = g_destIp.fromString(DEST_HOST);

  prepareSpiPins();
  if (!ENABLE_LORA_TEST_MODE) {
    initSD();
    logLine("BOOT", String("INIT SD=") + (g_sdOk ? "OK" : "FAIL"));
    delay(ZenitLoRaConfig::INIT_SETTLE_MS);
  }

  logLine("BOOT", String("PORTICO_ID=") + PORTICO_ID);
  logLine("BOOT", String("PAIR_ID=") + PAIR_ID +
                  " SENDER_ESPERADO=" + EXPECTED_SENDER_ID);
  logLine("BOOT", String("Destino resuelto como ") +
                  (g_destHostIsIp ? String("IP literal ") + g_destIp.toString() : String("hostname ") + DEST_HOST));
  logLine("BOOT", String("ETH=") + (ENABLE_ETHERNET ? "ON" : "OFF") +
                  " WIFI=" + (ENABLE_WIFI ? "ON" : "OFF") +
                  " BLE=" + (ENABLE_LOCAL_BLE ? "ON" : "OFF") +
                  " SD=" + (ENABLE_SD_CARD ? "ON" : "OFF") +
                  " SNS=" + (ENABLE_SENSOR_READ ? "ON" : "OFF"));
  logLine("BOOT", String("LoRa test mode=") + (ENABLE_LORA_TEST_MODE ? "ON" : "OFF"));
  g_lastReceiverNetworkFlushMs = millis();

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
    logLine("BOOT", String("INIT BLE=") + (ENABLE_LOCAL_BLE ? (g_scan ? "OK" : "FAIL") : "OFF"));
    delay(ZenitLoRaConfig::INIT_SETTLE_MS);

    initSensors();
    logLine("BOOT", String("INIT Sensores=") + (ENABLE_SENSOR_READ ? (g_adsOk ? "OK" : "FAIL") : "OFF"));
  }

  logLine("BOOT", String("Destino TCP=") + DEST_HOST + ":" + String(DEST_PORT));
  if (!ENABLE_LORA_TEST_MODE) {
    logLine("BOOT", "Estado inicial BUSCANDO: solo LoRa hasta enlazar la pareja.");
    logLine("BOOT", "Enlazado: escucha/ACK LoRa continua; envio RED cada 45 s.");
  }
  if (ENABLE_LORA_TEST_MODE) {
    logLine("BOOT", "Modo TEST LoRa activo. Solo escucha e imprime tramas LORA_TEST.");
    logLine("BOOT", "ENC28J60 aislado: CS alto y RESET bajo.");
  }
  logLine("BOOT", "Setup completo.");
}

void loop() {
  // TEST: solo radio. PRODUCCION: radio primero y luego fuentes/red.
  serviceLoRaRecovery();

  if (ENABLE_LORA_TEST_MODE) {
    // Ruta exclusiva de la prueba: no se atiende ningun periferico adicional.
    pollLoRa();
    delay(5);
    return;
  }

  pollLoRa();
  monitorLoRaLink();

  // El pulso de vida es independiente de LoRa y de la cola de datos. Así el
  // listener distingue "receiver encendido sin sender" de "receiver apagado".
  // No debe esperar la ventana de despacho de 45 s.
  serviceEthernetRecovery();
  serviceReceiverHeartbeat();

  // Sin handshake valido no se atienden sensores ni red. El receiver queda
  // completamente disponible en RX para que su sender exclusivo lo encuentre.
  if (!isLoRaLinkAlive()) {
    static uint32_t lastSearchLogMs = 0;
    uint32_t now = millis();
    if (now - lastSearchLogMs >= 10000UL) {
      lastSearchLogMs = now;
      logLine("PAIR", String("BUSCANDO pareja=") + PAIR_ID +
                      " receiver=" + PORTICO_ID +
                      " sender=" + EXPECTED_SENDER_ID);
    }
    delay(ENABLE_LOW_POWER ? 50 : 5);
    return;
  }

  checkWiFi();
  pollBLE();
  pollSensors();
  serviceReceiverNetworkWindow();

  static uint32_t lastSeenMs = 0;
  if (millis() - lastSeenMs > 15000) {
    lastSeenMs = millis();
    printSeenPorticos();
  }

  static uint32_t lastSysMs = 0;
  if (millis() - lastSysMs > 10000) {
    lastSysMs = millis();
    logLine("SYS", String("Queue=") + qCount() +
                   " Pair=" + PAIR_ID +
                   " State=ENLAZADO" +
                   " Eth=" + (g_ethOk ? "OK" : "RECOVERY") +
                   " Link=" + (g_ethLinkUp ? "UP" : "DOWN") +
                   " Heap=" + ESP.getFreeHeap() +
                   " lastRxMs=" + (millis() - g_lastRxMs) +
                   " tcpFails=" + g_tcpFailCount);
  }

  delay(ENABLE_LOW_POWER ? 50 : 5);
}
