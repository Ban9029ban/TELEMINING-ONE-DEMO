from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

import requests


@dataclass
class FetchResult:
    ok: bool
    status_code: Optional[int]
    body_text: str
    content_type: str
    error_message: Optional[str] = None
    source_origin: str = "external"


class HttpFetcher:
    def fetch(
        self,
        url: str,
        *,
        method: str = "GET",
        timeout_seconds: int = 8,
        headers: Optional[Dict[str, str]] = None,
        verify_ssl: bool = False,
    ) -> FetchResult:
        if (url or "").startswith("file://"):
            return self._fetch_file_url(url)
        try:
            response = requests.request(
                method=method.upper(),
                url=url,
                headers=headers or {},
                timeout=timeout_seconds,
                verify=verify_ssl,
            )
            return FetchResult(
                ok=response.ok,
                status_code=response.status_code,
                body_text=response.text,
                content_type=response.headers.get("content-type", ""),
                error_message=None if response.ok else f"HTTP {response.status_code}",
                source_origin="external",
            )
        except Exception as exc:
            return FetchResult(
                ok=False,
                status_code=None,
                body_text="",
                content_type="",
                error_message=str(exc),
                source_origin="external",
            )

    def fetch_file(self, path: str | Path) -> FetchResult:
        file_path = Path(path)
        try:
            raw = file_path.read_bytes()
            content_type = mimetypes.guess_type(file_path.name)[0] or "text/html; charset=utf-8"
            try:
                body_text = raw.decode("utf-8")
            except UnicodeDecodeError:
                body_text = raw.decode("latin-1", errors="replace")
            return FetchResult(
                ok=True,
                status_code=200,
                body_text=body_text,
                content_type=content_type,
                error_message=None,
                source_origin="fixture",
            )
        except Exception as exc:
            return FetchResult(
                ok=False,
                status_code=None,
                body_text="",
                content_type="",
                error_message=str(exc),
                source_origin="fixture",
            )

    def _fetch_file_url(self, url: str) -> FetchResult:
        return self.fetch_file(url.replace("file://", "", 1))
