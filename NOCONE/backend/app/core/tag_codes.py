import base64
import binascii
import re
from typing import Optional

_NON_HEX_RE = re.compile(r"[^0-9A-Fa-f]")
_HEX_ONLY_RE = re.compile(r"^[0-9A-Fa-f]+$")
_HEX_WITH_SEPARATORS_RE = re.compile(r"^[0-9A-Fa-f:\-.\s]+$")
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=_-]+$")


def normalize_tag_code(raw: Optional[str]) -> str:
    """Normalize BLE/RFID hardware identifiers to uppercase hex.

    Supported inputs:
    - plain hex EPC/TID/MAC
    - hex with separators such as ``80:ec:cc:ce:ed:1b``
    - Base64 / URL-safe Base64 EPCs emitted by Impinj webhook payloads
    """
    if raw is None:
        return ""

    value = str(raw).strip()
    if not value:
        return ""

    if _HEX_ONLY_RE.fullmatch(value) and len(value) % 2 == 0:
        return value.upper()

    stripped_hex = _NON_HEX_RE.sub("", value)
    if stripped_hex and len(stripped_hex) % 2 == 0 and _HEX_WITH_SEPARATORS_RE.fullmatch(value):
        return stripped_hex.upper()

    if len(value) >= 16 and len(value) % 4 == 0 and _BASE64_RE.fullmatch(value):
        padded = value + ("=" * (-len(value) % 4))
        try:
            decoded = base64.b64decode(padded, validate=True)
        except binascii.Error:
            try:
                decoded = base64.urlsafe_b64decode(padded)
            except Exception:
                decoded = b""
        except Exception:
            decoded = b""

        if decoded:
            return decoded.hex().upper()

    return stripped_hex.upper() if stripped_hex else value.upper()
