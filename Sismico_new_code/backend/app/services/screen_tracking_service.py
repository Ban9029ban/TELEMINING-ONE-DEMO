import re
import socket
import subprocess
from typing import Optional

MAC_REGEX = re.compile(r"(?i)\b([0-9a-f]{2}[:-]){5}([0-9a-f]{2})\b")


def _run_command(cmd: list[str], timeout: int = 3) -> str:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    except Exception:
        return ""



def _normalize_ip(ip: Optional[str]) -> Optional[str]:
    if not ip:
        return None
    ip = str(ip).strip()
    if ip.startswith("::ffff:"):
        ip = ip.replace("::ffff:", "")
    if ip in {"127.0.0.1", "::1", "localhost", "0.0.0.0", ""}:
        return None
    return ip



def _extract_mac(text: str) -> Optional[str]:
    if not text:
        return None
    match = MAC_REGEX.search(text)
    if not match:
        return None
    return match.group(0).replace("-", ":").lower()



def get_mac_from_ip(ip: Optional[str]) -> str:
    """
    Intenta resolver la MAC a partir de la IP.
    Devuelve 'unknown' cuando no se puede determinar.
    """
    ip = _normalize_ip(ip)
    if not ip:
        return "unknown"

    # Linux moderno
    output = _run_command(["ip", "neigh", "show", ip])
    mac = _extract_mac(output)
    if mac:
        return mac

    # Fallback clásico arp
    output = _run_command(["arp", "-n", ip])
    mac = _extract_mac(output)
    if mac:
        return mac

    return "unknown"



def get_device_name_from_ip(ip: Optional[str]) -> str:
    """
    Intenta resolver nombre del equipo mediante reverse DNS.
    Devuelve 'unknown' si no se puede resolver.
    """
    ip = _normalize_ip(ip)
    if not ip:
        return "unknown"

    try:
        host, _, _ = socket.gethostbyaddr(ip)
        if host:
            return host
    except Exception:
        pass

    return "unknown"



def build_device_fingerprint(
    ip: Optional[str],
    user_agent: Optional[str] = None,
    hostname: Optional[str] = None,
    screen_code: Optional[str] = None,
) -> str:
    parts = [
        str(ip or ""),
        str(user_agent or ""),
        str(hostname or ""),
        str(screen_code or ""),
    ]
    return "|".join(parts)



def detect_device_identity(
    ip: Optional[str],
    user_agent: Optional[str] = None,
    screen_code: Optional[str] = None,
) -> dict:
    hostname = get_device_name_from_ip(ip)
    mac = get_mac_from_ip(ip)
    fingerprint = build_device_fingerprint(
        ip=ip,
        user_agent=user_agent,
        hostname=hostname,
        screen_code=screen_code,
    )
    return {
        "ip_address": _normalize_ip(ip),
        "mac_address": mac,
        "device_name": hostname,
        "fingerprint": fingerprint,
    }
