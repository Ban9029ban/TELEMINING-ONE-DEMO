#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# =============================================================================
# MODO DESARROLLADOR / NOTAS DE USO (OT)
# =============================================================================
#
# Este script está pensado para pruebas controladas de lectura/escritura de tags
# (Mxx) contra un PLC vía red (HMI/Servidor como "cliente", PLC como "target").
#
# ⚠️ IMPORTANTE:
# - "M1", "M2", ... NO significan lo mismo en todos los PLC/protocolos.
# - Para que funcione en terreno, debes definir el "mapeo real" de Mxx
#   (a coil/register/DB-bit/tag/NodeId) según la marca/modelo y configuración.
#
# -----------------------------------------------------------------------------
# Ejemplos de uso
# -----------------------------------------------------------------------------
# 1) Listar catálogo de señales (tu mapeo Mxx)
#    python plcctl.py --ip 192.168.1.10 --type delta --list
#
# 2) Escribir un estado (ej. M1=1)
#    python plcctl.py --ip 192.168.1.10 --type delta --write M1=1
#
# 3) Leer un estado
#    python plcctl.py --ip 192.168.1.10 --type delta --read M1
#
# 4) Pulso (para botones momentáneos)
#    python plcctl.py --ip 192.168.1.10 --type delta --pulse M2 --ms 300
#
# -----------------------------------------------------------------------------
# Lo que falta para que sea “real” (y no un ejemplo)
# -----------------------------------------------------------------------------
# Para que esto controle tu sistema de verdad, necesitas definir el mapeo real:
#
# - Si es Modbus TCP: ¿qué coil/register corresponde a M1..M10?
# - Si es Siemens S7: ¿son M1.0 o están en DB/bit distinto?
# - Si es EtherNet/IP: ¿existen tags simbólicos M1, M2, etc.?
# - Si es OPC UA: ¿cuáles son los NodeId de cada señal?
#
# ✅ Esa información normalmente está en:
# - Configuración del driver del HMI (tipo de PLC + addressing)
# - Proyecto PLC/HMI
# - Pantallazo de “Communications” / “Device settings” del HMI
#
# -----------------------------------------------------------------------------
# Recomendación OT mínima (para no dejar el tablero en un estado inseguro)
# -----------------------------------------------------------------------------
# - NO uses: --write M0=1 en pruebas sin un procedimiento (M0 es emergencia).
# - Si vas a automatizar: usa --pulse y/o handshake (ACK) cuando implementen bits
#   dedicados para comando remoto.
#
# =============================================================================

import argparse
import sys
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

# =========================
# Catálogo funcional Mxx
# =========================
M_CATALOG = {
    "M0":  "ESTADO DE EMERGENCIA (parpadeo rojas)",
    "M1":  "Relé 1 - Luz verde (normal) polígono Pipa",
    "M2":  "Relé 2 - Luz roja (alerta) polígono Pipa",
    "M3":  "Relé 3 - Luz verde (normal) polígono Diamante FW",
    "M4":  "Relé 4 - Luz roja (alerta) polígono Diamante FW",
    "M5":  "Relé 5 - Luz verde (normal) polígono Diamante HW",
    "M6":  "Relé 6 - Luz roja (alerta) polígono Diamante HW",
    "M7":  "Relé 7 - Luz roja (inferior) polígono bajo Diamante Esmeralda",
    "M8":  "Relé 8 - Luz verde (centro) polígono bajo Diamante Esmeralda",
    "M9":  "Relé 9 - Luz roja (superior) polígono bajo Diamante Esmeralda",
    "M10": "Relé 13 - Detección alimentación externa tablero",
}

# =========================
# Modelo de mapeo
# =========================
@dataclass(frozen=True)
class TagMapEntry:
    """
    Representa cómo se direcciona un Mxx en el protocolo real.
    - Para Modbus: kind="coil" o "di" o "hr" o "ir", addr=int
    - Para Siemens S7: kind="s7_m", addr=(byte, bit)  e.g., (1,0) para M1.0
    - Para otros: se extenderá
    """
    kind: str
    addr: object


