from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from app.legacy.telemining.sse import broadcast_message
from app.legacy.control.dependencies import get_topbar_user_data
from app.legacy.control.charge_tables import *
from app.legacy.control.simulator import URS,TEMPERATURA_MEDIA,TEMPERATURA_VARIANZA,CO2_MEDIA,CO2_VARIANZA,HUMEDAD_VARIANZA,HUMEDAD_MEDIA
from datetime import datetime
import random

router = APIRouter()

@router.get("/searching")
async def searching_view(active_user: dict = Depends(get_topbar_user_data)):
    return JSONResponse(content={
        "message": "Searching Placeholder",
        "active_user": active_user
    })

@router.get("/cameras")
async def camera_view():
    cameras = [
        "https://www.youtube.com/embed/ZNHH8qu-MKY",
        "https://www.youtube.com/embed/8xjhs8ZBIZo",
        "https://www.youtube.com/embed/Bvji0eKnuXk",
        "https://www.youtube.com/embed/OesWCRJzrNM",
    ]
    return JSONResponse(content={"cameras": cameras})

@router.post("/logout")
async def logout_user():
    return JSONResponse(content={"message": "User logged out (frontend must handle token removal)."})

@router.post("/broadcast")
async def broadcast_test(message: str):

    n = random.randint(0,len(URS))
    ur_device = URS[n].split("-")[0]


    data = {
                'sensor': {
                    1: (random.gauss(TEMPERATURA_MEDIA, TEMPERATURA_VARIANZA), '°C'),
                    2: (random.gauss(HUMEDAD_MEDIA, HUMEDAD_VARIANZA), 'rH'),
                    4: (random.gauss(CO2_MEDIA, CO2_VARIANZA), 'ppm'),
                },
                'ur_device': ur_device,
                'timestamp': str(datetime.now()),
                'status': True,
            }
    message = data
    broadcast_message({"type": "manual", "message": message})
    return {"status": "Mensaje enviado"}