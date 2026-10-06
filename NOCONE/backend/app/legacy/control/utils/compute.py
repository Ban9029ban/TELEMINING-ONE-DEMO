# services/permanencias.py
from collections import defaultdict
from datetime import datetime
from typing import List, Optional, Dict, Tuple
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.legacy.zenit.models import Device, ProximityLog, Permanencia

GAP_SECONDS = 600            # 10 min
MIN_DUR_MIN = 5
MAX_DUR_MIN = 720

def _rango_fechas(rango: str) -> Tuple[datetime, datetime]:
    if rango == "dia":
        return (datetime(2025, 6, 30, 0, 0, 0), datetime(2025, 6, 30, 23, 59, 59))
    if rango == "semana":
        return (datetime(2025, 6, 24, 0, 0, 0), datetime(2025, 6, 30, 23, 59, 59))
    if rango == "mes":
        return (datetime(2025, 6, 1, 0, 0, 0), datetime(2025, 6, 30, 23, 59, 59))
    raise ValueError("Rango inválido. Use dia, semana o mes.")

def precomputar_permanencias(
    db: Session,
    urs_uuid: List[str],
    tipo: str = "zenit-id",
    entidad_uuid: Optional[str] = None,
    rango: str = "dia",
) -> Dict[str, int]:
    """
    Calcula sesiones de permanencia con la misma lógica del endpoint actual
    y las guarda en zenit_permanencia con upsert (no duplica sesiones).
    Retorna contadores útiles.
    """
    min_fecha, max_fecha = _rango_fechas(rango)

    ur_objs = (
        db.query(Device)
        .filter(Device.device_type == "zenit-ur", Device.uuid.in_(urs_uuid))
        .all()
    )
    if not ur_objs:
        raise ValueError("No se encontraron las URs especificadas.")
    ur_id_map = {ur.id: ur.name for ur in ur_objs}

    entidades_q = db.query(Device).filter(Device.device_type == tipo)
    if entidad_uuid:
        entidades_q = entidades_q.filter(Device.uuid == entidad_uuid)
    entidades = entidades_q.all()
    if not entidades:
        raise ValueError("No se encontraron entidades para analizar.")
    entidad_id_map = {e.id: {"uuid": e.uuid, "name": e.name} for e in entidades}

    # Logs
    logs = (
        db.query(ProximityLog)
        .filter(
            ProximityLog.detected_device_id.in_(entidad_id_map.keys()),
            ProximityLog.ur_device_id.in_(ur_id_map.keys()),
            ProximityLog.timestamp.between(min_fecha, max_fecha),
        )
        .order_by(
            ProximityLog.detected_device_id,
            ProximityLog.ur_device_id,
            ProximityLog.timestamp,
        )
        .all()
    )

    sesiones_por_entidad_ur: Dict[Tuple[int, int], List[Tuple[datetime, datetime, float]]] = defaultdict(list)
    current_sessions: Dict[Tuple[int, int], List[ProximityLog]] = defaultdict(list)

    for log in logs:
        key = (log.detected_device_id, log.ur_device_id)
        sesion = current_sessions[key]

        if not sesion:
            sesion.append(log)
            continue

        delta = (log.timestamp - sesion[-1].timestamp).total_seconds()
        if delta <= GAP_SECONDS:
            sesion.append(log)
        else:
            if len(sesion) >= 2:
                inicio, fin = sesion[0].timestamp, sesion[-1].timestamp
                duracion = (fin - inicio).total_seconds() / 60.0
                if MIN_DUR_MIN <= duracion <= MAX_DUR_MIN:
                    sesiones_por_entidad_ur[key].append((inicio, fin, duracion))
            current_sessions[key] = [log]

    for key, sesion in current_sessions.items():
        if len(sesion) >= 2:
            inicio, fin = sesion[0].timestamp, sesion[-1].timestamp
            duracion = (fin - inicio).total_seconds() / 60.0
            if MIN_DUR_MIN <= duracion <= MAX_DUR_MIN:
                sesiones_por_entidad_ur[key].append((inicio, fin, duracion))

    total_generadas = 0
    total_insertadas = 0
    if sesiones_por_entidad_ur:
        rows = []
        for (entidad_id, ur_id), sesiones in sesiones_por_entidad_ur.items():
            for inicio, fin, duracion in sesiones:
                total_generadas += 1
                rows.append({
                    "entidad_device_id": entidad_id,
                    "ur_device_id": ur_id,
                    "inicio": inicio,
                    "fin": fin,
                    "duracion_minutos": float(round(duracion, 6)),
                })

        if rows:
            stmt = insert(Permanencia).values(rows)
            stmt = stmt.on_conflict_do_nothing(
                index_elements=["entidad_device_id", "ur_device_id", "inicio", "fin"]
            )
            result = db.execute(stmt)
            db.commit()
            total_insertadas = result.rowcount or 0

    return {
        "logs_encontrados": len(logs),
        "sesiones_generadas": total_generadas,
        "sesiones_insertadas": total_insertadas,
    }
