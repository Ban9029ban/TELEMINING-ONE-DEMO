from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.schemas.agent import AgentAskRequest, AgentAskResponse, AgentFaqsResponse, AgentStatusResponse
from app.services.agent_service import AgentService

router = APIRouter()


@router.get("/faqs", response_model=AgentFaqsResponse)
def faqs(db: Session = Depends(get_db)):
    return AgentService(db).list_faqs()


@router.post("/ask", response_model=AgentAskResponse)
def ask(payload: AgentAskRequest, db: Session = Depends(get_db)):
    return AgentService(db).ask(payload)


@router.get("/status", response_model=AgentStatusResponse)
def status(db: Session = Depends(get_db)):
    return AgentService(db).get_status()