# =========================
# Drivers base
# =========================
class PLCDriver:
    def connect(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

    def read_bool(self, entry: TagMapEntry) -> bool:
        raise NotImplementedError

    def write_bool(self, entry: TagMapEntry, value: bool) -> None:
        raise NotImplementedError


# =========================
# Driver: Modbus TCP
# =========================
class ModbusTCPDriver(PLCDriver):
    def __init__(self, ip: str, port: int = 502, unit_id: int = 1, timeout_s: float = 2.0):
        self.ip = ip
        self.port = port
        self.unit_id = unit_id
        self.timeout_s = timeout_s
        self._client = None

    def connect(self) -> None:
        try:
            from pymodbus.client import ModbusTcpClient
        except ImportError as e:
            raise RuntimeError("Falta pymodbus. Instala: pip install pymodbus") from e

        self._client = ModbusTcpClient(host=self.ip, port=self.port, timeout=self.timeout_s)
        if not self._client.connect():
            raise RuntimeError(f"No se pudo conectar a Modbus TCP {self.ip}:{self.port}")

    def close(self) -> None:
        if self._client:
            self._client.close()

    def read_bool(self, entry: TagMapEntry) -> bool:
        if entry.kind != "coil":
            raise ValueError(f"ModbusTCPDriver solo implementa 'coil' (por ahora). Recibido: {entry.kind}")

        # Modbus coils: dirección base 0 en librerías; tu mapeo debe ser consistente.
        addr = int(entry.addr)
        rr = self._client.read_coils(addr, count=1, slave=self.unit_id)
        if rr.isError():
            raise RuntimeError(f"Error leyendo coil @{addr}: {rr}")
        return bool(rr.bits[0])

    def write_bool(self, entry: TagMapEntry, value: bool) -> None:
        if entry.kind != "coil":
            raise ValueError(f"ModbusTCPDriver solo implementa 'coil' (por ahora). Recibido: {entry.kind}")

        addr = int(entry.addr)
        rr = self._client.write_coil(addr, value=bool(value), slave=self.unit_id)
        if rr.isError():
            raise RuntimeError(f"Error escribiendo coil @{addr}={value}: {rr}")


# =========================
# Driver: Siemens S7 (snap7)
# =========================
class SiemensS7Driver(PLCDriver):
    def __init__(self, ip: str, rack: int = 0, slot: int = 1, tcp_port: int = 102):
        self.ip = ip
        self.rack = rack
        self.slot = slot
        self.tcp_port = tcp_port
        self._client = None

    def connect(self) -> None:
        try:
            import snap7
        except ImportError as e:
            raise RuntimeError("Falta python-snap7. Instala: pip install python-snap7") from e

        self._client = snap7.client.Client()
        # snap7 usa rack/slot; puerto 102 es estándar pero depende del runtime/PLC.
        self._client.connect(self.ip, self.rack, self.slot, self.tcp_port)
        if not self._client.get_connected():
            raise RuntimeError(f"No se pudo conectar a Siemens S7 {self.ip} rack={self.rack} slot={self.slot}")

    def close(self) -> None:
        if self._client:
            self._client.disconnect()

    def read_bool(self, entry: TagMapEntry) -> bool:
        if entry.kind != "s7_m":
            raise ValueError(f"SiemensS7Driver espera kind='s7_m'. Recibido: {entry.kind}")

        byte, bit = entry.addr  # e.g. (1,0) => M1.0
        data = self._client.read_area(0x83, 0, int(byte), 1)  # 0x83 = Merkers (M)
        b = data[0]
        return bool((b >> int(bit)) & 1)

    def write_bool(self, entry: TagMapEntry, value: bool) -> None:
        if entry.kind != "s7_m":
            raise ValueError(f"SiemensS7Driver espera kind='s7_m'. Recibido: {entry.kind}")

        byte, bit = entry.addr
        data = bytearray(self._client.read_area(0x83, 0, int(byte), 1))
        mask = 1 << int(bit)
        if value:
            data[0] |= mask
        else:
            data[0] &= (~mask & 0xFF)
        self._client.write_area(0x83, 0, int(byte), data)


# =========================
# Placeholders: EtherNet/IP / OPC UA (a implementar cuando se confirme)
# =========================
class NotImplementedDriver(PLCDriver):
    def __init__(self, msg: str):
        self.msg = msg

    def connect(self) -> None:
        raise RuntimeError(self.msg)

    def close(self) -> None:
        return

    def read_bool(self, entry: TagMapEntry) -> bool:
        raise RuntimeError(self.msg)

    def write_bool(self, entry: TagMapEntry, value: bool) -> None:
        raise RuntimeError(self.msg)


# =========================
# Perfiles de mapeo (EJEMPLOS)
# =========================
def build_tagmap(profile: str) -> Dict[str, TagMapEntry]:
    """
    IMPORTANTE:
    - Estos mapeos son EJEMPLOS.
    - Debes completar con el mapeo real del proyecto PLC.
    """
    profile = profile.lower()

    if profile in ("modbus_tcp", "delta"):
        # Delta DVP (mapeo Modbus típico):
        #   X0..  -> coils desde 1024
        #   Y0..  -> coils desde 1280
        #   M0..  -> coils desde 2048
        #
        # Nota: puede variar por modelo/config. Si queda corrido por 1, ajusta base-1.
        M_BASE = 2048
        Y_BASE = 1280

        tagmap = {
            # M internos (los que te interesan)
            "M0":  TagMapEntry(kind="coil", addr=M_BASE + 0),
            "M1":  TagMapEntry(kind="coil", addr=M_BASE + 1),
            "M2":  TagMapEntry(kind="coil", addr=M_BASE + 2),
            "M3":  TagMapEntry(kind="coil", addr=M_BASE + 3),
            "M4":  TagMapEntry(kind="coil", addr=M_BASE + 4),
            "M5":  TagMapEntry(kind="coil", addr=M_BASE + 5),
            "M6":  TagMapEntry(kind="coil", addr=M_BASE + 6),
            "M7":  TagMapEntry(kind="coil", addr=M_BASE + 7),
            "M8":  TagMapEntry(kind="coil", addr=M_BASE + 8),
            "M9":  TagMapEntry(kind="coil", addr=M_BASE + 9),
            "M10": TagMapEntry(kind="coil", addr=M_BASE + 10),

            # Salidas físicas (para test de LEDs/relés)
            "Y0": TagMapEntry(kind="coil", addr=Y_BASE + 0),
            "Y1": TagMapEntry(kind="coil", addr=Y_BASE + 1),
            "Y2": TagMapEntry(kind="coil", addr=Y_BASE + 2),
            "Y3": TagMapEntry(kind="coil", addr=Y_BASE + 3),
            "Y4": TagMapEntry(kind="coil", addr=Y_BASE + 4),
            "Y5": TagMapEntry(kind="coil", addr=Y_BASE + 5),
            "Y6": TagMapEntry(kind="coil", addr=Y_BASE + 6),
            "Y7": TagMapEntry(kind="coil", addr=Y_BASE + 7),
        }

    return tagmap

    if profile in ("siemens_s7", "s7"):
        # EJEMPLO Siemens: M1..M10 como bits M1.0..M10.0 y M0 como M0.0
        # Nota: en Siemens "M1" podría referirse a byte 1 y bit 0 => M1.0
        return {
            "M0":  TagMapEntry(kind="s7_m", addr=(0, 0)),   # M0.0
            "M1":  TagMapEntry(kind="s7_m", addr=(1, 0)),   # M1.0
            "M2":  TagMapEntry(kind="s7_m", addr=(2, 0)),   # M2.0
            "M3":  TagMapEntry(kind="s7_m", addr=(3, 0)),   # ...
            "M4":  TagMapEntry(kind="s7_m", addr=(4, 0)),
            "M5":  TagMapEntry(kind="s7_m", addr=(5, 0)),
            "M6":  TagMapEntry(kind="s7_m", addr=(6, 0)),
            "M7":  TagMapEntry(kind="s7_m", addr=(7, 0)),
            "M8":  TagMapEntry(kind="s7_m", addr=(8, 0)),
            "M9":  TagMapEntry(kind="s7_m", addr=(9, 0)),
            "M10": TagMapEntry(kind="s7_m", addr=(10, 0)),
        }

    raise ValueError(f"Perfil de mapeo no soportado: {profile}")


def build_driver(plc_type: str, ip: str, args) -> PLCDriver:
    t = plc_type.lower()

    if t in ("modbus_tcp", "delta"):
        return ModbusTCPDriver(ip=ip, port=args.port or 502, unit_id=args.unit_id, timeout_s=args.timeout)

    if t in ("siemens_s7", "s7"):
        return SiemensS7Driver(ip=ip, rack=args.rack, slot=args.slot, tcp_port=args.port or 102)

    if t in ("ethernet_ip", "eip", "rockwell"):
        return NotImplementedDriver("Driver EtherNet/IP aún no implementado en este script (requiere pylogix u otra librería).")

    if t in ("opcua", "opc_ua"):
        return NotImplementedDriver("Driver OPC UA aún no implementado en este script (requiere opcua/asyncua y NodeIds reales).")

    return NotImplementedDriver(f"Tipo PLC no soportado: {plc_type}")


# =========================
# CLI parsing
# =========================
def parse_kv(s: str) -> Tuple[str, str]:
    if "=" not in s:
        raise argparse.ArgumentTypeError("Formato inválido. Usa TAG=VAL (ej: M1=1)")
    k, v = s.split("=", 1)
    return k.strip().upper(), v.strip()


def to_bool(v: str) -> bool:
    v = v.strip().lower()
    if v in ("1", "true", "on", "yes", "y"):
        return True
    if v in ("0", "false", "off", "no", "n"):
        return False
    raise ValueError(f"Valor booleano inválido: {v}")


def main() -> int:
    p = argparse.ArgumentParser(
        description="PLC Control CLI - Escribe/lee comandos Mxx vía protocolo según tipo de PLC."
    )
    p.add_argument("--ip", required=True, help="IP del PLC (ej 192.168.1.10)")
    p.add_argument("--type", required=True, help="Tipo PLC (delta/modbus_tcp/siemens_s7/...)")
    p.add_argument("--profile", default=None, help="Perfil de mapeo (por defecto = --type)")
    p.add_argument("--port", type=int, default=None, help="Puerto TCP (si aplica)")
    p.add_argument("--timeout", type=float, default=2.0, help="Timeout segundos (Modbus)")
    p.add_argument("--unit-id", type=int, default=1, help="Modbus unit id/slave id")

    # Siemens params
    p.add_argument("--rack", type=int, default=0, help="Siemens rack")
    p.add_argument("--slot", type=int, default=1, help="Siemens slot")

    ops = p.add_mutually_exclusive_group(required=True)
    ops.add_argument("--write", type=parse_kv, help="Escribir TAG=VAL (ej M1=1)")
    ops.add_argument("--read", type=str, help="Leer TAG (ej M1)")
    ops.add_argument("--pulse", type=str, help="Pulso TAG (set 1, espera, set 0)")
    p.add_argument("--ms", type=int, default=500, help="Duración pulso (ms) para --pulse")

    p.add_argument("--list", action="store_true", help="Listar catálogo Mxx y salir (ignora operaciones)")

    args = p.parse_args()

    if args.list:
        for k in sorted(M_CATALOG.keys(), key=lambda x: (len(x), x)):
            print(f"{k:>3}  {M_CATALOG[k]}")
        return 0

    profile = (args.profile or args.type).lower()

    # Construye driver y mapeo
    driver = build_driver(args.type, args.ip, args)
    try:
        tagmap = build_tagmap(profile)
    except Exception as e:
        print(f"[ERROR] No se pudo cargar perfil '{profile}': {e}", file=sys.stderr)
        return 2

    def get_entry(tag: str) -> TagMapEntry:
        t = tag.strip().upper()
        if t not in tagmap:
            raise KeyError(f"Tag {t} no existe en profile '{profile}'. Debes mapearlo en build_tagmap().")
        return tagmap[t]

    try:
        driver.connect()

        if args.write:
            tag, val = args.write
            entry = get_entry(tag)
            bval = to_bool(val)
            driver.write_bool(entry, bval)
            print(f"OK WRITE {tag}={int(bval)}  ({M_CATALOG.get(tag, 'sin descripción')})")

        elif args.read:
            tag = args.read.strip().upper()
            entry = get_entry(tag)
            val = driver.read_bool(entry)
            print(f"OK READ  {tag}={int(val)}  ({M_CATALOG.get(tag, 'sin descripción')})")

        elif args.pulse:
            tag = args.pulse.strip().upper()
            entry = get_entry(tag)
            driver.write_bool(entry, True)
            time.sleep(max(args.ms, 10) / 1000.0)
            driver.write_bool(entry, False)
            print(f"OK PULSE {tag}  {args.ms}ms  ({M_CATALOG.get(tag, 'sin descripción')})")

        return 0

    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1
    finally:
        try:
            driver.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())