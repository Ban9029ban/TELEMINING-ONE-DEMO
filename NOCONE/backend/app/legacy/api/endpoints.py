from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import json
from app.legacy.telemining.database import get_db
from app.legacy.zenit.models import *
from app.legacy.control.models import Controlador
from app.legacy.api.serializers import (DataLogSchema, ProximityLogSchema, PingLogSchema)
from faker import Faker
import random
from app.legacy.control.simulator import URS,TEMPERATURA_MEDIA,TEMPERATURA_VARIANZA,CO2_MEDIA,CO2_VARIANZA,HUMEDAD_VARIANZA,HUMEDAD_MEDIA

router = APIRouter()

active_connections: List[WebSocket] = []

@router.websocket("/ws/realtime-data/{mapa_id}")
async def realtime_data_websocket(websocket: WebSocket, mapa_id: str, db: Session = Depends(get_db)):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            # Mantener conexión viva
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)

async def broadcast_realtime_data(data: dict):
    for connection in active_connections.copy():
        try:
            await connection.send_text(json.dumps(data))
        except:
            active_connections.remove(connection)

@router.get("/v1/datalog", response_model=List[DataLogSchema])
async def get_datalog(db: Session = Depends(get_db)):
    datalogs = db.query(DataLog).all()
    return datalogs

@router.get("/v1/datalog/{pk}", response_model=DataLogSchema)
async def get_datalog_detail(pk: int, db: Session = Depends(get_db)):
    datalog = db.query(DataLog).get(pk)
    if not datalog:
        raise HTTPException(status_code=404, detail="DataLog not found")
    return datalog

@router.post("/v1/datalog", response_model=List[DataLogSchema])
async def create_datalog(payload: dict, db: Session = Depends(get_db)):

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
    payload = data

    ur_value = str(payload.get("ur_device", "")).strip()

    if not ur_value:
        print(f"WARNING: Missing ur_device in datalog payload: {payload}")
        return []

    device = db.query(Device).filter(Device.uuid.contains(ur_value)).first()
    if not device:
        print(f"WARNING: UR Device {ur_value} not found for datalog")
        return []

    datalogs = []

    for sensor_name, values in payload.get("sensor", {}).items():
        sensor = db.query(Sensor).filter(Sensor.name == sensor_name).first()
        if not sensor:
            print(f"WARNING: Sensor '{sensor_name}' not found, skipping...")
            continue

        log = DataLog(
            sensor_device_id=sensor.id,
            ur_device_id=device.id,
            data_type="float",
            value=values[0],
            value_type=values[1],
            timestamp=payload["timestamp"],
            status=payload["status"]
        )
        db.add(log)
        datalogs.append(log)

    db.commit()
    
    await broadcast_realtime_data({
        "type": "datalog",
        "data": payload,
        "processed_data": {
            "ur_device_id": device.id,
            "sensors": payload.get("sensor", {}),
            "timestamp": payload["timestamp"]
        }
    })
    return datalogs

@router.get("/v1/pinglog", response_model=List[PingLogSchema])
async def get_pinglog(db: Session = Depends(get_db)):
    pinglogs = db.query(PingLog).all()
    return pinglogs

@router.post("/v1/pinglog", response_model=PingLogSchema)
async def create_pinglog(payload: dict, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.uuid.contains(payload['device'])).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    pinglog = PingLog(
        device_id=device.id,
        timestamp=payload["timestamp"],
        status=payload["status"]
    )
    db.add(pinglog)
    db.commit()
    db.refresh(pinglog)
    return pinglog

@router.get("/v1/proximitylog", response_model=List[ProximityLogSchema])
async def get_proximitylog(db: Session = Depends(get_db)):
    proximity_logs = db.query(ProximityLog).all()
    return proximity_logs

