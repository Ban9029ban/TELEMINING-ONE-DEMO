from fastapi import APIRouter

router = APIRouter()

@router.get("/list")
def list_zones():
    return {
        "zones": [
            "Andes Norte",
            "Andesita",
            "Diamante",
            "Esmeralda",
            "Dacita",
            "Diablo Regimiento",
            "Recursos Norte",
            "Pacífico Superior",
            "TTE4 Sur",
            "Reservas Norte",
            "Pilar Norte",
            "Corbata",
        ]
    }
