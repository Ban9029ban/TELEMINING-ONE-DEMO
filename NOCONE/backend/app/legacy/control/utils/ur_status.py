from sqlalchemy.orm import Session, aliased
from app.legacy.zenit.models import Visualization, Device, DataLog
from sqlalchemy import func, case

def get_ur_status_data(db: Session):
    ur  = aliased(Device)
    ent = aliased(Device)

    vehiculos_case = case((ent.device_type == 'zenit-mobile', 1), else_=0)
    personas_case  = case((ent.device_type == 'zenit-id',     1), else_=0)

    agg_rows = (
        db.query(
            ur.id.label("ur_id"),
            ur.name.label("ur_name"),
            ur.sensores.label("tiene_sensor"),
            func.sum(vehiculos_case).label("vehiculos"),
            func.sum(personas_case).label("personas"),
            func.max(Visualization.last_updated).label("last_updated"),
        )
        .select_from(ur)
        .outerjoin(Visualization, Visualization.last_ur_id == ur.id)
        .outerjoin(ent, Visualization.device_id == ent.id)
        .filter(ur.device_type == 'zenit-ur')
        .group_by(ur.id, ur.name, ur.sensores)
        .all()
    )

    base = {}
    sensor_ur_ids = []
    for row in agg_rows:
        veh = int(row.vehiculos or 0)
        per = int(row.personas or 0)
        base[row.ur_id] = {
            "name": row.ur_name,
            "tiene_sensor": bool(row.tiene_sensor),
            "vehiculos": veh,
            "personas": per,
            "last_updated": row.last_updated,
        }
        if row.tiene_sensor:
            sensor_ur_ids.append(row.ur_id)

    temp_map = {}
    if sensor_ur_ids:
        rn = func.row_number().over(
            partition_by=DataLog.ur_device_id,
            order_by=DataLog.timestamp.desc()
        ).label("rn")

        latest_temp_sq = (
            db.query(
                DataLog.ur_device_id.label("ur_id"),
                DataLog.value.label("temp"),
                DataLog.timestamp.label("ts"),
                rn
            )
            .filter(
                DataLog.value_type == '°C',
                DataLog.ur_device_id.in_(sensor_ur_ids)
            )
            .subquery()
        )

        temps = (
            db.query(
                latest_temp_sq.c.ur_id,
                latest_temp_sq.c.temp,
                latest_temp_sq.c.ts
            )
            .filter(latest_temp_sq.c.rn == 1)
            .all()
        )
        temp_map = {ur_id: (temp, ts) for ur_id, temp, ts in temps}

    resultado = {}
    for ur_id, info in base.items():
        nombre = info["name"]
        vehiculos = info["vehiculos"]
        personas = info["personas"]
        tiene_sensor = info["tiene_sensor"]

        if tiene_sensor:
            temp, ts = temp_map.get(ur_id, (None, None))
        else:
            temp = None
            ts = info["last_updated"]

        resultado[nombre] = [
            vehiculos,
            personas,
            temp,
            ts.isoformat() if ts else None
        ]
    return resultado