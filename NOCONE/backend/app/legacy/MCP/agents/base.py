from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List, Callable
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

def to_datetime(val):
    if isinstance(val, str):
        return datetime.fromisoformat(val)
    return val

class Agent(ABC):
    def __init__(
        self,
        db: Session,
        start_date: Optional[datetime],
        end_date: Optional[datetime],
        zone: Optional[str] = None,
        functions: Optional[List[str]] = None,
        params: Optional[Dict[str, Any]] = None
    ):
        self.db = db

        now = datetime.utcnow()
        default_start = now - timedelta(days=90)   # ~últimos 3 meses
        default_end = now

        self.start_date = to_datetime(start_date) or default_start
        self.end_date = to_datetime(end_date) or default_end

        # (opcional) asegurar orden si alguien pasa fechas invertidas
        if self.start_date > self.end_date:
            self.start_date, self.end_date = self.end_date, self.start_date

        # Normaliza zonas como lista
        if isinstance(zone, str):
            self.zone = [z.strip() for z in zone.split(",")]
        elif isinstance(zone, list):
            self.zone = zone
        else:
            self.zone = []

        self.functions = functions or []
        self.params = params or {}

    @property
    def agent_id(self) -> str:
        return self.__class__.__name__

    def run(self) -> Dict[str, Any]:
        result = {
            "agent": self.agent_id,
            "tables": []
        }

        for func_name in self.functions:
            method: Callable = getattr(self, func_name, None)
            if not callable(method):
                print(f"[WARN] Función '{func_name}' no existe en el agente '{self.agent_id}'")
                continue

            try:
                print(f"[DEBUG] Ejecutando función '{func_name}' en agente '{self.agent_id}'")
                output = method()
                if isinstance(output, dict) and "title" in output and "table" in output:
                    result["tables"].append(output)
            except Exception as e:
                print(f"[WARN] Función '{func_name}' falló en '{self.agent_id}': {e}")
                continue

        return result