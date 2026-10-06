from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Index,BigInteger,UniqueConstraint
from sqlalchemy.orm import relationship
from app.legacy.telemining.database import Base

CLIENT_CHOICES = (
    ('gardilcic', 'Gardilcic'),
    ('salfa', 'Salfa Montajes'),
    ('zublin', 'Züblin'),
    ('vp', 'Codelco VP'),
    ('codelco', 'CODELCO'),
    ('telemining', 'TELEMINING')
)

class Zone(Base):
    __tablename__ = 'zenit_zone'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    location_area = Column(String(100))

class Device(Base):
    __tablename__ = 'zenit_device'
    id = Column(BigInteger, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, nullable=False)
    name = Column(String(100))
    device_type = Column(String(50), default='zenit-ur')
    client = Column(String(50), default='gardilcic')
    ip = Column(String(100), default='0.0.0.0')
    mac_address = Column(String(100), default='')
    zone_id = Column(Integer,ForeignKey('zenit_zone.id'),nullable = True)
    location = Column(String(100),nullable = True)
    nivel = Column(String(20), default='NP')
    sensores = Column(Boolean, default=False)
    zone = relationship("Zone", backref="devices")  # acceso device.zone y zone.devices
    visualizations = relationship(
        "Visualization",
        foreign_keys="Visualization.device_id",
        back_populates="device"
    )

class Vehicle(Base):
    __tablename__ = 'zenit_vehicle'
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer,ForeignKey('zenit_device.id'), unique=True)
    patente_nacional = Column(String(100))
    patente_empresa = Column(String(100))
    tipo_vehiculo = Column(String(100), default='camioneta')
    empresa = Column(String(100), default='telemining')
    device = relationship("Device", backref="vehicle", uselist=False)

class Person(Base):
    __tablename__ = 'zenit_person'
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer,ForeignKey('zenit_device.id'), unique=True)
    nombres = Column(String(100))
    apellidos = Column(String(100))
    rut = Column(String(13))
    empresa = Column(String(100))
    cargo = Column(String(100))
    correo = Column(String(100))
    telefono = Column(String(20))
    device = relationship("Device", backref="person", uselist=False)

class Visualization(Base):
    __tablename__ = 'zenit_visualization'
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer,ForeignKey('zenit_device.id'), unique=True)
    previous_ur_id = Column(Integer,ForeignKey('zenit_device.id'), nullable=True)
    initial_ur_id = Column(Integer,ForeignKey('zenit_device.id'), nullable=True)
    initial_updated = Column(DateTime)
    last_ur_id = Column(Integer,ForeignKey('zenit_device.id'), nullable=True)
    last_updated = Column(DateTime)
    device = relationship("Device", foreign_keys=[device_id], back_populates="visualizations")
    previous_ur = relationship("Device", foreign_keys=[previous_ur_id])
    initial_ur = relationship("Device", foreign_keys=[initial_ur_id])
    last_ur = relationship("Device", foreign_keys=[last_ur_id])
    __table_args__ = (
        Index('ix_visualization_device_lastur', 'device_id', 'last_ur_id'),
    )

class Sensor(Base):
    __tablename__ = 'zenit_sensor'
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    model = Column(String(100))
    datasheet = Column(String(200))

class DataLog(Base):
    __tablename__ = 'zenit_datalog'
    id = Column(Integer, primary_key=True, index=True)
    sensor_device_id = Column(Integer,ForeignKey('zenit_sensor.id'))
    ur_device_id = Column(Integer,ForeignKey('zenit_device.id'))
    data_type = Column(String(50))
    value = Column(Float)
    value_type = Column(String(50))
    timestamp = Column(DateTime)
    status = Column(Boolean, default=False)
    sensor_device = relationship("Sensor", backref="datalogs")
    ur_device = relationship("Device", backref="sensor_logs")

class ProximityLog(Base):
    __tablename__ = 'zenit_proximitylog'
    id = Column(Integer, primary_key=True, index=True)
    ur_device_id = Column(Integer, ForeignKey('zenit_device.id'))
    detected_device_id = Column(Integer, ForeignKey('zenit_device.id'))
    timestamp = Column(DateTime)
    distance = Column(Float)
    status = Column(Boolean, default=False)
    ur_device = relationship("Device", foreign_keys=[ur_device_id], backref="proximity_logs_as_ur")
    detected_device = relationship("Device", foreign_keys=[detected_device_id], backref="proximity_logs_as_detected")

class PingLog(Base):
    __tablename__ = 'zenit_pinglog'
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey('zenit_device.id'))
    timestamp = Column(DateTime)
    status = Column(Boolean, default=False)
    device = relationship("Device", backref="ping_logs")

class Permanencia(Base):
    __tablename__ = "zenit_permanencia"
    id = Column(BigInteger, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False)
    location = Column(Integer, nullable=False)   # UR actual
    device_id = Column(Integer, nullable=False)  # detected device
    time = Column(Float, nullable=False)  # minutos

    __table_args__ = (
        UniqueConstraint("timestamp", "location", "device_id", name="uq_permanencia_ts_loc_dev"),
    )

class Traslados(Base):
    __tablename__ = "zenit_traslados"
    id = Column(BigInteger, primary_key=True, index=True)
    timestamp = Column(DateTime, nullable=False)
    location = Column(Integer, nullable=False)   # UR actual
    device_id = Column(Integer, nullable=False)  # detected device
    end_timestamp = Column(DateTime, nullable=False)  # timestamp when the device left the UR
    destiny = Column(Integer, nullable=False)  # UR where the device was moved
    time = Column(Float, nullable=False)  # minutos

    __table_args__ = (
        UniqueConstraint("timestamp", "location", "device_id","destiny", name="uq_traslados_ts_loc_dev"),
    )