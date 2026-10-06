from sqlalchemy.orm import Session
import pandas as pd
import os
import numpy as np
from app.legacy.telemining.database import get_db
from app.legacy.control.models import Mapa, Punto, Controlador
from app.legacy.zenit.models import Device, Visualization, ProximityLog, PingLog, Vehicle, Person, DataLog, Sensor, Zone

import uuid

CSV_FOLDER = "db_filtrada"


def cargar_mapa_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'control_mapa.csv')
    if not os.path.exists(path):
        return "Archivo control_mapa.csv no encontrado"

    df = pd.read_csv(path)
    
    # Asegurar tipos correctos
    df["id"] = df["id"].astype(int)
    df["file"] = df["file"].astype(str)
    df["name"] = df["name"].astype(str)
    df["proyecto"] = df["proyecto"].astype(str)

    print("Cargando mapas:", len(df), "registros")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Mapa(
                    id=row["id"],
                    file=row["file"],
                    name=row["name"],
                    proyecto=row["proyecto"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"Error insertando registros del chunk {start}-{end}: {e}")

    return f"{total_insertados} mapas insertados"


# 🗂 Función para cargar control_punto.csv
def cargar_punto_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'control_punto.csv')
    if not os.path.exists(path):
        return "Archivo control_punto.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["id"] = df["id"].astype(int)
    df["map_x"] = df["map_x"].astype(float)
    df["map_y"] = df["map_y"].astype(float)
    df["device_id"] = df["device_id"].astype(int)
    df["mapa_id"] = df["mapa_id"].astype(int)

    print(f"[🔍] Total puntos leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Punto(
                    id=row["id"],
                    map_x=row["map_x"],
                    map_y=row["map_y"],
                    device_id=row["device_id"],
                    mapa_id=row["mapa_id"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} puntos insertados"

def cargar_controlador_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'control_controlador.csv')
    if not os.path.exists(path):
        return "Archivo control_controlador.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["user_id"] = df["user_id"].astype(int)

    print(f"[🔍] Total controladores leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Controlador(
                    user_id=row["user_id"],
                    
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} controladores insertados"

