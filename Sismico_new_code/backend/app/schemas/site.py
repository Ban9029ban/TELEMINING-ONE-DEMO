from pydantic import BaseModel

class SiteOut(BaseModel):
    id: int
    code: str
    name: str

    class Config:
        from_attributes = True
