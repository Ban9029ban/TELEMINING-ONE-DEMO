from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AgentFaqItem(BaseModel):
    id: str
    category_id: str
    question: str
    description: Optional[str] = None


class AgentFaqCategory(BaseModel):
    id: str
    label: str
    description: Optional[str] = None
    items: List[AgentFaqItem] = Field(default_factory=list)


class AgentFaqsResponse(BaseModel):
    categories: List[AgentFaqCategory] = Field(default_factory=list)
    faqs: List[AgentFaqItem] = Field(default_factory=list)


class AgentInputOption(BaseModel):
    field: str
    value: str
    label: str


class AgentAskRequest(BaseModel):
    question: str = ""
    faq_id: Optional[str] = None
    site_code: Optional[str] = None
    mode: str = "auto"
    history: List[str] = Field(default_factory=list)


class AgentTableColumn(BaseModel):
    key: str
    label: str


class AgentTableArtifact(BaseModel):
    key: str
    title: str
    subtitle: Optional[str] = None
    columns: List[AgentTableColumn] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)


class AgentChartArtifact(BaseModel):
    key: str
    title: str
    subtitle: Optional[str] = None
    type: str = "line"
    has_data: bool = False
    empty_message: Optional[str] = None
    categories: List[str] = Field(default_factory=list)
    series: List[Dict[str, Any]] = Field(default_factory=list)
    items: List[Dict[str, Any]] = Field(default_factory=list)
    points: List[Dict[str, Any]] = Field(default_factory=list)
    segments: List[Dict[str, Any]] = Field(default_factory=list)
    x_label: Optional[str] = None
    y_label: Optional[str] = None


class AgentAskResponse(BaseModel):
    question: str
    answer: str
    faq_id: Optional[str] = None
    category_id: Optional[str] = None
    intent: str
    site_code: Optional[str] = None
    source: str = "database"
    mode: str = "guided"
    used_llm: bool = False
    model: Optional[str] = None
    read_only: bool = True
    blocked: bool = False
    safety_reason: Optional[str] = None
    needs_input: bool = False
    follow_up_question: Optional[str] = None
    missing_fields: List[str] = Field(default_factory=list)
    input_options: List[AgentInputOption] = Field(default_factory=list)
    generated_at: datetime
    charts: List[AgentChartArtifact] = Field(default_factory=list)
    tables: List[AgentTableArtifact] = Field(default_factory=list)
    suggestions: List[AgentFaqItem] = Field(default_factory=list)


class AgentStatusResponse(BaseModel):
    enabled: bool
    ollama_enabled: bool
    ollama_reachable: bool
    fast_model: Optional[str] = None
    chat_model: Optional[str] = None
    loaded_models: List[str] = Field(default_factory=list)
    interactive_supported: bool = True
    error: Optional[str] = None
