"""Backward-compatible config shim.

Historically some modules imported ``app.config.settings``.
The canonical settings now live in ``app.core.config``.
"""

from app.core.config import Settings, settings

__all__ = ["Settings", "settings"]
