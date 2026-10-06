from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.schemas.agent import AgentAskRequest, AgentAskResponse, AgentFaqsResponse
from app.services.agent_service import AgentService

router = APIRouter()


@router.get("/faqs", response_model=AgentFaqsResponse)
def faqs(db: Session = Depends(get_db)):
    return AgentService(db).list_faqs()


@router.post("/consult", response_model=AgentAskResponse)
def consult(payload: AgentAskRequest, db: Session = Depends(get_db)):
    return AgentService(db).ask(payload)
