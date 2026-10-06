from app.legacy.MCP.agents.base import Agent
from app.legacy.MCP.config.param_loader import PARAMS
from sqlalchemy.orm import aliased
from sqlalchemy import desc
from app.legacy.zenit.models import Device, Visualization, ProximityLog
from datetime import datetime
from app.legacy.MCP.settings import fmt_es
from app.legacy.MCP.agents.utils.localization_utils import latest_visualization_for_device_type

DESCRIPTION = '''
{
  "agent_type": "localization",
  "description": "Localiza personas, vehículos o zonas sin actividad.",
  "functions": {
    "current_vehicle_location": "Última ubicación registrada de vehículos.",
    "current_person_location": "Última ubicación registrada de personas.",
    "isolated_sectors": "Zonas sin registros recientes.",
    "initial_shift_localization": "Ubicación inicial de vehículos al comienzo del turno A."
  },
  "optional_inputs": ["zone", "start_date", "end_date"]
}
'''


class LocalizationAgent(Agent):

    def initial_shift_localization(self):
        turno_config = PARAMS.get("turnos", {}).get("A")
        if not turno_config:
            return {
                "title": "Ubicación inicial de equipos - Configuración de turno A faltante",
                "table": []
            }

        # Limite horario del turno A
        turno_inicio = datetime.strptime(turno_config["start_hour"], "%H:%M").time()
        turno_fin = datetime.strptime(turno_config["end_hour"], "%H:%M").time()

        base_fecha = self.start_date.date()
        start_datetime = datetime.combine(base_fecha, turno_inicio)
        end_datetime = datetime.combine(base_fecha, turno_fin)

        dispositivos = self.db.query(Device).filter(Device.device_type == 'zenit-mobile').all()
        resultado = []

        for device in dispositivos:
            vis = self.db.query(Visualization).filter(
                Visualization.device_id == device.id,
                Visualization.initial_updated.between(start_datetime, end_datetime)
            ).order_by(Visualization.initial_updated.asc()).first()

            if vis and vis.initial_ur:
                if self.zone and vis.initial_ur.name.lower() != self.zone.lower():
                    continue

                formatted_time = fmt_es(vis.initial_updated) if vis.initial_updated else None

                resultado.append({
                    "equipo": device.name,
                    "ubicacion_inicial": vis.initial_ur.name,
                    "timestamp": formatted_time
                })

        if not resultado:
            return {
                "title": "Ubicación inicial de equipos - Tabla vacía",
                "table": []
            }

        return {
            "title": "Ubicación inicial de equipos al inicio del Turno A",
            "table": resultado
        }

    def current_vehicle_location(self):
        result = []

        # Paso 1: Obtener todas las URs que coincidan parcialmente con cada zona buscada
        matching_ur_ids = []
        if self.zone:
            for zone_name in self.zone:
                matches = self.db.query(Device.id).filter(
                    Device.device_type == 'zenit-ur',
                    Device.name.ilike(f"%{zone_name}%")
                ).all()
                matching_ur_ids.extend([ur.id for ur in matches])

        # Paso 2: Obtener dispositivos de vehículos
        vehicle_devices = self.db.query(Device).filter(Device.device_type == 'zenit-mobile').all()
        vehicle_ids = [d.id for d in vehicle_devices]
        vehicle_names = {d.id: d.name for d in vehicle_devices}

        if not vehicle_ids:
            return {"title": "Localización Vehículos", "table": []}

        # Subconsulta: última visualización por vehículo
        subquery = (
            self.db.query(
                Visualization.device_id,
                Visualization.last_ur_id,
                Visualization.last_updated
            )
            .filter(Visualization.device_id.in_(vehicle_ids))
            .order_by(Visualization.device_id, desc(Visualization.last_updated))
            .distinct(Visualization.device_id)
            .subquery()
        )

        UR = aliased(Device)

        query = (
            self.db.query(
                subquery.c.device_id,
                UR.name.label("last_ur_name"),
                subquery.c.last_updated
            )
            .outerjoin(UR, UR.id == subquery.c.last_ur_id)
        )

        if matching_ur_ids:
            query = query.filter(subquery.c.last_ur_id.in_(matching_ur_ids))

        rows = query.all()

        for row in rows:
            formatted_time = fmt_es(row.last_updated) if row.last_updated else None
            result.append({
                "id": row.device_id,
                "nombre": vehicle_names.get(row.device_id, "Desconocido"),
                "última visualización": row.last_ur_name,
                "fecha": formatted_time
            })

        return {"title": "Localización Vehículos", "table": result}

    def current_person_location(self):
        result = []

        # Paso 1: Obtener todas las URs que coincidan parcialmente con cada zona buscada
        matching_ur_ids = []
        if self.zone:
            for zone_name in self.zone:
                matches = self.db.query(Device.id).filter(
                    Device.device_type == 'zenit-ur',
                    Device.name.ilike(f"%{zone_name}%")
                ).all()
                matching_ur_ids.extend([ur.id for ur in matches])

        # Paso 2: Obtener dispositivos de personas
        person_devices = self.db.query(Device).filter(Device.device_type == 'zenit-id').all()
        person_ids = [d.id for d in person_devices]
        person_names = {d.id: d.name for d in person_devices}

        if not person_ids:
            return {"title": "Localización Personas", "table": []}

        # Subconsulta: última visualización por persona
        subquery = (
            self.db.query(
                Visualization.device_id,
                Visualization.last_ur_id,
                Visualization.last_updated
            )
            .filter(Visualization.device_id.in_(person_ids))
            .order_by(Visualization.device_id, desc(Visualization.last_updated))
            .distinct(Visualization.device_id)
            .subquery()
        )

        UR = aliased(Device)

        query = (
            self.db.query(
                subquery.c.device_id,
                UR.name.label("last_ur_name"),
                subquery.c.last_updated
            )
            .outerjoin(UR, UR.id == subquery.c.last_ur_id)
        )

        if matching_ur_ids:
            query = query.filter(subquery.c.last_ur_id.in_(matching_ur_ids))

        rows = query.all()

        for row in rows:
            formatted_time = fmt_es(row.last_updated) if row.last_updated else None
            result.append({
                "id": row.device_id,
                "nombre": person_names.get(row.device_id, "Desconocido"),
                "última visualización": row.last_ur_name,
                "fecha": formatted_time
            })

        return {"title": "Localización Personas", "table": result}
