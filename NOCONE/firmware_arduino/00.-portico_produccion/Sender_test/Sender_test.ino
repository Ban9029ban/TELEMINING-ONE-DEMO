#include <Arduino.h>
#include <SPI.h>

// ============================================================
// ZENIT LoRa PIN SCANNER (SX127x RegVersion @ 0x42)
// - Fuerza bruta sobre pines candidatos (controlado)
// - Mucho log para ver dónde va
// - Sin WDT (para evitar errores de ESP-IDF v5.5)
// ============================================================

static const uint32_t SERIAL_BAUD = 115200;

// --- Registros SX127x ---
static const uint8_t REG_VERSION = 0x42;   // SX127x RegVersion
static const uint8_t SX127X_VER_1 = 0x12;  // SX1276/77/78/79
static const uint8_t SX127X_VER_2 = 0x22;  // SX1272/73

// --- Estructura para sets SPI ---
struct SpiSet {
  const char* name;
  int sck;
  int mosi;
  int miso;
};

// ============================================================
// 1) SPI sets a probar (primero tu esquemático)
//    Ajusta/expande si lo necesitas.
// ============================================================
static SpiSet SPI_SETS[] = {
  // Tu esquemático (lo que se ve claro): MOSI=20, SCK=21, MISO=22
  { "SCHEMATIC_SPI", 12, 11, 13 },

  // Candidatos razonables en ESP32-S3 (por si el ruteo cambió)
  // (son ejemplos; puedes agregar/quitar)
  { "ALT_SPI_1", 36, 35, 37 },
  { "ALT_SPI_2", 12, 11, 13 },
  { "ALT_SPI_3", 10,  9,  8  },
};

static const int SPI_SETS_COUNT = sizeof(SPI_SETS) / sizeof(SPI_SETS[0]);

// ============================================================
// 2) NSS / RST / DIO0 candidatos según tu esquemático
//    - En tu imagen: LORA_NSS = IO16, LORA_RST = IO15
//    - Abajo también aparece "ESP_CS" cerca de 19 (candidato)
//    - DIO0 en tu log aparece como 47 (candidato fuerte)
//    - También probamos DIOx por si DIO0 quedó en otro.
// ============================================================

static int NSS_PINS[]  = { 16, 19, 5, 4, 2, 15 };   // incluye 16 y 19 primero (esquemático y "ESP_CS")
static int RST_PINS[]  = { 15, 14, 17, 18, 8, 9 };  // 15 primero (esquemático)
static int DIO0_PINS[] = { 38, 39, 40, 41, 42, -1 }; // 47 primero (tu log/esquemático). -1 = "no usar"

// OJO: evitar IO0 (strap boot) en este escaneo.
static bool isBadPin(int p) {
  return (p == 0);
}

// Velocidades a probar (partimos alto, bajamos por si hay señal “sucia”)
static uint32_t SPI_HZ_LIST[] = { 1000000, 500000, 200000, 100000 };
static const int SPI_HZ_COUNT = sizeof(SPI_HZ_LIST)/sizeof(SPI_HZ_LIST[0]);

// ============================================================
// Utilidades
// ============================================================

static void printPinList(const char* label, const int* arr, int n) {
  Serial.print(label);
  Serial.print(": ");
  for (int i = 0; i < n; i++) {
    Serial.print(arr[i]);
    if (i != n - 1) Serial.print(", ");
  }
  Serial.println();
}

static void safePinModeOut(int pin, int level) {
  if (pin < 0) return;
  if (isBadPin(pin)) return;
  pinMode(pin, OUTPUT);
  digitalWrite(pin, level);
}

static void safePinModeIn(int pin) {
  if (pin < 0) return;
  if (isBadPin(pin)) return;
  pinMode(pin, INPUT);
}

static void deinitPins(int nss, int rst, int dio0) {
  if (nss >= 0 && !isBadPin(nss)) pinMode(nss, INPUT);
  if (rst >= 0 && !isBadPin(rst)) pinMode(rst, INPUT);
  if (dio0 >= 0 && !isBadPin(dio0)) pinMode(dio0, INPUT);
}

// Lee un registro SX127x por SPI “raw”
static uint8_t sx127xReadReg(SPIClass& spi, int nssPin, uint8_t addr, uint8_t spiMode, uint32_t hz) {
  // addr con bit7=0 para READ
  uint8_t out = 0;

  spi.beginTransaction(SPISettings(hz, MSBFIRST, spiMode));
  digitalWrite(nssPin, LOW);
  delayMicroseconds(5);

  spi.transfer(addr & 0x7F);
  out = spi.transfer(0x00);

  delayMicroseconds(5);
  digitalWrite(nssPin, HIGH);
  spi.endTransaction();

  return out;
}

