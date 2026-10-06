from sqlalchemy.orm import Session
from app.legacy.zenit.models import DataLog

def get_sensor_data(db: Session) -> dict:
    sensor_logs = db.query(DataLog).all()

    sensor_data = {}
    for log in sensor_logs:
        ur_name = log.ur_device.name
        if ur_name not in sensor_data:
            sensor_data[ur_name] = {
                "timestamps": [],
                "values": [],
            }
        sensor_data[ur_name]["timestamps"].append(log.timestamp.isoformat())
        sensor_data[ur_name]["values"].append(log.value)

    critical_values = {
        "Valor critico superior": 30.0,
        "Valor critico inferior": 20.0,
    }

    return {
        "sensor_data": sensor_data,
        "critical_values": critical_values,
    }