def cargar_device_csv(db: Session, chunk_size: int = 1000):
    path = os.path.join(CSV_FOLDER, 'zenit_device.csv')
    if not os.path.exists(path):
        return "Archivo zenit_device.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Normalización de columnas
    df["id"] = df["id"].astype(int)
    df["uuid"] = df["uuid"].apply(lambda x: str(uuid.UUID(str(x))))
    df["name"] = df["name"].astype(str)
    df["device_type"] = df["device_type"].astype(str)
    df["client"] = df["client"].astype(str)
    df["location"] = df["location"].fillna("").apply(lambda x: str(x).strip())
    df["mac_address"] = df["mac_address"].fillna("").apply(lambda x: str(x).strip())
    df["zone_id"] = df["zone_id"].apply(lambda x: int(x) if pd.notna(x) and str(x).strip() != '' else None)
    df["nivel"] = df["nivel"].apply(lambda x: x if pd.notna(x) and str(x).strip() != '' else 'NP')
    df["sensores"] = df["sensores"].astype(bool)

    print(f"[🔍] Total dispositivos leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Device(
                    id=row["id"],
                    uuid=row["uuid"],
                    name=row["name"],
                    device_type=row["device_type"],
                    client=row["client"],
                    location=row["location"],
                    ip=row["ip"],
                    mac_address=row["mac_address"],
                    zone_id=row["zone_id"] if not np.isnan(row["zone_id"]) else None,
                    nivel=row["nivel"],
                    sensores=row["sensores"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} dispositivos insertados"

def cargar_vehicle_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'zenit_vehicle.csv')
    if not os.path.exists(path):
        return "Archivo zenit_vehicle.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["device_id"] = df["device_id"].apply(lambda x: int(x) if pd.notna(x) else None)
    df["patente_nacional"] = df["patente_nacional"].fillna("").astype(str).str.strip()
    df["patente_empresa"] = df["patente_empresa"].fillna("").astype(str).str.strip()
    df["tipo_vehiculo"] = df["tipo_vehiculo"].fillna("").astype(str).str.strip()
    df["empresa"] = df["empresa"].fillna("").astype(str).str.strip()

    print(f"[🔍] Total vehículos leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Vehicle(
                    patente_nacional=row["patente_nacional"],
                    patente_empresa=row["patente_empresa"],
                    tipo_vehiculo=row["tipo_vehiculo"] or None,
                    empresa=row["empresa"],
                    device_id=row["device_id"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} vehículos insertados"

def cargar_person_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'zenit_person.csv')
    if not os.path.exists(path):
        return "Archivo zenit_person.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["id"] = df["id"].astype(int)
    df["device_id"] = df["device_id"].apply(lambda x: int(x) if pd.notna(x) else None)

    print(f"[🔍] Total personas leídas: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertadas = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Person(
                    id=row["id"],
                    device_id=row["device_id"],
                    nombres=row["nombres"],
                    apellidos=row["apellidos"],
                    rut=row["rut"],
                    empresa=row["empresa"],
                    cargo=row["cargo"],
                    correo=row["correo"],
                    telefono=row["telefono"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertadas += len(objetos)
            print(f"[✅] Insertados: {total_insertadas}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertadas} personas insertadas"

def cargar_visualization_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'zenit_visualization.csv')
    if not os.path.exists(path):
        return "Archivo zenit_visualization.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de columnas
    df["last_updated"] = pd.to_datetime(df["last_updated"], errors="coerce")
    df["initial_updated"] = pd.to_datetime(df["initial_updated"], errors="coerce")

    for col in ["device_id", "last_ur_id", "initial_ur_id", "previous_ur_id"]:
        if col in df.columns:
            df[col] = df[col].apply(lambda x: int(x) if pd.notna(x) else None)

    print(f"[🔍] Total visualizaciones leídas: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Visualization(
                    device_id=row["device_id"],
                    previous_ur_id=row["previous_ur_id"] if not np.isnan(row["previous_ur_id"]) else None,
                    initial_ur_id=row["initial_ur_id"] if not np.isnan(row["initial_ur_id"]) else None,
                    initial_updated=row["initial_updated"],
                    last_ur_id=row["last_ur_id"],
                    last_updated=row["last_updated"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} visualizaciones insertadas"

def cargar_proximitylog_csv(db: Session, chunk_size: int = 50000):
    import pandas as pd
    import os

    path = os.path.join(CSV_FOLDER, 'zenit_proximitylog.csv')
    if not os.path.exists(path):
        return "Archivo zenit_proximitylog.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')  # ⚠️ no uses .head(max_rows)

    # Conversión de tipos
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["distance"] = df["distance"].astype(float)
    df["status"] = df["status"].astype(bool)
    df["ur_device_id"] = df["ur_device_id"].astype(int)
    df["detected_device_id"] = df["detected_device_id"].astype(int)

    print(f"[🔍] Total registros leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                ProximityLog(
                    timestamp=row["timestamp"],
                    distance=row["distance"],
                    status=row["status"],
                    ur_device_id=row["ur_device_id"],
                    detected_device_id=row["detected_device_id"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} registros de proximidad insertados correctamente"

def cargar_pinglog_csv(db: Session, chunk_size: int = 50000):
    path = os.path.join(CSV_FOLDER, 'zenit_pinglog.csv')
    if not os.path.exists(path):
        return "Archivo zenit_pinglog.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["status"] = df["status"].astype(bool)
    df["device_id"] = df["device_id"].astype(int)

    print(f"[🔍] Total registros leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                PingLog(
                    timestamp=row["timestamp"],
                    status=row["status"],
                    device_id=row["device_id"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} registros de ping insertados"


def cargar_zone_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'zenit_zone.csv')
    if not os.path.exists(path):
        return "Archivo zenit_zone.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["name"] = df["name"].astype(str)
    df["location_area"] = df["location_area"].astype(str)

    print(f"[🔍] Total zonas leídas: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Zone(
                    name=row["name"],
                    location_area=row["location_area"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} zonas insertadas"

def cargar_datalog_csv(db: Session, chunk_size: int = 50000):
    path = os.path.join(CSV_FOLDER, 'zenit_datalog.csv')
    if not os.path.exists(path):
        return "Archivo zenit_datalog.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["data_type"] = df["data_type"].astype(str)
    df["value"] = df["value"].astype(float)
    df["value_type"] = df["value_type"].astype(str)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df["sensor_device_id"] = df["sensor_device_id"].astype(int)
    df["ur_device_id"] = df["ur_device_id"].astype(int)
    df["status"] = df["status"].astype(bool)

    print(f"[🔍] Total datalogs leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                DataLog(
                    data_type=row["data_type"],
                    value=row["value"],
                    value_type=row["value_type"],
                    timestamp=row["timestamp"],
                    sensor_device_id=row["sensor_device_id"],
                    ur_device_id=row["ur_device_id"],
                    status=row["status"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} datalogs insertados"

def cargar_sensor_csv(db: Session, chunk_size: int = 10000):
    path = os.path.join(CSV_FOLDER, 'zenit_sensor.csv')
    if not os.path.exists(path):
        return "Archivo zenit_sensor.csv no encontrado"

    print(f"[📥] Cargando archivo: {path}")
    df = pd.read_csv(path, encoding='latin1')

    # Conversión de tipos
    df["name"] = df["name"].astype(str)
    df["model"] = df["model"].astype(str)
    df["datasheet"] = df["datasheet"].astype(str)

    print(f"[🔍] Total sensores leídos: {len(df)}")
    print("[⚙️] Iniciando carga por bloques...")

    total_insertados = 0
    for start in range(0, len(df), chunk_size):
        end = start + chunk_size
        chunk = df.iloc[start:end]

        try:
            objetos = [
                Sensor(
                    name=row["name"],
                    model=row["model"],
                    datasheet=row["datasheet"]
                )
                for _, row in chunk.iterrows()
            ]

            db.bulk_save_objects(objetos)
            db.commit()
            total_insertados += len(objetos)
            print(f"[✅] Insertados: {total_insertados}/{len(df)}")

        except Exception as e:
            db.rollback()
            print(f"[❌] Error en bloque {start}-{end}: {e}")

    return f"{total_insertados} sensores insertados"