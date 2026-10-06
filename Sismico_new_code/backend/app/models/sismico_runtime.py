from sqlalchemy import Column, BigInteger, String, DateTime, Integer, Text, ForeignKey, JSON, Boolean, func
from app.db.base import Base


class SismicoSyncRun(Base):
    __tablename__ = "sismico_sync_run"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    remote_endpoint_id = Column(BigInteger, ForeignKey("remote_endpoint.id"), nullable=True)
    trigger_type = Column(String(20), nullable=False, default="manual")
    status = Column(String(20), nullable=False, default="running")
    source_status = Column(String(20), nullable=False, default="unknown")
    records_found = Column(Integer, nullable=True)
    records_mapped = Column(Integer, nullable=True)
    alerts_generated = Column(Integer, nullable=False, default=0)
    raw_payload_excerpt = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)


class ObjectCurrentState(Base):
    __tablename__ = "object_current_state"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False, unique=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    state_code = Column(String(20), nullable=False, default="unknown")
    raw_value = Column(String(120), nullable=True)
    source_name = Column(String(120), nullable=True)
    source_status = Column(String(20), nullable=False, default="unknown")
    observed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ObjectStateEvent(Base):
    __tablename__ = "object_state_event"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    sync_run_id = Column(BigInteger, ForeignKey("sismico_sync_run.id"), nullable=True)
    state_code = Column(String(20), nullable=False)
    raw_value = Column(String(120), nullable=True)
    source_name = Column(String(120), nullable=True)
    observed_at = Column(DateTime(timezone=True), nullable=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SemaforoDevice(Base):
    __tablename__ = "semaforo_device"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    code = Column(String(80), nullable=False, unique=True)
    name = Column(String(150), nullable=False)
    ip = Column(String(80), nullable=False)
    plc_type = Column(String(50), nullable=False, default="delta")
    profile = Column(String(50), nullable=False, default="delta")
    port = Column(Integer, nullable=False, default=502)
    unit_id = Column(Integer, nullable=False, default=1)
    enabled = Column(Boolean, nullable=False, default=True)
    tags_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SemaforoRule(Base):
    __tablename__ = "semaforo_rule"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    code = Column(String(80), nullable=False, unique=True)
    name = Column(String(180), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    action_enabled = Column(Boolean, nullable=False, default=False)
    trigger_source = Column(String(80), nullable=False, default="remote_state")
    target_state_code = Column(String(20), nullable=False, default="critical")
    min_consecutive_polls = Column(Integer, nullable=False, default=1)
    dwell_seconds = Column(Integer, nullable=False, default=60)
    command_on_trigger = Column(String(20), nullable=False, default="rojo")
    command_on_recover = Column(String(20), nullable=False, default="verde")
    allow_touch_traffic = Column(Boolean, nullable=False, default=False)
    site_scope_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SemaforoActionLog(Base):
    __tablename__ = "semaforo_action_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    sync_run_id = Column(BigInteger, ForeignKey("sismico_sync_run.id"), nullable=True)
    semaforo_rule_id = Column(BigInteger, ForeignKey("semaforo_rule.id"), nullable=True)
    semaforo_device_id = Column(BigInteger, ForeignKey("semaforo_device.id"), nullable=True)
    action = Column(String(20), nullable=False)
    requested_by = Column(String(80), nullable=False, default="system")
    execution_status = Column(String(20), nullable=False, default="pending")
    command_line = Column(Text, nullable=True)
    stdout = Column(Text, nullable=True)
    stderr = Column(Text, nullable=True)
    executed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ControlPolygon(Base):
    __tablename__ = "control_polygon"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    site_map_id = Column(BigInteger, ForeignKey("site_map.id"), nullable=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False, unique=True)
    polygon_code = Column(String(120), nullable=False, unique=True)
    polygon_name = Column(String(180), nullable=False)
    plane_code = Column(String(120), nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ControlPolygonPlc(Base):
    __tablename__ = "control_polygon_plc"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    control_polygon_id = Column(BigInteger, ForeignKey("control_polygon.id"), nullable=False)
    semaforo_device_id = Column(BigInteger, ForeignKey("semaforo_device.id"), nullable=False)
    execution_order = Column(Integer, nullable=False, default=1)
    enabled = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ControlStateMatrix(Base):
    __tablename__ = "control_state_matrix"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    control_polygon_id = Column(BigInteger, ForeignKey("control_polygon.id"), nullable=False)
    semaforo_device_id = Column(BigInteger, ForeignKey("semaforo_device.id"), nullable=False)
    target_state = Column(String(40), nullable=False)
    signal_code = Column(String(40), nullable=False)
    signal_value = Column(Integer, nullable=False, default=1)
    action_mode = Column(String(20), nullable=False, default="write")
    pulse_ms = Column(Integer, nullable=True)
    execution_order = Column(Integer, nullable=False, default=1)
    exclusive_group = Column(String(120), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ControlEmergencyMatrix(Base):
    __tablename__ = "control_emergency_matrix"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    scope_type = Column(String(20), nullable=False, default="site")
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    control_polygon_id = Column(BigInteger, ForeignKey("control_polygon.id"), nullable=True)
    semaforo_device_id = Column(BigInteger, ForeignKey("semaforo_device.id"), nullable=False)
    signal_code = Column(String(40), nullable=False)
    signal_value = Column(Integer, nullable=False, default=1)
    action_mode = Column(String(20), nullable=False, default="write")
    pulse_ms = Column(Integer, nullable=True)
    execution_order = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ControlResetMatrix(Base):
    __tablename__ = "control_reset_matrix"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=False)
    control_polygon_id = Column(BigInteger, ForeignKey("control_polygon.id"), nullable=True)
    semaforo_device_id = Column(BigInteger, ForeignKey("semaforo_device.id"), nullable=False)
    signal_code = Column(String(40), nullable=False)
    signal_value = Column(Integer, nullable=False, default=0)
    action_mode = Column(String(20), nullable=False, default="write")
    pulse_ms = Column(Integer, nullable=True)
    execution_order = Column(Integer, nullable=False, default=1)
    is_active = Column(Boolean, nullable=False, default=True)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ControlAuditLog(Base):
    __tablename__ = "control_audit_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    request_id = Column(String(80), nullable=False, unique=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    site_code = Column(String(80), nullable=True)
    plane_code = Column(String(120), nullable=True)
    polygon_code = Column(String(120), nullable=True)
    action_type = Column(String(40), nullable=False, default="state_change")
    target_state = Column(String(40), nullable=True)
    requested_by = Column(String(120), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    resolved_payload_json = Column(JSON, nullable=False, default=dict)
    execution_payload_json = Column(JSON, nullable=False, default=dict)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ControlAuditLogDetail(Base):
    __tablename__ = "control_audit_log_detail"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    audit_log_id = Column(BigInteger, ForeignKey("control_audit_log.id"), nullable=False)
    semaforo_device_id = Column(BigInteger, ForeignKey("semaforo_device.id"), nullable=True)
    device_ip = Column(String(80), nullable=True)
    signal_code = Column(String(40), nullable=False)
    signal_value = Column(Integer, nullable=False, default=0)
    action_mode = Column(String(20), nullable=False, default="write")
    pulse_ms = Column(Integer, nullable=True)
    execution_order = Column(Integer, nullable=False, default=1)
    status = Column(String(20), nullable=False, default="pending")
    stdout = Column(Text, nullable=True)
    stderr = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
