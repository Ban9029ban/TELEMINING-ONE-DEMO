TMONE / Telemining 2026 - Código base placa nueva
==================================================

Archivos incluidos:

1) TMONE_Telemining2026_sender_moduladores.ino
   Modos disponibles:
   - MODE_SENDER_BLE_LORA
   - MODE_MODULADOR_SENSORES
   - MODE_MODULADOR_RFID_LORA_SENDER

2) TMONE_Telemining2026_receiver.ino
   Modos disponibles:
   - MODE_RECEIVER_LORA_TCP
   - MODE_MODULADOR_RFID_LORA_RECEIVER

Hardware confirmado por fabricante:
- MCU/base: ESP32-S3 LilyGO A7608-ESP32S3 sobre carrier Telemining 2026.
- LoRa: SX1278 SPI 433 MHz.
- Ethernet: ENC28J60-I/SO.
- ADC: ADS1115IDGST, direccion I2C 0x48, 16 bits, alimentado a 5 V, I2C con level shifting BSS123.
- MicroSD: bus SPI independiente.

Pinout principal:
- SPI compartido LoRa/Ethernet:
  - MISO: GPIO42
  - MOSI: GPIO41
  - SCK : GPIO40

- LoRa SX1278:
  - DIO0 : GPIO5
  - RESET: GPIO48
  - CS   : GPIO38
  - Frecuencia: 433 MHz

- Ethernet ENC28J60:
  - INT  : GPIO10
  - RESET: GPIO8
  - CS   : GPIO39

- I2C ADS1115:
  - SDA: GPIO11
  - SCL: GPIO12
  - ADDR: 0x48

- MicroSD:
  - MISO: GPIO47
  - MOSI: GPIO14
  - SCLK: GPIO21
  - CS  : GPIO13

- LED estado:
  - GPIO9

Librerias Arduino requeridas:
- LoRa
- EthernetENC
- Adafruit ADS1X15
- SD
- BLE Arduino ESP32
- WiFi

Parametros principales a editar en cada .ino:
- DEVICE_MODE
- TCP_TRANSPORT
- DEST_HOST
- DEST_PORT
- ETH_STATIC_IP
- WIFI_SSID
- WIFI_PASS
- PORTICO_ID
- BACKBONE_ID
- EDGE_KIND

Uso de transporte:
- Si TCP_TRANSPORT = NET_ETHERNET, se usa ENC28J60 y no se usa WiFi para TCP.
- Si TCP_TRANSPORT = NET_WIFI, se usa WiFi y no Ethernet.

Codigos LED definidos:
Sender/moduladores:
- 1 pulso corto : boot
- 2 pulsos cortos: OK
- 1 pulso largo : TX LoRa
- 2 cortos + 1 largo: red/TCP OK
- 3 pulsos cortos: error red/TCP
- 4 pulsos cortos: error LoRa
- 5 pulsos cortos: error MicroSD
- 6 pulsos cortos: error sensores/ADS1115

Receiver:
- 1 pulso corto : boot
- 2 pulsos cortos: OK
- 1 pulso largo : RX LoRa
- 2 cortos + 1 largo: red/TCP OK
- 3 pulsos cortos: error red/TCP
- 4 pulsos cortos: error LoRa
- 5 pulsos cortos: error MicroSD
- 6 pulsos cortos: cola llena

Notas de integracion:
- LoRa y Ethernet comparten bus SPI; cada dispositivo tiene su CS independiente.
- MicroSD usa bus SPI independiente.
- A1 es 4-20 mA via ADS1115 AIN0 con resistencia shunt indicada de 249 ohm.
- A4 es 0-10 V via divisor esperado 100k/100k hacia ADS1115 AIN3.
- A2/A3 quedan como entradas ADC en voltaje directo o segun acondicionamiento final de placa.

Estado:
- Código base generado para porting y pruebas de integración.
- Requiere validacion en hardware real y ajuste fino de IP, modo y credenciales.
