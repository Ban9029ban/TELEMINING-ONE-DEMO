from datetime import datetime
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from datetime import datetime, timedelta
from app.legacy.zenit.models import Visualization, Device, ProximityLog

def get_person_data(db: Session, min_date: str = "2025-01-01", max_date: str = datetime.now().strftime("%Y-%m-%d"), order: str = 'last_updated'):
    person_data = []

    visualizations = db.query(Visualization)\
        .join(Device, Visualization.device_id == Device.id)\
        .filter(Visualization.last_updated >= min_date)\
        .filter(Visualization.last_updated <= max_date)\
        .filter(Device.device_type == 'zenit-id')\
        .order_by(getattr(Visualization, order, Visualization.last_updated))\
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

        person_data.append({
            'status': status_class,
            'name': device.name,
            'fecha': fecha,
            'ultima_ubicacion': ultima_ubicacion,
            'descripcion': 'Fijo - Datos'
        })

    return person_data

def count_persons_per_level(filterByProxLog=False, minDate='', maxDate=''):
    id_level_data = {'NP': 0, 'UCL': 0, 'NTI': 0}
    context = {
        'total_ids': 0,
        'id_level_data': id_level_data,
    }
    return context

def get_people_per_ur(db: Session, filter_by_prox_log: bool = False, min_date=None, max_date=None):
    ur = aliased(Device)
    detected = aliased(Device)

    nivel_expr = func.coalesce(func.upper(ur.nivel), 'SIN NIVEL')

    if not filter_by_prox_log:
        rows = (
            db.query(
                nivel_expr.label('nivel_norm'),
                func.count().label('conteo')
            )
            .join(Visualization, Visualization.last_ur_id == ur.id)
            .join(detected, Visualization.device_id == detected.id)
            .filter(detected.device_type == 'zenit-id')
            .group_by(nivel_expr)                 # 👈 agrupar por la expresión (no por el alias)
            .all()
        )
    else:
        if not (min_date and max_date):
            raise ValueError("min_date y max_date son requeridos cuando filter_by_prox_log=True")

        rows = (
            db.query(
                nivel_expr.label('nivel_norm'),
                func.count(func.distinct(ProximityLog.detected_device_id)).label('conteo')
            )
            .join(ProximityLog, ProximityLog.ur_device_id == ur.id)
            .join(detected, ProximityLog.detected_device_id == detected.id)
            .filter(
                detected.device_type == 'zenit-id',
                ProximityLog.timestamp >= min_date,
                ProximityLog.timestamp <= max_date
            )
            .group_by(nivel_expr)
            .all()
        )

    id_level_data = {}
    total = 0
    for nivel_norm, conteo in rows:
        c = int(conteo or 0)
        id_level_data[nivel_norm] = c
        total += c

    return {
        'total_ids': total,
        'id_level_data': id_level_data,
    }