from pydantic import BaseModel

class ScreenOut(BaseModel):
    id: int
    code: str
    name: str
    status_code: str

    class Config:
        from_attributes = True
