TMONE / Telemining 2026 - ZENIT v7 corregido para placa nueva

Archivos:
- ZENIT_portico_v7_prod_sender.ino
- ZENIT_portico_v7_prod_receiver.ino

Cambios aplicados:
1) LoRa SX1278 433 MHz:
   - Frecuencia: 433000000 Hz
   - SCK: GPIO40
   - MISO: GPIO42
   - MOSI: GPIO41
   - CS/NSS: GPIO38
   - RESET: GPIO48
   - DIO0: GPIO5

2) Ethernet ENC28J60-I/SO:
   - CS: GPIO39
   - RESET: GPIO8
   - INT: GPIO10
   - Comparte SPI con LoRa: SCK GPIO40, MISO GPIO42, MOSI GPIO41.

3) MicroSD en SPI dedicado:
   - MISO: GPIO47
   - MOSI: GPIO14
   - SCLK: GPIO21
   - CS: GPIO13
   - Se inicializa con SPIClass dedicado y SD.begin(CS, spi, 10000000).

4) ADC externo ADS1115:
   - I2C SDA: GPIO11
   - I2C SCL: GPIO12
   - Address: 0x48
   - Libreria: Adafruit ADS1X15
   - Canales: A1=A0, A2=A1, A3=A2, A4=A3.
   - GAIN_TWOTHIRDS para rango hasta +/-6.144V.

Librerias necesarias en Arduino IDE:
- ESP32 by Espressif Systems
- LoRa by Sandeep Mistry
- EthernetENC
- Adafruit ADS1X15
- Adafruit BusIO

Configuracion recomendada Arduino IDE:
- Board: ESP32S3 Dev Module
- USB CDC On Boot: Enabled
- Upload Mode: UART0 / Hardware CDC
- CPU Frequency: 240MHz
- Upload Speed: 460800 o 115200 si falla
- PSRAM: Enabled si aparece disponible

Notas:
- ENABLE_SENSOR_READ esta en false por defecto. Si quieres transmitir lecturas ADS1115, poner true.
- Red recomendada en terreno: mismo segmento 192.168.100.x que la antena GAO.
- Fallback Ethernet sender: 192.168.100.51/24 gateway 192.168.100.1.
- En este firmware quedo forzado en IP estatica, sin DHCP.
- Sender escucha TCP por Ethernet en puerto 7071 y tambien acepta webhook HTTP estilo GAO/Impinj en ese mismo puerto.
- Cuando recibe un webhook RFID, lo compacta a una trama `RFID|...` y la envia por LoRa sin depender del listener Python local.
- Receiver recibe LoRa y reenvia por TCP al servidor DEST_HOST:DEST_PORT.
- El listener del servidor debe aceptar la trama compacta `RFID|...` ademas de BLE/LoRa clasico.
- Validar antena LoRa de 433 MHz antes de transmitir.
