from pydantic import BaseModel

class AlertOut(BaseModel):
    id: int
    title: str
    severity: str
    status: str

    class Config:
        from_attributes = True
