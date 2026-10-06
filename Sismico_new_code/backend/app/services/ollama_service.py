from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests

from app.core.settings import settings


@dataclass
class OllamaGenerationResult:
    ok: bool
    content: str
    model: Optional[str] = None
    error: Optional[str] = None


class OllamaService:
    def __init__(self) -> None:
        self.base_url = settings.OLLAMA_URL.rstrip("/")
        self.timeout_seconds = max(int(settings.OLLAMA_TIMEOUT_SECONDS or 20), 5)

    def is_enabled(self) -> bool:
        return bool(settings.ollama_enabled and self.base_url)

    def get_status(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "enabled": self.is_enabled(),
            "url": self.base_url,
            "fastModel": settings.ollama_fast_model or None,
            "chatModel": settings.ollama_chat_model or None,
            "reachable": False,
            "models": [],
            "error": None,
        }
        if not data["enabled"]:
            data["error"] = "Ollama deshabilitado por configuracion."
            return data
        if not (settings.ollama_fast_model or settings.ollama_chat_model):
            data["error"] = "No hay modelos configurados para Ollama."
            return data
        try:
            response = requests.get(f"{self.base_url}/api/tags", timeout=self.timeout_seconds)
            response.raise_for_status()
            payload = response.json() if response.content else {}
            models = []
            for item in payload.get("models", []):
                name = (item or {}).get("name")
                if name:
                    models.append(name)
            data["reachable"] = True
            data["models"] = models
            return data
        except Exception as exc:
            data["error"] = str(exc)
            return data

    def generate(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        mode: str = "fast",
    ) -> OllamaGenerationResult:
        if not self.is_enabled():
            return OllamaGenerationResult(ok=False, content="", error="Ollama deshabilitado.")

        selected_mode = (mode or "fast").strip().lower()
        model = settings.ollama_fast_model if selected_mode == "fast" else settings.ollama_chat_model
        if not model:
            model = settings.ollama_chat_model or settings.ollama_fast_model
        if not model:
            return OllamaGenerationResult(ok=False, content="", error="No hay modelo configurado para Ollama.")

        body = {
            "model": model,
            "stream": False,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "options": {
                "temperature": 0.2 if selected_mode == "fast" else 0.4,
                "num_predict": max(int(settings.OLLAMA_NUM_PREDICT or 220), 64),
            },
        }
        try:
            response = requests.post(
                f"{self.base_url}/api/chat",
                json=body,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json() if response.content else {}
            content = ((payload.get("message") or {}).get("content") or "").strip()
            if not content:
                return OllamaGenerationResult(ok=False, content="", model=model, error="Ollama no devolvio contenido.")
            return OllamaGenerationResult(ok=True, content=content, model=model)
        except Exception as exc:
            return OllamaGenerationResult(ok=False, content="", model=model, error=str(exc))
