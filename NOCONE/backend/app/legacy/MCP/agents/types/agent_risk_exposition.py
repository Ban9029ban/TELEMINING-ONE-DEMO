from app.legacy.MCP.agents.base import Agent
from app.legacy.MCP.config.param_loader import PARAMS
from app.legacy.MCP.agents.utils.sensors_register import filter_isolated_spikes
from app.legacy.zenit.models import Visualization, DataLog, Device
from collections import defaultdict
import pandas as pd
from app.legacy.MCP.settings import fmt_es
from app.legacy.MCP.agents.utils.gas_utils import obtener_registros_filtrados, calcular_tiempos_disipacion
from sqlalchemy import func
from sqlalchemy.orm import aliased

DESCRIPTION = """
{
  "agent_type": "risk_exposition",
  "description": "Analiza exposición a temperaturas o gases críticos en la mina.",
  "functions": {
    "critical_temperature_zones": "Zonas con lecturas de temperatura crítica.",
    "exposure_time_per_person_in_critical_temp": "Minutos expuestos por persona en zonas críticas.",
    "gas_dissipation_times": "Duración de eventos de gases críticos hasta su disipación."
  },
  "optional_inputs": ["zone", "start_date", "end_date", "gas"]
}
"""

class RiskExpositionAgent(Agent):

    def _get_matching_ur_ids(self):
        if not self.zone:
            return []
        matching_ur_ids = []
        for zone_name in self.zone:
            matches = self.db.query(Device.id).filter(
                Device.device_type == 'zenit-ur',
                Device.name.ilike(f"%{zone_name}%")
            ).all()
            matching_ur_ids.extend([m.id for m in matches])
        return matching_ur_ids

    def critical_temperature_zones(self):
        threshold = PARAMS["temperatura"]["critical_threshold"]
        matching_ur_ids = self._get_matching_ur_ids()

        # Subquery: última lectura por UR (row_number() over partition by ur_device_id)
        last_per_ur_sq = (
            self.db.query(
                DataLog.ur_device_id.label("ur_id"),
                DataLog.value.label("value"),
                DataLog.timestamp.label("ts"),
                func.row_number().over(
                    partition_by=DataLog.ur_device_id,
                    order_by=DataLog.timestamp.desc()
                ).label("rn")
            )
            .filter(DataLog.sensor_device.has(name="temperatura"))
            .filter(DataLog.timestamp.between(self.start_date, self.end_date))
        )

        if matching_ur_ids:
            last_per_ur_sq = last_per_ur_sq.filter(DataLog.ur_device_id.in_(matching_ur_ids))

        last_per_ur_sq = last_per_ur_sq.subquery()

        UR = aliased(Device)
        q = (
            self.db.query(
                UR.name.label("zone"),
                last_per_ur_sq.c.value,
                last_per_ur_sq.c.ts
            )
            .join(UR, UR.id == last_per_ur_sq.c.ur_id)
            .filter(last_per_ur_sq.c.rn == 1)   # ← solo la última lectura por zona
        )

        rows = []
        for zone, value, ts in q.all():
            if value is not None and value > threshold:
                rows.append({
                    "zone": zone,
                    "value": round(value, 1),
                    "timestamp": fmt_es(ts)
                })

        if not rows:
            return {"title": "Zonas críticas por temperatura - Tabla vacía", "table": []}

        return {"title": "Zonas críticas por temperatura", "table": rows}

    def exposure_time_per_person_in_critical_temp(self):
        threshold = PARAMS["temperatura"]["critical_threshold"]
        delta_temp = PARAMS.get("delta", {}).get("temperatura", 5)

        personas = self.db.query(Visualization).filter(
            Visualization.device.has(device_type='zenit-id')
        ).all()

        exposicion = defaultdict(float)

        for vis in personas:
            query = self.db.query(DataLog).filter(
                DataLog.ur_device_id == vis.last_ur_id,
                DataLog.sensor_device.has(name="temperatura"),
                DataLog.timestamp >= vis.last_updated - pd.Timedelta(minutes=5),
                DataLog.timestamp <= vis.last_updated + pd.Timedelta(minutes=5),
            ).order_by(DataLog.timestamp)

            sensor_data = filter_isolated_spikes(query.all(), delta=delta_temp)

            for sensor in sensor_data:
                if sensor.value > threshold:
                    exposicion[vis.device.name] += 5  # minutos

        rows = [{"persona": k, "tiempo_minutos": v} for k, v in exposicion.items()]

        if not rows:
            return {
                "title": "Tiempo de exposición por persona - Tabla vacía",
                "table": []
            }

        return {
            "title": "Tiempo de exposición por persona en temperatura crítica",
            "table": rows
        }

    def gas_dissipation_times(self):
        gas_param = self.params.get("gas")
        thresholds = PARAMS["gases"]
        gases = [gas_param] if gas_param else list(thresholds.keys())
        print(f"[DEBUG] Gases a procesar: {gases}")

        rows = []
        for gas in gases:
            registros, threshold = obtener_registros_filtrados(
                self.db, gas, self.start_date, self.end_date, self.zone
            )
            eventos = calcular_tiempos_disipacion(registros, threshold)

            for e in eventos:
                rows.append({
                    "gas": gas,
                    "inicio": fmt_es(e["inicio"]),
                    "fin": fmt_es(e["fin"]),
                    "duracion_minutos": e["duracion_minutos"]
                })

        if not rows:
            return {
                "title": "Tiempos de disipación por gas - Tabla vacía",
                "table": []
            }

        return {
            "title": "Tiempos de disipación por gas",
            "table": rows
        }