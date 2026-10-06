from sqlalchemy.orm import Session
from app.legacy.zenit.models import Device, PingLog
from sqlalchemy import func

def get_zenit_status(db: Session):
    totals = dict(
        db.query(Device.device_type, func.count())
          .filter(Device.device_type.in_(('zenit-ur', 'zenit-central')))
          .group_by(Device.device_type)
          .all()
    )
    track_total = totals.get('zenit-ur', 0)
    central_total = totals.get('zenit-central', 0)

    latest_ur_ping = (
        db.query(PingLog.device_id, PingLog.status)
          .join(Device, Device.id == PingLog.device_id)
          .filter(Device.device_type == 'zenit-ur')
          .order_by(PingLog.device_id, PingLog.timestamp.desc())
          .distinct(PingLog.device_id)
          .subquery()
    )

    active_tracks = (
        db.query(func.count())
          .select_from(latest_ur_ping)
          .filter(latest_ur_ping.c.status.is_(True))
          .scalar()
    ) or 0
    central_activos = 1
    total_activos = active_tracks + central_activos
    total_inactivos = max(track_total - active_tracks, 0)
    denom = (track_total + central_total)
    porcentaje = round((total_activos / denom) * 100) if denom else 0

    return {
        'track_total': track_total,
        'track_activos': active_tracks,
        'central_total': central_total,
        'central_activos': central_activos,
        'total_activos': total_activos,
        'total_inactivos': total_inactivos,
        'porcentaje': f"{porcentaje}%",
    }