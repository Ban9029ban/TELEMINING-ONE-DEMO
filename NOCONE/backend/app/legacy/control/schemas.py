from pydantic import BaseModel

class MapaCreate(BaseModel):
    name: str
    proyecto: str
    file: str = None 

class MapaDelete(BaseModel):
    name: str
    proyecto: str