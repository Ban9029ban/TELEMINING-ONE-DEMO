#pragma once

#include <stdint.h>

// Perfil comun para sender y receiver. Cambiar aqui evita que ambos extremos
// queden con frecuencia, pines o modem LoRa distintos.
namespace ZenitLoRaConfig {
// Produccion: habilita los servicios Ethernet de sender y receiver.
// Usar true solo para la prueba aislada de radio LORA_TEST/LORA_ACK.
static constexpr bool TEST_MODE = false;
// Diagnóstico temporal por USB. Las escrituras son no bloqueantes para no
// detener LoRa/Ethernet; volver a false antes de instalar en terreno.
static constexpr bool ENABLE_SERIAL_DIAGNOSTICS = true;
// Envía diagnósticos al listener para depuración sin USB. Desactivar en terreno.
static constexpr bool ENABLE_NETWORK_DIAGNOSTICS = true;
// Identidad exclusiva de esta pareja. Para un segundo juego de placas se debe
// usar otro PAIR_ID y sus IDs propios en ambos firmwares (por ejemplo 0002).
static constexpr const char* PAIR_ID = "0001";
static constexpr const char* SENDER_ID = "TMONE_TTE_SENDER_001";
static constexpr const char* RECEIVER_ID = "TMONE_TTE_RECEIVER_001";

// Mientras no existe enlace el sender permanece exclusivamente en LoRa y
// publica solicitudes de enlace. El timeout supera la ventana RED/GAO de 45 s
// para que esa pausa planificada no se interprete como una desconexion.
static constexpr uint32_t PAIR_SEARCH_INTERVAL_MS = 1000UL;
static constexpr uint32_t PAIR_HEARTBEAT_INTERVAL_MS = 5000UL;
static constexpr uint32_t PAIR_LINK_TIMEOUT_MS = 65000UL;
// Arranque en frio: da tiempo a que las fuentes de 5 V/3.3 V y los
// perifericos terminen de estabilizarse sin depender de que exista USB.
static constexpr uint32_t POWER_ON_SETTLE_MS = 2500UL;
// Si LoRa o Ethernet no respondieron durante setup, el firmware vuelve a
// intentar inicializarlos sin necesitar un reset manual.
static constexpr uint32_t PERIPHERAL_RECOVERY_MS = 10000UL;
static constexpr uint32_t FREQUENCY_HZ = 433000000UL;
static constexpr const char* FREQUENCY_LABEL = "433.000 MHz";

static constexpr int SCK_PIN = 40;
static constexpr int MISO_PIN = 42;
static constexpr int MOSI_PIN = 41;
static constexpr int SS_PIN = 38;
static constexpr int RST_PIN = 48;
static constexpr int DIO0_PIN = 5;

static constexpr int SPREADING_FACTOR = 7;
static constexpr long BANDWIDTH_HZ = 125E3;
static constexpr int CODING_RATE_DENOMINATOR = 5;
static constexpr uint8_t SYNC_WORD = 0x12;
static constexpr int TX_POWER_DBM = 14;
static constexpr uint32_t SPI_FREQUENCY_HZ = 2000000UL;
// Separacion entre inicializaciones de perifericos; no se usa entre lecturas
// SPI normales, donde el aislamiento se realiza con CS y microsegundos.
static constexpr uint32_t INIT_SETTLE_MS = 120;
static constexpr uint32_t SHARED_SPI_GUARD_US = 2;
}
