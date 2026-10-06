#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
urt_bridge.py
- Listener TCP local en Raspberry para recibir tramas ZENIT desde la URT-CENTRAL (ESP32-S3)
- Reenvía cada trama al Listener Central (IP/puerto configurados)
"""

import socket
import socketserver
import threading
from datetime import datetime

# ===========================
# CONFIGURACIÓN
# ===========================

LOCAL_HOST   = "0.0.0.0"
LOCAL_PORT   = 7070          # Debe coincidir con PI_PORT en el ESP32

CENTRAL_HOST = "192.168.100.50"  # <-- IP del listener central
CENTRAL_PORT = 7070              # <-- puerto del listener central

LOG_FILE     = "urt_bridge.log"  # archivo de log local


# ===========================
# FUNCIONES AUXILIARES
# ===========================

def log_line(tag, msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{tag}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"[LOG-ERR] No se pudo escribir log: {e}")


def forward_to_central(frame: str):
    """
    Envía la trama al Listener Central (TCP).
    """
    try:
        with socket.create_connection((CENTRAL_HOST, CENTRAL_PORT), timeout=3) as s:
            s.sendall((frame + "\n").encode("utf-8"))
        log_line("FWD", f"Trama reenviada a {CENTRAL_HOST}:{CENTRAL_PORT}")
    except Exception as e:
        log_line("FWD-ERR", f"No se pudo reenviar al central: {e}")


# ===========================
# HANDLER TCP
# ===========================

class URTRequestHandler(socketserver.StreamRequestHandler):
    """
    Maneja una conexión TCP desde el ESP32.
    Lee líneas (\n) y las reenvía al Listener Central.
    """

    def handle(self):
        client_ip, client_port = self.client_address
        log_line("CONN", f"Conexión desde {client_ip}:{client_port}")

        try:
            for raw in self.rfile:
                line = raw.decode("utf-8", errors="ignore").strip()
                if not line:
                    continue
                log_line("RX", f"Trama recibida: {line}")
                forward_to_central(line)
        except Exception as e:
            log_line("CONN-ERR", f"Error en conexión: {e}")
        finally:
            log_line("CONN", f"Conexión cerrada desde {client_ip}:{client_port}")


# ===========================
# SERVIDOR PRINCIPAL
# ===========================

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    server = ThreadedTCPServer((LOCAL_HOST, LOCAL_PORT), URTRequestHandler)
    log_line("MAIN", f"URT Bridge escuchando en {LOCAL_HOST}:{LOCAL_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log_line("MAIN", "Interrupción por teclado, cerrando servidor...")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