// Intenta una combinación; retorna true si encontró “firma” SX127x
static bool tryOneCombo(const SpiSet& s, int nssPin, int rstPin, int dio0Pin) {
  // Validaciones rápidas
  if (nssPin < 0 || rstPin < 0) return false;
  if (isBadPin(nssPin) || isBadPin(rstPin) || isBadPin(dio0Pin)) return false;

  // Creamos un SPIClass dedicado (mejor que el global cuando iteras pines)
  SPIClass spi(FSPI);

  // Preparar pines
  safePinModeOut(nssPin, HIGH);
  safePinModeOut(rstPin, HIGH);
  if (dio0Pin >= 0) safePinModeIn(dio0Pin);

  Serial.printf("  - SPI.begin(SCK=%d MISO=%d MOSI=%d NSS=%d) ...\n", s.sck, s.miso, s.mosi, nssPin);
  spi.begin(s.sck, s.miso, s.mosi, nssPin);
  Serial.println("  - SPI.begin OK");

  // Reset del radio (si realmente ese pin es RST)
  Serial.printf("  - Toggling RST pin %d ...\n", rstPin);
  digitalWrite(rstPin, LOW);
  delay(5);
  digitalWrite(rstPin, HIGH);
  delay(10);

  // Probar modos/velocidades
  for (int mode = 0; mode <= 3; mode++) {
    for (int hi = 0; hi < SPI_HZ_COUNT; hi++) {
      uint32_t hz = SPI_HZ_LIST[hi];

      Serial.printf("  - Read RegVersion @0x%02X (MODE=%d, HZ=%lu) ...\n", REG_VERSION, mode, (unsigned long)hz);

      // Leer varias veces (a veces el primer read sale basura)
      uint8_t v1 = sx127xReadReg(spi, nssPin, REG_VERSION, (uint8_t)mode, hz);
      delay(2);
      uint8_t v2 = sx127xReadReg(spi, nssPin, REG_VERSION, (uint8_t)mode, hz);
      delay(2);
      uint8_t v3 = sx127xReadReg(spi, nssPin, REG_VERSION, (uint8_t)mode, hz);

      Serial.printf("    -> RegVersion: 0x%02X 0x%02X 0x%02X\n", v1, v2, v3);

      // Criterio “encontrado”
      if ((v1 == SX127X_VER_1 || v1 == SX127X_VER_2) ||
          (v2 == SX127X_VER_1 || v2 == SX127X_VER_2) ||
          (v3 == SX127X_VER_1 || v3 == SX127X_VER_2)) {

        Serial.println();
        Serial.println("************ FOUND SX127x SIGNATURE! ************");
        Serial.printf("SPI=%s (SCK=%d MOSI=%d MISO=%d) | NSS=%d RST=%d DIO0=%d\n",
                      s.name, s.sck, s.mosi, s.miso, nssPin, rstPin, dio0Pin);
        Serial.println("*************************************************");
        Serial.println();

        spi.end();
        deinitPins(nssPin, rstPin, dio0Pin);
        return true;
      }
    }
  }

  // Si no funcionó, limpiar y salir
  spi.end();
  deinitPins(nssPin, rstPin, dio0Pin);
  return false;
}

// ============================================================
// Setup / Loop
// ============================================================

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(800);

  Serial.println();
  Serial.println("=== ZENIT LoRa PIN SCANNER (SX127x RegVersion) ===");
  Serial.println("Objetivo: encontrar pines reales leyendo RegVersion=0x12 o 0x22 desde 0x42.");
  Serial.println("Primero prueba el set del esquematico; luego candidatos.");
  Serial.println("NOTA: mira los logs por intento. Si encuentra 0x12/0x22, imprime FOUND.");
  Serial.println("--------------------------------------------------");

  printPinList("NSS candidates", NSS_PINS, (int)(sizeof(NSS_PINS)/sizeof(NSS_PINS[0])));
  printPinList("RST candidates", RST_PINS, (int)(sizeof(RST_PINS)/sizeof(RST_PINS[0])));
  printPinList("DIO0 candidates", DIO0_PINS, (int)(sizeof(DIO0_PINS)/sizeof(DIO0_PINS[0])));

  Serial.println();
}

void loop() {
  static uint32_t attempt = 0;

  Serial.printf("\nATTEMPT #%lu\n", (unsigned long)attempt++);
  bool found = false;

  for (int si = 0; si < SPI_SETS_COUNT && !found; si++) {
    const SpiSet& s = SPI_SETS[si];

    Serial.println("--------------------------------------------------");
    Serial.printf("--- SPI SET #%d -> %s (SCK%d MOSI%d MISO%d)\n", si, s.name, s.sck, s.mosi, s.miso);

    for (int ni = 0; ni < (int)(sizeof(NSS_PINS)/sizeof(NSS_PINS[0])) && !found; ni++) {
      int nss = NSS_PINS[ni];

      for (int ri = 0; ri < (int)(sizeof(RST_PINS)/sizeof(RST_PINS[0])) && !found; ri++) {
        int rst = RST_PINS[ri];

        for (int di = 0; di < (int)(sizeof(DIO0_PINS)/sizeof(DIO0_PINS[0])) && !found; di++) {
          int dio0 = DIO0_PINS[di];

          Serial.printf("[TRY] SPI=%s | SCK=%d MOSI=%d MISO=%d | NSS=%d RST=%d DIO0=%d\n",
                        s.name, s.sck, s.mosi, s.miso, nss, rst, dio0);

          // Evitar pines problemáticos
          if (isBadPin(nss) || isBadPin(rst) || isBadPin(dio0)) {
            Serial.println("  - SKIP: pin conflict (GPIO0 or invalid)");
            continue;
          }

          // Intento real
          bool ok = tryOneCombo(s, nss, rst, dio0);
          if (ok) {
            found = true;
            break;
          }

          // Pequeña pausa para que se vea el log y no sature
          delay(30);
          yield();
        }
      }
    }
  }

  if (!found) {
    Serial.println("\nNo encontrado en este ciclo. Reintentando desde el inicio en 2s...\n");
    delay(2000);
  } else {
    Serial.println("Escaneo detenido (encontrado). Si quieres que siga buscando otros, reinicia.");
    while (true) { delay(1000); }
  }
}
