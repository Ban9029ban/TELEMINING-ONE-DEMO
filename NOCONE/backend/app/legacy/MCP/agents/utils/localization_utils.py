from sqlalchemy.orm import Session
from app.legacy.zenit.models import Visualization

def latest_visualization_for_device_type(db: Session, device_id: int):
    """
    Retorna la visualización más reciente asociada a un dispositivo específico.

    Args:
        db (Session): Sesión de base de datos.
        device_id (int): ID del dispositivo (persona o vehículo).

    Returns:
        Visualization | None: Última visualización encontrada, o None si no existe.
    """
    return (
        db.query(Visualization)
        .filter(Visualization.device_id == device_id)
        .order_by(Visualization.last_updated.desc())
        .first()
    )
