from pydantic import BaseModel
from typing import Dict, Any

class UserMessage(BaseModel):
    message: str

class RoutedContext:
    operation: str
    parameters: Dict[str, Any]