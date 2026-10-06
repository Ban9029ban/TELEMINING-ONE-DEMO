from datetime import datetime
from app.legacy.telemining.database import get_db
from typing import Dict, Any, Optional, List
from fastapi import Depends
from sqlalchemy.orm import Session

from app.legacy.MCP.agents.types.agent_localization import LocalizationAgent
from app.legacy.MCP.agents.types.agent_front_activities import FrontActivitiesAgent
from app.legacy.MCP.agents.types.agent_risk_exposition import RiskExpositionAgent
from app.legacy.MCP.agents.types.agent_movement_analysis import MovementAnalysisAgent

class AgentFactory:
    registry = {
        "localization": LocalizationAgent,
        "front_activities": FrontActivitiesAgent,
        "risk_exposition": RiskExpositionAgent,
        "movement_analysis": MovementAnalysisAgent
    }

    @staticmethod
    def create_agent(
        agent_type: str,
        db: Session,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        zone: Optional[str] = None,
        functions: Optional[List[str]] = None,
        params: Optional[Dict[str, Any]] = None
    ):
        if agent_type not in AgentFactory.registry:
            raise ValueError(f"Agente '{agent_type}' no está registrado en la fábrica.")
        
        AgentClass = AgentFactory.registry[agent_type]
        
        print(f"[DEBUG] Creando instancia del agente '{agent_type}' con funciones: {functions}")

        return AgentClass(
            db=db,
            start_date=start_date,
            end_date=end_date,
            zone=zone,
            functions=functions or [],
            params=params or {}
        )