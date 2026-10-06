from datetime import datetime
from collections import defaultdict, Counter
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, case
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from app.legacy.zenit.models import Visualization, Device, PingLog, Vehicle

def get_vehicle_data(db: Session, min_date: str = "2025-01-01", max_date: str = datetime.now().strftime("%Y-%m-%d"), order: str = 'last_updated'):
    vehicle_data = []
    
    visualizations = db.query(Visualization)\
        .join(Device, Visualization.device_id == Device.id)\
        .filter(Visualization.last_updated >= min_date)\
        .filter(Visualization.last_updated <= max_date)\
        .filter(Device.device_type == 'zenit-mobile')\
        .order_by(getattr(Visualization, order))\
        .all()
    
    now = datetime.now()

    for vis in visualizations:
        device = vis.device
        if not device:
            continue
        
        delta = now - vis.last_updated if vis.last_updated else timedelta(days=9999)
        status_class = 'bg-success' if delta.total_seconds() < 300 else 'bg-warning'
        fecha = vis.last_updated.strftime("%d-%m-%Y : %I:%M %p") if vis.last_updated else "Sin registro"

        ultima_ubicacion = None
        if vis.last_ur_id:
            ur_device = db.query(Device).filter(Device.id == vis.last_ur_id).first()
            ultima_ubicacion = ur_device.name if ur_device else None
        
        vehicle_data.append({
            'status': status_class,
            'name': device.name,
            'fecha': fecha,
            'ultima_ubicacion': ultima_ubicacion,  # Puedes enriquecer esto con más info si quieres
            'descripcion': 'Móvil - Ubicación'
        })

    return vehicle_data

FRESH_MINUTES = 10

def get_vehicle_status(db: Session):
    cutoff = datetime.utcnow() - timedelta(minutes=FRESH_MINUTES)

    last_ping_sq = (
        db.query(
            PingLog.device_id.label("device_id"),
            func.max(PingLog.timestamp).label("ultimo_ping")
        )
        .group_by(PingLog.device_id)
        .subquery()
    )

    rows = (
        db.query(
            Vehicle.tipo_vehiculo.label("tipo"),
            func.sum(
                case(
                    (
                        (last_ping_sq.c.ultimo_ping.is_(None)) |
                        (last_ping_sq.c.ultimo_ping < cutoff),
                        1
                    ),
                    else_=0
                )
            ).label("desconectados"),
            func.count().label("total_por_tipo")
        )
        .join(Device, Device.id == Vehicle.device_id)
        .outerjoin(last_ping_sq, last_ping_sq.c.device_id == Device.id)
        .filter(Device.device_type == "zenit-mobile")
        .group_by(Vehicle.tipo_vehiculo)
        .all()
    )

    result = {"Desconectados": 0}
    for r in rows:
        tipo = r.tipo or "sin_tipo"
        desc = int(r.desconectados or 0)
        result[tipo] = desc
        result["Desconectados"] += desc

    return result

def contador_vehiculos_view():
    conteo_vehiculos_por_nivel = defaultdict(Counter)
    context = {
        'cont_vehiculos_total': 0,
        'conteo_vehiculos_por_nivel': dict(conteo_vehiculos_por_nivel),
    }
    return context


def get_vehicles_per_ur(db: Session):
    ur  = aliased(Device)
    mob = aliased(Device)

    nivel_expr = func.coalesce(func.upper(ur.nivel), 'SIN NIVEL')
    tipo_expr  = func.coalesce(func.initcap(Vehicle.tipo_vehiculo), 'Desconocido')

    rows = (
        db.query(
            nivel_expr.label("nivel_norm"),
            tipo_expr.label("tipo_norm"),
            func.count().label("conteo"),
        )
        .select_from(mob)
        .join(Vehicle, Vehicle.device_id == mob.id)
        .join(Visualization, Visualization.device_id == mob.id)
        .join(ur, Visualization.last_ur_id == ur.id)
        .filter(mob.device_type == 'zenit-mobile')
        .filter(Vehicle.tipo_vehiculo.isnot(None))
        .group_by(nivel_expr, tipo_expr)
        .all()
    )

    conteo_vehiculos_por_nivel = defaultdict(dict)
    tipos_set = set()
    total = 0
    for nivel_norm, tipo_norm, conteo in rows:
        c = int(conteo or 0)
        conteo_vehiculos_por_nivel[nivel_norm][tipo_norm] = c
        tipos_set.add(tipo_norm)
        total += c

    return {
        "cont_vehiculos_total": total,
        "conteo_vehiculos_por_nivel": {k: dict(v) for k, v in conteo_vehiculos_por_nivel.items()},
        "vehicle_types": sorted(tipos_set),
    }