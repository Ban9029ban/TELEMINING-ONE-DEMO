from app.legacy.MCP.agents.base import Agent
from app.legacy.MCP.config.param_loader import PARAMS
from app.legacy.zenit.models import DataLog, Vehicle, Device, Visualization, ProximityLog
from collections import defaultdict
from datetime import datetime, time
from app.legacy.MCP.settings import fmt_es

DESCRIPTION = """
{
  "agent_type": "movement_analysis",
  "description": "Analiza entradas, turnos, ciclos de transporte y permanencia en talleres.",
  "functions": {
    "vehicle_transport_cycles": "Horas de entrada y salida diaria de camiones.",
    "estimated_shift_times": "Inicio y fin estimado del turno A cada día.",
    "individual_presence_log": "Hora de llegada y salida por persona.",
    "time_in_workshop": "Tiempo de vehículos en zonas de taller."
  },
  "optional_inputs": ["start_date", "end_date"]
}
"""

class MovementAnalysisAgent(Agent):

    def vehicle_transport_cycles(self):
        sensor_id = PARAMS["zona_ingreso_egreso"]["sensor_id"]
        ingreso_devices = set(PARAMS["zona_ingreso_egreso"]["device_ids"])

        vehicles = self.db.query(Vehicle).filter(Vehicle.tipo_vehiculo.ilike('%camion%')).all()
        device_ids = [v.device_id for v in vehicles if v.device_id]

        if not device_ids:
            return {
                "title": "Ciclo de transporte de camiones - Tabla vacía",
                "table": []
            }

        query = self.db.query(DataLog).filter(
            DataLog.sensor_device_id == sensor_id,
            DataLog.ur_device_id.in_(ingreso_devices),
            DataLog.timestamp.between(self.start_date, self.end_date),
            DataLog.status == True
        ).order_by(DataLog.timestamp).all()

        registros_por_camion_dia = defaultdict(list)

        for log in query:
            ur_device = self.db.query(Device).filter(Device.id == log.ur_device_id).first()
            if not ur_device:
                continue

            vehicle = self.db.query(Vehicle).filter(Vehicle.device_id == ur_device.id).first()
            if not vehicle:
                continue

            fecha = log.timestamp.date().isoformat()
            registros_por_camion_dia[(vehicle.id, fecha)].append(log.timestamp)

        rows = []
        for (vehicle_id, fecha), timestamps in registros_por_camion_dia.items():
            entrada = min(timestamps)
            salida = max(timestamps)

            vehiculo = self.db.query(Vehicle).filter(Vehicle.id == vehicle_id).first()
            patente = vehiculo.patente_empresa or vehiculo.patente_nacional

            rows.append({
                "fecha": datetime.fromisoformat(fecha).strftime("%-d %B, %Y"),
                "vehiculo": patente,
                "entrada": fmt_es(entrada),
                "salida": fmt_es(salida)
            })

        if not rows:
            return {
                "title": "Ciclo de transporte de camiones - Tabla vacía",
                "table": []
            }

        return {
            "title": "Ciclo de transporte de camiones",
            "table": rows
        }

    def estimated_shift_times(self):
        turno_config = PARAMS.get("turnos", {}).get("A")
        if not turno_config:
            return {
                "title": "Inicio y término de Turno A - Configuración faltante",
                "table": []
            }

        turno_inicio = datetime.strptime(turno_config["start_hour"], "%H:%M").time()
        turno_fin = datetime.strptime(turno_config["end_hour"], "%H:%M").time()

        start_datetime = datetime.combine(self.start_date.date(), time.min)
        end_datetime = datetime.combine(self.end_date.date(), time.max)

        query = self.db.query(Visualization).filter(
            Visualization.device.has(Device.device_type == 'zenit-mobile'),
            Visualization.last_updated.between(start_datetime, end_datetime)
        ).all()

        registros_por_dia = defaultdict(list)

        for vis in query:
            hora = vis.last_updated.time()
            if turno_inicio <= hora <= turno_fin:
                fecha = vis.last_updated.date()
                registros_por_dia[fecha].append(vis.last_updated)

        rows = []
        for fecha, timestamps in registros_por_dia.items():
            inicio = min(timestamps)
            fin = max(timestamps)
            rows.append({
                "fecha": fmt_es(fecha),
                "inicio_turno": fmt_es(inicio),
                "fin_turno": fmt_es(fin)
            })

        if not rows:
            return {
                "title": "Inicio y término de Turno A - Tabla vacía",
                "table": []
            }

        return {
            "title": "Inicio y término de Turno A",
            "table": rows
        }

    def individual_presence_log(self):
        zona_llegada_ids = PARAMS.get("zona_ingreso_egreso", {}).get("device_ids", [])
        if not zona_llegada_ids:
            return {"title": "Zona de llegada no configurada", "table": []}

        personas = self.db.query(Device).filter(Device.device_type == 'zenit-id').all()
        start_datetime = datetime.combine(self.start_date.date(), time.min)
        end_datetime = datetime.combine(self.end_date.date(), time.max)
        resultado = []

        for persona in personas:
            logs = self.db.query(ProximityLog).filter(
                ProximityLog.detected_device_id.in_(zona_llegada_ids),
                ProximityLog.ur_device_id == persona.id,
                ProximityLog.timestamp.between(start_datetime, end_datetime)
            ).order_by(ProximityLog.timestamp.asc()).all()

            if logs:
                resultado.append({
                    "persona": persona.name,
                    "hora_llegada": fmt_es(logs[0].timestamp),
                    "hora_salida": fmt_es(logs[-1].timestamp)
                })

        if not resultado:
            return {
                "title": "Registro individual de personas en la mina - Tabla vacía",
                "table": []
            }

        return {
            "title": "Registro individual de personas en la mina",
            "table": resultado
        }

    def time_in_workshop(self):
        taller_ids = PARAMS.get("zonas_taller", {}).get("device_ids", [])
        if not taller_ids:
            return {"title": "Zonas de taller no configuradas", "table": []}

        start_datetime = datetime.combine(self.start_date.date(), time.min)
        end_datetime = datetime.combine(self.end_date.date(), time.max)

        registros = self.db.query(ProximityLog).filter(
            ProximityLog.detected_device_id.in_(taller_ids),
            ProximityLog.timestamp.between(start_datetime, end_datetime)
        ).order_by(ProximityLog.ur_device_id, ProximityLog.timestamp).all()

        tiempos_por_equipo_dia = defaultdict(list)

        for log in registros:
            device = self.db.query(Device).filter(Device.id == log.ur_device_id).first()
            if not device:
                continue

            vehicle = self.db.query(Vehicle).filter(Vehicle.device_id == device.id).first()
            if not vehicle:
                continue

            key = (vehicle.patente_empresa or vehicle.patente_nacional, log.timestamp.date())
            tiempos_por_equipo_dia[key].append(log.timestamp)

        resultado = []
        for (vehiculo, fecha), timestamps in tiempos_por_equipo_dia.items():
            if not timestamps:
                continue
            duracion = timestamps[-1] - timestamps[0]
            minutos = int(duracion.total_seconds() // 60)
            horas = minutos // 60
            mins = minutos % 60
            resultado.append({
                "fecha": fecha.strftime("%-d %B, %Y"),
                "equipo": vehiculo,
                "duracion_en_taller": f"{horas}h {mins}min"
            })

        if not resultado:
            return {"title": "Tiempo en taller por vehículo - Tabla vacía", "table": []}

        return {"title": "Tiempo en taller por vehículo", "table": resultado}