@router.post("/v1/proximitylog", response_model=List[ProximityLogSchema])
async def create_proximitylog(payload: dict, db: Session = Depends(get_db)):
    from datetime import datetime
 
    #print(">>> [DEBUG] Payload recibido:", payload)
 
    ur_value = str(payload.get("ur_device", "")).strip()
    #print(">>> [DEBUG] UR device UUID recibido:", ur_value)
 
    if not ur_value:
        raise HTTPException(status_code=400, detail="Missing or invalid 'ur_device'")
 
    device = db.query(Device).filter(Device.uuid.like(f"%{ur_value}%")).first()
    #print(">>> [DEBUG] UR device encontrado:", device.name if device else "No encontrado")
 
    if not device:
        print(f"WARNING: UR Device {ur_value} not found in database")
        return []
 
    try:
        timestamp = datetime.fromisoformat(payload["timestamp"])
        #print(">>> [DEBUG] Timestamp parseado:", timestamp)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")
 
    if not payload.get("proximity_ids"):
        #print(">>> [DEBUG] No se detectaron dispositivos cercanos, creando PingLog...")
        pinglog = PingLog(
            device_id=device.id,
            timestamp=timestamp,
            status=True
        )
        db.add(pinglog)
        db.commit()
        db.refresh(pinglog)
        #print(">>> [DEBUG] PingLog creado correctamente para:", device.name)
        return []
 
    proximity_logs = []
    valid_proximity_count = 0
 
    for proximity_id in payload["proximity_ids"]:
        prox_value = str(proximity_id).strip()
        #print(f">>> [DEBUG] Procesando Proximity ID: {proximity_id} -> Normalizado: {prox_value}")
 
        detected_device = db.query(Device).filter(Device.uuid.like(f"%{prox_value}%")).first()
        #print(">>> [DEBUG] Dispositivo detectado:", detected_device.name if detected_device else "No encontrado")
 
        if not detected_device:
            print(f"WARNING: Proximity Device {proximity_id} not found, skipping...")
            continue
 
        log = ProximityLog(
            ur_device_id=device.id,
            detected_device_id=detected_device.id,
            timestamp=timestamp,
            distance=0.0,
            status=payload["status"]
        )
        db.add(log)
        proximity_logs.append(log)
        valid_proximity_count += 1
        #print(f">>> [DEBUG] ProximityLog creado: UR={device.name}, Detectado={detected_device.name}, Timestamp={timestamp}")
 
        visual = db.query(Visualization).filter(Visualization.device_id == detected_device.id).first()
        if not visual:
            visual = Visualization(
                device_id=detected_device.id,
                previous_ur_id=device.id,
                initial_ur_id=device.id,
                initial_updated=timestamp,
                last_ur_id=device.id,
                last_updated=timestamp
            )
            db.add(visual)
            #print(f">>> [DEBUG] Nueva visualización creada para: {detected_device.name}")
        else:
            visual.last_ur_id = device.id
            visual.last_updated = timestamp
            #print(f">>> [DEBUG] Visualización actualizada para: {detected_device.name}")
 
    db.commit()
    #print(">>> [DEBUG] Commit realizado con", valid_proximity_count, "ProximityLogs válidos")
 
    await broadcast_realtime_data({
        "type": "proximitylog",
        "data": payload,
        "processed_data": {
            "ur_device_id": device.id,
            "proximity_count": len(payload.get("proximity_ids", [])),
            "timestamp": payload["timestamp"]
        }
    })
 
    #print(">>> [DEBUG] Datos enviados a WebSocket")
 
    return proximity_logs



@router.post("/v1/createperson")
async def create_person(payload: dict, db: Session = Depends(get_db)):

    fake = Faker()
    result = {"zenit-id": []}

    for _ in range(payload['numero_personas']):
        nombre = fake.first_name()
        apellido = fake.last_name()
        rut = f"{random.randint(1, 2)}{random.randint(0,9)}.{random.randint(1000,9999)}.{random.randint(1000,9999)}-{random.randint(0,9)}"
        empresa = random.choice(CLIENT_CHOICES)[0]

        device = Device(name=f"{nombre} {apellido}", device_type="zenit-id", client=empresa, location="", nivel="")
        db.add(device)
        db.commit()
        db.refresh(device)

        person = Person(device_id=device.id, nombres=nombre, apellidos=apellido, rut=rut, empresa=empresa,
                        cargo=fake.job(), correo=fake.email(domain=empresa+".com"), telefono="+56900000000")
        db.add(person)
        db.commit()

        result["zenit-id"].append(device.uuid)

    return result

@router.get("/dashboard-settings")
async def get_dashboard_settings(request: Request, db: Session = Depends(get_db)):
    user = "test_user"  # Placeholder user handling
    controlador = db.query(Controlador).filter(Controlador.user == user).first()
    if not controlador:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return controlador.dashboard_settings

@router.post("/dashboard-settings")
async def post_dashboard_settings(payload: dict, db: Session = Depends(get_db)):
    user = "test_user"  # Placeholder user handling
    controlador = db.query(Controlador).filter(Controlador.user == user).first()
    if not controlador:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    controlador.dashboard_settings = payload
    db.commit()
    return {"message": "Datos guardados!"}
