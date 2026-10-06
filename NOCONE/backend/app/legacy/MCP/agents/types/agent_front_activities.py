from app.legacy.MCP.agents.base import Agent
from app.legacy.MCP.config.param_loader import PARAMS
from collections import defaultdict
from app.legacy.zenit.models import DataLog, Device, Sensor, PingLog
from app.legacy.MCP.agents.utils.sensors_register import filter_isolated_spikes
from app.legacy.MCP.settings import fmt_es

DESCRIPTION = """
{
  "agent_type": "front_activities",
  "description": "Evalúa actividad y condiciones críticas en frentes de trabajo.",
  "functions": {
    "active_fronts": "Frentes con actividad registrada reciente.",
    "critical_fronts": "Frentes con condiciones críticas (gases o temperatura).",
    "high_temperature_zones": "Zonas con temperatura sobre umbral crítico."
  },
  "optional_inputs": ["zone", "start_date", "end_date"]
}
"""

class FrontActivitiesAgent(Agent):

    def _get_matching_ur_ids(self):
        if not self.zone:
            return []

        matching_ur_ids = []
        for zone_name in self.zone:
            matches = self.db.query(Device.id).filter(
                Device.device_type == 'zenit-ur',
                Device.name.ilike(f"%{zone_name}%")
            ).all()
            matching_ur_ids.extend([ur.id for ur in matches])
        return matching_ur_ids

    def active_fronts(self):

        latest_ur_ping_q = (
            self.db.query(PingLog.device_id, PingLog.status)
            .join(Device, Device.id == PingLog.device_id)
            .filter(Device.device_type == 'zenit-ur')
        )

        if self.zone:
            latest_ur_ping_q = latest_ur_ping_q.filter(Device.name.ilike(self.zone))

        latest_ur_ping_sq = (
            latest_ur_ping_q
            .order_by(PingLog.device_id, PingLog.timestamp.desc())
            .distinct(PingLog.device_id)
            .subquery()
        )

        active_ids_q = (
            self.db.query(latest_ur_ping_sq.c.device_id)
            .filter(latest_ur_ping_sq.c.status.is_(True))
        )
        active_ids = [row[0] for row in active_ids_q.all()]
        if not active_ids:
            return {
                "title": "Frentes activos - Tabla vacía",
                "table": []
            }

        urs = self.db.query(Device).filter(Device.id.in_(active_ids)).all()

        rows = [{"UR ID": ur.id, "Nombre": ur.name} for ur in urs]

        if not rows:
            return {
                "title": "Frentes activos - Tabla vacía",
                "table": []
            }

        return {
            "title": "Frentes activos",
            "table": rows
        }

    def critical_fronts(self):
        matching_ur_ids = self._get_matching_ur_ids()
        threshold_temp = PARAMS["temperatura"]["critical_threshold"]
        thresholds_gas = PARAMS["gases"]
        deltas = PARAMS.get("delta", {})

        sensor_criticos = list(thresholds_gas.keys()) + ["temperatura"]

        query = self.db.query(DataLog).filter(DataLog.sensor_device.has(Sensor.name.in_(sensor_criticos)))
        query = query.filter(DataLog.timestamp.between(self.start_date, self.end_date))

        if matching_ur_ids:
            query = query.filter(DataLog.ur_device_id.in_(matching_ur_ids))

        query = query.order_by(DataLog.ur_device_id, DataLog.sensor_device_id, DataLog.timestamp)
        logs = query.all()

        grouped_logs = defaultdict(list)
        for log in logs:
            if not log.sensor_device or not log.value:
                continue
            zone = log.ur_device.name if log.ur_device else "Desconocida"
            sensor = log.sensor_device.name
            grouped_logs[(zone, sensor)].append(log)

        rows = []
        for (zone, sensor), logs_group in grouped_logs.items():
            delta = deltas.get(sensor, 1)
            filtered = filter_isolated_spikes(logs_group, delta=delta)

            for log in filtered:
                value = log.value
                is_critical = (
                    (sensor == "temperatura" and value > threshold_temp)
                    or (sensor in thresholds_gas and value > thresholds_gas[sensor])
                )
                if is_critical:
                    formatted_time = fmt_es(log.timestamp)
                    rows.append({
                        "zone": zone,
                        "sensor": sensor,
                        "value": round(value, 2),
                        "timestamp": formatted_time
                    })

        if not rows:
            return {
                "title": "Frentes críticos - Tabla vacía",
                "table": []
            }

        return {
            "title": "Frentes críticos",
            "table": rows
        }

    def high_temperature_zones(self):
        matching_ur_ids = self._get_matching_ur_ids()
        threshold = PARAMS["temperatura"]["critical_threshold"]
        delta_temp = PARAMS.get("delta", {}).get("temperatura", 5)

        query = self.db.query(DataLog).filter(DataLog.sensor_device.has(name="temperatura"))
        query = query.filter(DataLog.timestamp.between(self.start_date, self.end_date))

        if matching_ur_ids:
            query = query.filter(DataLog.ur_device_id.in_(matching_ur_ids))

        query = query.order_by(DataLog.ur_device_id, DataLog.timestamp)
        all_logs = query.all()

        grouped_logs = defaultdict(list)
        for log in all_logs:
            zone_name = log.ur_device.name if log.ur_device else "Desconocida"
            grouped_logs[zone_name].append(log)

        rows = []
        for zone, logs in grouped_logs.items():
            filtered_logs = filter_isolated_spikes(logs, delta=delta_temp)

            for log in filtered_logs:
                if log.value > threshold:
                    formatted_time = fmt_es(log.timestamp)
                    rows.append({
                        "zone": zone,
                        "value": round(log.value, 1),
                        "timestamp": formatted_time
                    })

        if not rows:
            return {
                "title": "Zonas con temperatura elevada - Tabla vacía",
                "table": []
            }

        return {
            "title": "Zonas con temperatura elevada",
            "table": rows
        }
