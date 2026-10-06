"""
Catálogo de consultas SQL de sistema para el Agente IA de ZENIT.

Cada consulta define:
- id lógico
- palabras clave (keywords) para emparejar la pregunta en lenguaje natural
- tablas involucradas
- columnas de salida (select_columns)
- base_sql (FROM / JOIN / WHERE 1=1)
- filtros soportados (filters)
- configuración de salida por defecto (tabla / gráfico)

Además provee:
- MCPFilter: modelo de filtro normalizado
- parse_date_safe / parse_time_safe: parseo robusto de fechas/horas
- resolve_filter_field: mapea nombres de columnas "humanos" a columnas reales
- build_sql_with_filters: arma el SQL final + parámetros
- find_system_query: selecciona consulta según keywords

Este módulo es consumido por el router del Agente IA (mcp.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Literal, Tuple

from unidecode import unidecode


# ------------------------------ Tipos ------------------------------

FilterType = Literal["string", "int", "bool", "datetime_range", "time_range", "enum"]


@dataclass
class MCPFilter:
    """
    Filtro normalizado que se aplicará sobre una consulta de sistema.

    field: nombre lógico del filtro (persona, empresa, portico, fecha, etc.)
    type:  tipo de dato (string/int/bool/datetime_range/time_range/enum)
    op:    operador ("eq", "ilike", "between", etc.)
    value: para filtros simples
    value_from / value_to: para rangos (fecha/hora)
    """

    field: str
    type: FilterType
    op: str
    value: Optional[Any] = None
    value_from: Optional[Any] = None
    value_to: Optional[Any] = None


def _norm(text: str) -> str:
    """Normaliza texto para comparaciones sin tildes y minúsculas."""
    return unidecode(text.lower().strip()) if text is not None else ""


# ------------------------------ Parse helpers ------------------------------


def parse_date_safe(value: str) -> Optional[date]:
    """
    Intenta parsear una fecha en formatos típicos (dd-mm-YYYY, YYYY-mm-dd, dd/mm/YYYY).
    Si falla, devuelve None.
    """
    if not value:
        return None
    value = value.strip()
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_time_safe(value: str) -> Optional[time]:
    """
    Intenta parsear hora en formatos típicos (HH:MM, HH:MM:SS) y con sufijos am/pm.
    """
    if not value:
        return None

    v = value.strip().lower().replace("hs", "")
    v = v.replace(" ", "")

    # soportar "10pm", "10:30pm"
    if v.endswith("am") or v.endswith("pm"):
        suffix = v[-2:]
        core = v[:-2]
        if ":" not in core:
            core = f"{core}:00"
        try:
            t = datetime.strptime(core, "%H:%M").time()
        except ValueError:
            return None
        if suffix == "pm" and t.hour < 12:
            return time(t.hour + 12, t.minute, t.second)
        if suffix == "am" and t.hour == 12:
            return time(0, t.minute, t.second)
        return t

    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(v, fmt).time()
        except ValueError:
            continue
    return None


# ------------------------------ Resolución de filtros ------------------------------


def resolve_filter_field(
    field: str, allowed_filters: Dict[str, Dict[str, Any]]
) -> Tuple[Optional[str], List[str]]:
    """
    Intenta mapear un nombre de filtro libre a uno de los filtros soportados
    por la consulta. Devuelve (campo_resuelto, mensajes_info).

    Si no se puede resolver, field_resuelto = None y se devuelve un mensaje
    explicando qué columnas están disponibles.
    """
    msgs: List[str] = []
    normalized = _norm(field)

    if not normalized:
        return None, msgs

    # 1) match directo por key
    if normalized in allowed_filters:
        return normalized, msgs

    # 2) por synonyms
    for name, meta in allowed_filters.items():
        synonyms = [_norm(s) for s in meta.get("synonyms", [])]
        if normalized in synonyms:
            msgs.append(f"Interpreté el filtro '{field}' como la columna lógica '{name}'.")
            return name, msgs

    # 3) fuzzy simple (contains)
    candidates = []
    for name in allowed_filters:
        n = _norm(name)
        if normalized in n or n in normalized:
            candidates.append(name)

    if len(candidates) == 1:
        msgs.append(
            f"No encontré la columna '{field}' exactamente, usé '{candidates[0]}' por similitud."
        )
        return candidates[0], msgs

    # 4) no se pudo resolver
    disponibles = ", ".join(sorted(allowed_filters.keys()))
    msgs.append(
        f"No tengo una columna compatible con '{field}'. "
        f"Columnas disponibles para esta consulta: {disponibles}."
    )
    return None, msgs


def build_sql_with_filters(
    system_query: Dict[str, Any], filters: List[MCPFilter]
) -> Tuple[str, Dict[str, Any], List[str]]:
    """
    Construye el SQL final y los parámetros seguros a partir de:
    - la consulta base (base_sql + select_columns)
    - la lista de MCPFilter
    """
    select_clause = "SELECT " + ", ".join(system_query["select_columns"])
    sql = select_clause + " " + system_query["base_sql"]
    params: Dict[str, Any] = {}
    meta_filters = system_query.get("filters", {})
    info_msgs: List[str] = []

    for i, f in enumerate(filters):
        field_resuelto, msgs = resolve_filter_field(f.field, meta_filters)
        info_msgs.extend(msgs)

        if not field_resuelto:
            # No se pudo mapear este filtro → lo ignoramos pero explicamos en answer
            continue

        meta = meta_filters[field_resuelto]
        col = meta["column"]
        param_suffix = f"_{i}"

        ftype = meta.get("type", f.type)

        if ftype == "string":
            # Usamos f.op, típicamente "ilike" o "eq"
            if f.op == "ilike":
                sql += f" AND {col} ILIKE :{field_resuelto}{param_suffix}"
                params[f"{field_resuelto}{param_suffix}"] = f"%{f.value}%"
            else:  # eq por defecto
                sql += f" AND {col} = :{field_resuelto}{param_suffix}"
                params[f"{field_resuelto}{param_suffix}"] = f.value

        elif ftype == "int":
            sql += f" AND {col} = :{field_resuelto}{param_suffix}"
            params[f"{field_resuelto}{param_suffix}"] = int(f.value)

        elif ftype == "bool":
            sql += f" AND {col} = :{field_resuelto}{param_suffix}"
            params[f"{field_resuelto}{param_suffix}"] = bool(f.value)

        elif ftype == "enum":
            sql += f" AND {col} = :{field_resuelto}{param_suffix}"
            params[f"{field_resuelto}{param_suffix}"] = f.value

        elif ftype == "datetime_range":
            if f.value_from:
                sql += f" AND {col} >= :{field_resuelto}_from{param_suffix}"
                params[f"{field_resuelto}_from{param_suffix}"] = f.value_from
            if f.value_to:
                # +1 día para incluir la fecha completa
                sql += f" AND {col} < :{field_resuelto}_to{param_suffix}"
                params[f"{field_resuelto}_to{param_suffix}"] = f.value_to + timedelta(
                    days=1
                )

        elif ftype == "time_range":
            # Comparamos sólo la hora (columna timestamptz ::time)
            if f.value_from:
                sql += f" AND {col}::time >= :{field_resuelto}_from{param_suffix}"
                params[f"{field_resuelto}_from{param_suffix}"] = f.value_from
            if f.value_to:
                sql += f" AND {col}::time <= :{field_resuelto}_to{param_suffix}"
                params[f"{field_resuelto}_to{param_suffix}"] = f.value_to

    # NUEVO: si la consulta define group_by, lo aplicamos aquí
    group_by = system_query.get("group_by")
    if group_by:
        sql += f" GROUP BY {group_by}"

    # Orden por defecto si se definió
    order_by = system_query.get("order_by")
    if order_by:
        sql += f" ORDER BY {order_by}"

    return sql, params, info_msgs



# ------------------------------ Consultas de sistema ------------------------------

SYSTEM_QUERIES: List[Dict[str, Any]] = []

# ---------------------------------------------------------------------------
# 1) Personas por empresa (listame las personas de la empresa CODELCO)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "personas_por_empresa",
        "keywords": [
            "personas de la empresa",
            "trabajadores de la empresa",
            "personal de la empresa",
            "listame las personas de la empresa",
        ],
        "description": "Lista personas de una empresa dada, con cargo y cuadrilla.",
        "tables": ["person", "company"],
        "select_columns": [
            "p.full_name AS persona",
            "p.rut",
            "c.name AS empresa",
            "p.position AS cargo",
            "p.group_name AS cuadrilla",
            "p.active",
        ],
        "base_sql": """
            FROM person p
            JOIN company c ON c.id = p.company_id
            WHERE 1=1
        """,
        "filters": {
            "empresa": {
                "column": "c.name",
                "type": "string",
                "synonyms": ["empresa", "compañia", "compania"],
            },
            "rut": {
                "column": "p.rut",
                "type": "string",
                "synonyms": ["rut"],
            },
            "cargo": {
                "column": "p.position",
                "type": "string",
                "synonyms": ["cargo", "rol"],
            },
            "cuadrilla": {
                "column": "p.group_name",
                "type": "string",
                "synonyms": ["cuadrilla", "grupo"],
            },
            "activos": {
                "column": "p.active",
                "type": "bool",
                "synonyms": ["activos", "solo activos"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Personas por empresa",
        },
        "default_chart": None,
        "order_by": "persona",
    }
)

# ---------------------------------------------------------------------------
# 2) Búsqueda general de personas (por nombre / empresa / cuadrilla)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "buscar_personas",
        "keywords": [
            "listame las personas",
            "buscar persona",
            "buscar personas",
            "trabajadores",
            "personal",
        ],
        "description": "Listado general de personas filtrable por nombre, empresa, cargo, cuadrilla.",
        "tables": ["person", "company"],
        "select_columns": [
            "p.full_name AS persona",
            "p.rut",
            "c.name AS empresa",
            "p.position AS cargo",
            "p.group_name AS cuadrilla",
            "p.active",
        ],
        "base_sql": """
            FROM person p
            LEFT JOIN company c ON c.id = p.company_id
            WHERE 1=1
        """,
        "filters": {
            "persona": {
                "column": "p.full_name",
                "type": "string",
                "synonyms": ["persona", "nombre", "trabajador", "operario"],
            },
            "empresa": {
                "column": "c.name",
                "type": "string",
                "synonyms": ["empresa"],
            },
            "cuadrilla": {
                "column": "p.group_name",
                "type": "string",
                "synonyms": ["cuadrilla", "grupo"],
            },
            "cargo": {
                "column": "p.position",
                "type": "string",
                "synonyms": ["cargo", "rol"],
            },
            "activos": {
                "column": "p.active",
                "type": "bool",
                "synonyms": ["activos"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Personas",
        },
        "default_chart": None,
        "order_by": "persona",
    }
)

# ---------------------------------------------------------------------------
# 3) Entradas de persona a pórtico (con fecha/hora)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "entradas_persona_portico",
        "keywords": [
            "entradas de",
            "ingresos de",
            "accesos de",
            "eventos de ingreso de",
        ],
        "description": "Eventos de acceso de una persona en uno o más pórticos.",
        "tables": ["person", "tag_assignment", "tag", "access_event", "access_portico"],
        "select_columns": [
            "ae.ts_ingested AS fecha_hora",
            "p.full_name    AS persona",
            "c.name         AS empresa",
            "ap.name        AS portico",
            "ap.zone        AS zona",
            "ae.direction   AS direccion",
        ],
        "base_sql": """
            FROM access_event ae
            JOIN tag t              ON t.id = ae.tag_id
            JOIN tag_assignment ta  ON ta.tag_id = t.id
            JOIN person p           ON p.id = ta.entity_id
            LEFT JOIN company c     ON c.id = p.company_id
            LEFT JOIN gateway g     ON g.id = ae.gateway_id
            LEFT JOIN access_portico ap ON ap.gateway_id = g.id
            WHERE 1=1
              AND ta.entity_type = 'person'
              AND ta.active = TRUE
              AND (ta.valid_to IS NULL OR ta.valid_to >= now())
        """,
        "filters": {
            "persona": {
                "column": "p.full_name",
                "type": "string",
                "synonyms": ["persona", "trabajador", "operario", "nombre"],
            },
            "rut": {
                "column": "p.rut",
                "type": "string",
                "synonyms": ["rut"],
            },
            "empresa": {
                "column": "c.name",
                "type": "string",
                "synonyms": ["empresa"],
            },
            "portico": {
                "column": "ap.name",
                "type": "string",
                "synonyms": ["pórtico", "portico", "puerta"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "poligono", "polígono"],
            },
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["fecha", "día", "rango de fechas", "semana", "mes"],
            },
            "hora": {
                "column": "ae.ts_ingested",
                "type": "time_range",
                "synonyms": ["hora", "horario"],
            },
            "direccion": {
                "column": "ae.direction",
                "type": "enum",
                "values": ["in", "out"],
                "synonyms": ["entradas", "salidas"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Entradas de persona por pórtico",
        },
        "default_chart": {
            "type": "timeline",
            "x": "fecha_hora",
            "group_by": "portico",
        },
        "order_by": "fecha_hora ASC",
    }
)

# ---------------------------------------------------------------------------
# 4) Entradas de vehículo a pórtico
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "entradas_vehiculo_portico",
        "keywords": [
            "entradas del vehiculo",
            "entradas del vehículo",
            "ingresos del vehiculo",
            "ingresos del vehículo",
            "accesos del camion",
            "accesos del camión",
        ],
        "description": "Eventos de acceso de un vehículo en uno o más pórticos.",
        "tables": ["vehicles", "tag_assignment", "tag", "access_event", "access_portico"],
        "select_columns": [
            "ae.ts_ingested AS fecha_hora",
            "v.patente      AS vehiculo",
            "vc.name        AS empresa_vehiculo",
            "ap.name        AS portico",
            "ap.zone        AS zona",
            "ae.direction   AS direccion",
        ],
        "base_sql": """
            FROM access_event ae
            JOIN tag t              ON t.id = ae.tag_id
            JOIN tag_assignment ta  ON ta.tag_id = t.id
            JOIN vehicles v         ON v.id = ta.entity_id
            LEFT JOIN vehicle_company vc_rel ON vc_rel.vehicle_id = v.id AND vc_rel.active = TRUE
            LEFT JOIN company vc    ON vc.id = vc_rel.company_id
            LEFT JOIN gateway g     ON g.id = ae.gateway_id
            LEFT JOIN access_portico ap ON ap.gateway_id = g.id
            WHERE 1=1
              AND ta.entity_type = 'vehicle'
              AND ta.active = TRUE
              AND (ta.valid_to IS NULL OR ta.valid_to >= now())
        """,
        "filters": {
            "vehiculo": {
                "column": "v.patente",
                "type": "string",
                "synonyms": ["vehículo", "vehiculo", "camion", "camión", "patente"],
            },
            "empresa": {
                "column": "vc.name",
                "type": "string",
                "synonyms": ["empresa", "empresa vehículo", "empresa vehiculo"],
            },
            "portico": {
                "column": "ap.name",
                "type": "string",
                "synonyms": ["pórtico", "portico", "puerta"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "ur", "poligono", "polígono"],
            },
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["fecha", "día", "rango de fechas", "semana", "mes"],
            },
            "hora": {
                "column": "ae.ts_ingested",
                "type": "time_range",
                "synonyms": ["hora", "horario"],
            },
            "direccion": {
                "column": "ae.direction",
                "type": "enum",
                "values": ["in", "out"],
                "synonyms": ["entradas", "salidas"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Entradas de vehículo por pórtico",
        },
        "default_chart": {
            "type": "timeline",
            "x": "fecha_hora",
            "group_by": "portico",
        },
        "order_by": "fecha_hora ASC",
    }
)

# ---------------------------------------------------------------------------
# 5) Trazado de vehículo (ruta por zonas / pórticos en un rango de fechas)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "trazado_vehiculo",
        "keywords": [
            "por dónde se movió el camion",
            "por donde se movio el camion",
            "trazado del vehiculo",
            "trazado del vehículo",
            "recorrido del vehiculo",
            "recorrido del vehículo",
        ],
        "description": "Secuencia de eventos de un vehículo con zona / pórtico / tiempo.",
        "tables": ["vehicles", "tag_assignment", "tag", "access_event", "access_portico"],
        "select_columns": [
            "ae.ts_ingested AS fecha_hora",
            "v.patente      AS vehiculo",
            "ap.site        AS sitio",
            "ap.zone        AS zona",
            "ap.name        AS portico",
            "ae.direction   AS direccion",
            "ae.level       AS nivel_logico",
        ],
        "base_sql": """
            FROM access_event ae
            JOIN tag t              ON t.id = ae.tag_id
            JOIN tag_assignment ta  ON ta.tag_id = t.id
            JOIN vehicles v         ON v.id = ta.entity_id
            LEFT JOIN gateway g     ON g.id = ae.gateway_id
            LEFT JOIN access_portico ap ON ap.gateway_id = g.id
            WHERE 1=1
              AND ta.entity_type = 'vehicle'
              AND ta.active = TRUE
        """,
        "filters": {
            "vehiculo": {
                "column": "v.patente",
                "type": "string",
                "synonyms": ["vehículo", "vehiculo", "camion", "camión", "patente"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "ur", "poligono", "polígono"],
            },
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["fecha", "rango de fechas", "día", "semana", "mes"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Trazado de vehículo",
        },
        "default_chart": {
            "type": "timeline",
            "x": "fecha_hora",
            "group_by": "zona",
        },
        "order_by": "fecha_hora ASC",
    }
)

# ---------------------------------------------------------------------------
# 6) Interior actual (personas / vehículos dentro)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "interior_actual",
        "keywords": [
            "donde estan las personas ahora",
            "dónde están las personas ahora",
            "quién está dentro",
            "quien esta dentro",
            "personas dentro",
            "vehiculos dentro",
            "vehículos dentro",
        ],
        "description": "Personas y vehículos actualmente dentro por pórtico/zona.",
        "tables": ["vw_access_interior"],
        "select_columns": [
            "portico_name",
            "entity_type",
            "display_name",
            "person_company_name",
            "person_position",
            "vehicle_patente",
            "vehicle_company_name",
            "ts_last AS ultima_lectura",
            "zone",
        ],
        "base_sql": """
            FROM vw_access_interior
            WHERE 1=1
        """,
        "filters": {
            "empresa": {
                "column": "COALESCE(person_company_name, vehicle_company_name)",
                "type": "string",
                "synonyms": ["empresa"],
            },
            "portico": {
                "column": "portico_name",
                "type": "string",
                "synonyms": ["pórtico", "portico"],
            },
            "tipo": {
                "column": "entity_type",
                "type": "enum",
                "values": ["person", "vehicle"],
                "synonyms": ["personas", "vehículos", "vehiculos", "vehículo", "vehiculo"],
            },
            "zona": {
                "column": "zone",
                "type": "string",
                "synonyms": ["zona", "poligono", "polígono"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Personas y vehículos dentro actualmente",
        },
        "default_chart": {
            "type": "bar",
            "x": "portico_name",
            "y": "count(*)",
        },
        "order_by": "portico_name, display_name",
    }
)

# ---------------------------------------------------------------------------
# 7) Contadores por pórtico (total / in / out)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "contadores_portico",
        "keywords": [
            "grafico de vehiculos",
            "gráfico de vehículos",
            "conteo de vehiculos por portico",
            "conteo de vehículos por pórtico",
            "contadores de porticos",
            "contadores de pórticos",
        ],
        "description": "Contadores de eventos por pórtico (total / in / out).",
        "tables": ["vw_access_portico_counters"],
        "select_columns": [
            "portico_name",
            "total_events",
            "total_in",
            "total_out",
            "last_event_at",
        ],
        "base_sql": """
            FROM vw_access_portico_counters
            WHERE 1=1
        """,
        "filters": {
            "portico": {
                "column": "portico_name",
                "type": "string",
                "synonyms": ["pórtico", "portico"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Contadores por pórtico",
        },
        "default_chart": {
            "type": "bar",
            "x": "portico_name",
            "y": "total_in",
        },
        "order_by": "portico_name",
    }
)

# ---------------------------------------------------------------------------
# 8) Vueltas de vehículo por zona/UR/pórtico
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "vueltas_vehiculo_ur",
        "keywords": [
            "cuantas vueltas hizo el camion",
            "cuántas vueltas hizo el camión",
            "vueltas por ur",
            "vueltas del vehiculo",
            "vueltas del vehículo",
        ],
        "description": "Número de 'vueltas' de un vehículo en UR/zona/pórtico (entradas/salidas).",
        "tables": [
            "vehicles",
            "tag_assignment",
            "tag",
            "access_event",
            "access_portico",
        ],
        "select_columns": [
            "v.patente        AS vehiculo",
            "ap.name          AS portico",
            "ap.zone          AS zona",
            "COUNT(*) FILTER (WHERE ae.direction = 'in')  AS total_in",
            "COUNT(*) FILTER (WHERE ae.direction = 'out') AS total_out",
        ],
        "base_sql": """
            FROM access_event ae
            JOIN tag t              ON t.id = ae.tag_id
            JOIN tag_assignment ta  ON ta.tag_id = t.id
            JOIN vehicles v         ON v.id = ta.entity_id
            JOIN gateway g          ON g.id = ae.gateway_id
            JOIN access_portico ap  ON ap.gateway_id = g.id
            WHERE 1=1
              AND ta.entity_type = 'vehicle'
              AND ta.active = TRUE
        """,
        "filters": {
            "vehiculo": {
                "column": "v.patente",
                "type": "string",
                "synonyms": ["vehículo", "vehiculo", "camion", "camión", "patente"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "ur"],
            },
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["semana", "mes", "rango de fechas", "fecha"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Vueltas de vehículo por zona/pórtico",
        },
        "default_chart": {
            "type": "bar",
            "x": "portico",
            "y": "total_in",
        },
        "order_by": "vehiculo, portico",
    }
)

# ---------------------------------------------------------------------------
# 9) Ranking de vehículos por vueltas en un periodo
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "ranking_vehiculos_vueltas",
        "keywords": [
            "ordename los vehiculos desde el que hizo mas vueltas",
            "ordéname los vehículos desde el que hizo más vueltas",
            "ranking de vehiculos por vueltas",
            "ranking de vehículos por vueltas",
        ],
        "description": "Ranking de vehículos por cantidad de vueltas (entradas) en un periodo.",
        "tables": [
            "vehicles",
            "tag_assignment",
            "tag",
            "access_event",
            "access_portico",
        ],
        "select_columns": [
            "v.patente        AS vehiculo",
            "COALESCE(vc.name, '') AS empresa_vehiculo",
            "COUNT(*) FILTER (WHERE ae.direction = 'in')  AS total_entradas",
        ],
        "base_sql": """
            FROM access_event ae
            JOIN tag t              ON t.id = ae.tag_id
            JOIN tag_assignment ta  ON ta.tag_id = t.id
            JOIN vehicles v         ON v.id = ta.entity_id
            LEFT JOIN vehicle_company vc_rel ON vc_rel.vehicle_id = v.id AND vc_rel.active = TRUE
            LEFT JOIN company vc    ON vc.id = vc_rel.company_id
            JOIN gateway g          ON g.id = ae.gateway_id
            JOIN access_portico ap  ON ap.gateway_id = g.id
            WHERE 1=1
              AND ta.entity_type = 'vehicle'
              AND ta.active = TRUE
        """,
        "filters": {
            "empresa": {
                "column": "vc.name",
                "type": "string",
                "synonyms": ["empresa", "empresa vehículo", "empresa vehiculo"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "ur"],
            },
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["semana", "mes", "rango de fechas", "fecha"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Ranking de vehículos por vueltas",
        },
        "default_chart": {
            "type": "bar",
            "x": "vehiculo",
            "y": "total_entradas",
        },
        "order_by": "total_entradas DESC",
    }
)

# ---------------------------------------------------------------------------
# 10) Clima por pórtico / variable
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "clima_portico",
        "keywords": [
            "clima",
            "gases",
            "disipacion de gases",
            "disipación de gases",
            "temperatura en el pórtico",
            "temperatura en el portico",
        ],
        "description": "Lecturas de clima por pórtico/variable en un rango de fechas.",
        "tables": [
            "access_portico_climate_reading",
            "access_portico",
            "access_climate_var",
        ],
        "select_columns": [
            "r.ts        AS fecha_hora",
            "ap.name     AS portico",
            "ap.zone     AS zona",
            "cv.code     AS variable_code",
            "cv.name     AS variable",
            "r.value     AS valor",
            "r.level     AS nivel",
        ],
        "base_sql": """
            FROM access_portico_climate_reading r
            JOIN access_portico ap      ON ap.id = r.portico_id
            JOIN access_climate_var cv  ON cv.id = r.climate_var_id
            WHERE 1=1
        """,
        "filters": {
            "portico": {
                "column": "ap.name",
                "type": "string",
                "synonyms": ["pórtico", "portico", "zona"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "ur", "poligono", "polígono"],
            },
            "variable": {
                "column": "cv.code",
                "type": "string",
                "synonyms": ["temperatura", "humedad", "viento", "gas", "variable"],
            },
            "fecha": {
                "column": "r.ts",
                "type": "datetime_range",
                "synonyms": ["última semana", "semana pasada", "mes pasado", "rango de fechas", "fecha"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Lecturas de clima por pórtico",
        },
        "default_chart": {
            "type": "line",
            "x": "fecha_hora",
            "y": "valor",
            "series": "portico",
        },
        "order_by": "fecha_hora ASC",
    }
)

# ---------------------------------------------------------------------------
# 11) Resumen de clima (promedios/min/max) por pórtico y variable
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "clima_resumen",
        "keywords": [
            "resumen de clima",
            "resumen clima del día",
            "resumen clima del dia",
            "promedio de gases",
            "promedio de temperatura",
        ],
        "description": "Resumen de clima (min/max/promedio) por pórtico y variable.",
        "tables": [
            "access_portico_climate_reading",
            "access_portico",
            "access_climate_var",
        ],
        "select_columns": [
            "ap.name     AS portico",
            "ap.zone     AS zona",
            "cv.code     AS variable_code",
            "cv.name     AS variable",
            "MIN(r.value) AS valor_min",
            "MAX(r.value) AS valor_max",
            "AVG(r.value) AS valor_promedio",
        ],
        "base_sql": """
            FROM access_portico_climate_reading r
            JOIN access_portico ap      ON ap.id = r.portico_id
            JOIN access_climate_var cv  ON cv.id = r.climate_var_id
            WHERE 1=1
        """,
        "filters": {
            "portico": {
                "column": "ap.name",
                "type": "string",
                "synonyms": ["pórtico", "portico"],
            },
            "zona": {
                "column": "ap.zone",
                "type": "string",
                "synonyms": ["zona", "ur"],
            },
            "variable": {
                "column": "cv.code",
                "type": "string",
                "synonyms": ["temperatura", "humedad", "viento", "gas", "variable"],
            },
            "fecha": {
                "column": "r.ts",
                "type": "datetime_range",
                "synonyms": ["fecha", "día", "semana", "mes", "rango de fechas"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Resumen de clima por pórtico y variable",
        },
        "default_chart": {
            "type": "bar",
            "x": "portico",
            "y": "valor_promedio",
        },
        "order_by": "portico, variable",
    }
)

# ---------------------------------------------------------------------------
# 12) Ocupación de zonas (personas / vehículos) en un rango
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "ocupacion_zonas",
        "keywords": [
            "zonas con mas tiempo de permanencia",
            "zonas con más tiempo de permanencia",
            "zonas con mas gente",
            "zonas mas ocupadas",
            "zonas más ocupadas",
        ],
        "description": "Ocupación agregada de zonas (personas / vehículos) en un rango de tiempo.",
        "tables": ["map_polygon_occupancy", "map_polygons"],
        "select_columns": [
            "mp.site          AS sitio",
            "mp.nivel         AS nivel",
            "mp.name          AS zona_nombre",
            "mp.zone          AS zona_codigo",
            "SUM(mpo.people_count)   AS personas_acumuladas",
            "SUM(mpo.vehicle_count)  AS vehiculos_acumulados",
        ],
        "base_sql": """
            FROM map_polygon_occupancy mpo
            JOIN map_polygons mp ON mp.id = mpo.polygon_id
            WHERE 1=1
        """,
        "filters": {
            "sitio": {
                "column": "mp.site",
                "type": "string",
                "synonyms": ["sitio", "faena"],
            },
            "nivel": {
                "column": "mp.nivel",
                "type": "string",
                "synonyms": ["nivel"],
            },
            "zona": {
                "column": "mp.zone",
                "type": "string",
                "synonyms": ["zona", "ur"],
            },
            "fecha": {
                "column": "mpo.snapshot_time",
                "type": "datetime_range",
                "synonyms": ["hoy", "día", "semana", "mes", "rango de fechas"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Ocupación de zonas",
        },
        "default_chart": {
            "type": "bar",
            "x": "zona_nombre",
            "y": "personas_acumuladas",
        },
        "group_by": "mp.site, mp.nivel, mp.name, mp.zone",
        "order_by": "personas_acumuladas DESC",
    }
)

# ---------------------------------------------------------------------------
# 13) Sensores por UR (online/offline)
# ---------------------------------------------------------------------------
SYSTEM_QUERIES.append(
    {
        "id": "sensores_por_ur",
        "keywords": [
            "sensores por ur",
            "sensores de la ur",
            "sensores por unidad de riesgo",
        ],
        "description": "Listado de sensores asociados a una UR, con estado online/offline.",
        "tables": ["sensor", "ur"],
        "select_columns": [
            "u.nombre   AS ur",
            "u.estado   AS estado_ur",
            "s.nombre   AS sensor",
            "s.online   AS sensor_online",
        ],
        "base_sql": """
            FROM sensor s
            LEFT JOIN ur u ON u.id = s.ur_id
            WHERE 1=1
        """,
        "filters": {
            "ur": {
                "column": "u.nombre",
                "type": "string",
                "synonyms": ["ur", "unidad de riesgo"],
            },
            "online": {
                "column": "s.online",
                "type": "bool",
                "synonyms": ["online", "activo"],
            },
        },
        "default_output": {
            "type": "table",
            "title": "Sensores por UR",
        },
        "default_chart": None,
        "order_by": "ur, sensor",
    }
)


# ------------------------------ Búsqueda de consulta ------------------------------


def find_system_query(question: str) -> Optional[Dict[str, Any]]:
    """
    Dada la pregunta original del usuario, intenta seleccionar una
    consulta de sistema en base a palabras clave.

    Más adelante puedes reemplazar esto con IA que devuelva directamente
    el id de consulta y los filtros; esto es un fallback determinista.
    """
    q = _norm(question)

    for query in SYSTEM_QUERIES:
        for kw in query.get("keywords", []):
            if _norm(kw) in q:
                return query

    return None



# ---------------------------------------------------------------------------
# EXTRA (Dominio minero): consultas para consistencia con módulos TM One
# ---------------------------------------------------------------------------

# Personas por nivel/zona en un rango (permite responder: "¿cuántas personas en NP el 22-12?")
SYSTEM_QUERIES.append(
    {
        "id": "personas_por_nivel_en_rango",
        "keywords": [
            "cuantas personas hay",
            "cuántas personas hay",
            "personas en NP",
            "personas en UCL",
            "personas en NTI",
            "cantidad de personas por nivel",
            "cantidad de personas por zona",
            "personas por nivel",
            "personas por zona",
        ],
        "description": "Cuenta personas distintas por nivel/zona usando eventos de acceso y asignaciones activas.",
        "tables": ["access_event", "tag_assignment"],
        "select_columns": [
            "COALESCE(ae.zone, 'SIN_ZONA') AS nivel",
            "COUNT(DISTINCT ta.entity_id)::int AS personas",
        ],
        "base_sql": '''
            FROM access_event ae
            JOIN tag_assignment ta
              ON ta.tag_id = ae.tag_id
             AND ta.entity_type = 'person'
             AND ta.active = TRUE
            WHERE ae.kind = 'person'
        ''',
        "filters": {
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["fecha", "dia", "día", "entre", "desde", "hasta", "hoy", "ayer"],
            },
            "nivel": {
                "column": "ae.zone",
                "type": "string",
                "synonyms": ["nivel", "zona", "sector", "np", "ucl", "nti"],
            },
        },
        "default_output": {"type": "table", "title": "Personas por nivel"},
        "default_chart": {"type": "bar", "x": "nivel", "y": "personas"},
        "order_by": "personas DESC",
        "group_by": "nivel",
    }
)

# Vueltas por vehículo y UR (tracking)
SYSTEM_QUERIES.append(
    {
        "id": "vueltas_por_vehiculo_ur",
        "keywords": [
            "cuantas vueltas dio",
            "cuántas vueltas dio",
            "vueltas de un vehiculo",
            "vueltas de un vehículo",
            "laps de un vehiculo",
            "laps de un vehículo",
        ],
        "description": "Vueltas (laps) por vehículo y UR/pórtico.",
        "tables": ["zenit_vehicle_laps_generated"],
        "select_columns": [
            "vehicle_name AS vehiculo",
            "portico_code AS ur",
            "day::date AS dia",
            "SUM(laps)::int AS vueltas",
        ],
        "base_sql": '''
            FROM zenit_vehicle_laps_generated
            WHERE 1=1
        ''',
        "filters": {
            "fecha": {
                "column": "day",
                "type": "datetime_range",
                "synonyms": ["fecha", "dia", "día", "entre", "desde", "hasta", "hoy", "ayer", "ultima semana", "última semana"],
            },
            "vehiculo": {
                "column": "vehicle_name",
                "type": "string",
                "synonyms": ["vehiculo", "vehículo", "patente", "camion", "camión"],
            },
            "ur": {
                "column": "portico_code",
                "type": "string",
                "synonyms": ["ur", "portico", "pórtico", "portico_code"],
            },
            "nivel": {
                "column": "nivel",
                "type": "int",
                "synonyms": ["nivel", "zona"],
            },
        },
        "default_output": {"type": "table", "title": "Vueltas por vehículo y UR"},
        "default_chart": {"type": "bar", "x": "dia", "y": "vueltas", "group_by": "vehiculo"},
        "order_by": "dia ASC",
        "group_by": "vehiculo, ur, dia",
    }
)

# Ranking de permanencias (aprox) por persona en un día (primer/último evento del día)
SYSTEM_QUERIES.append(
    {
        "id": "ranking_permanencia_personas",
        "keywords": [
            "quien es la persona que mas tiempo",
            "quién es la persona que más tiempo",
            "mas tiempo estuvo dentro",
            "más tiempo estuvo dentro",
            "ranking de permanencia",
            "orden de mayor a menor permanencia",
            "tiempo dentro de la mina",
            "tiempo en la mina",
        ],
        "description": "Aproxima permanencia diaria como diferencia entre primer y ultimo evento del dia por persona.",
        "tables": ["access_event", "tag_assignment", "person"],
        "select_columns": [
            "p.full_name AS persona",
            "ae.zone AS nivel",
            "MIN(ae.ts_ingested) AS primera_marca",
            "MAX(ae.ts_ingested) AS ultima_marca",
            "EXTRACT(EPOCH FROM (MAX(ae.ts_ingested) - MIN(ae.ts_ingested)))::int AS segundos_en_mina",
        ],
        "base_sql": '''
            FROM access_event ae
            JOIN tag_assignment ta
              ON ta.tag_id = ae.tag_id
             AND ta.entity_type = 'person'
             AND ta.active = TRUE
            JOIN person p
              ON p.id = ta.entity_id
            WHERE ae.kind = 'person'
        ''',
        "filters": {
            "fecha": {
                "column": "ae.ts_ingested",
                "type": "datetime_range",
                "synonyms": ["fecha", "dia", "día", "ayer", "hoy"],
            },
            "nivel": {
                "column": "ae.zone",
                "type": "string",
                "synonyms": ["nivel", "zona", "sector", "np", "ucl", "nti"],
            },
            "persona": {
                "column": "p.full_name",
                "type": "string",
                "synonyms": ["persona", "nombre"],
            },
        },
        "default_output": {"type": "table", "title": "Ranking de permanencia (aprox)"},
        "default_chart": {"type": "bar", "x": "persona", "y": "segundos_en_mina"},
        "order_by": "segundos_en_mina DESC",
        "group_by": "persona, nivel",
    }
)

# Reporte clima (CO/TEMP) fuera de norma (aprox por cantidad de lecturas)
SYSTEM_QUERIES.append(
    {
        "id": "reporte_clima_fuera_norma",
        "keywords": [
            "reporte de clima",
            "co2 y temp",
            "co y temp",
            "co y temperatura",
            "fuera de norma",
            "fuera de rango",
            "ultima semana clima",
            "última semana clima",
            "correlacion de horas",
            "correlación de horas",
        ],
        "description": "Conteo de lecturas fuera de norma por UR/nivel (aprox).",
        "tables": ["access_portico_climate_reading", "access_climate_var", "access_portico"],
        "select_columns": [
            "ap.nivel AS nivel",
            "ap.name AS ur",
            "v.code AS variable",
            "DATE_TRUNC('day', r.ts)::date AS dia",
            "COUNT(*)::int AS lecturas_fuera_norma",
        ],
        "base_sql": '''
            FROM access_portico_climate_reading r
            JOIN access_climate_var v ON v.id = r.climate_var_id
            JOIN access_portico ap ON ap.id = r.portico_id
            WHERE 1=1
        ''',
        "filters": {
            "fecha": {
                "column": "r.ts",
                "type": "datetime_range",
                "synonyms": ["fecha", "dia", "día", "ultima semana", "última semana", "entre", "desde", "hasta"],
            },
            "nivel": {
                "column": "ap.nivel",
                "type": "string",
                "synonyms": ["nivel", "zona", "sector", "np", "ucl", "nti"],
            },
            "ur": {
                "column": "ap.name",
                "type": "string",
                "synonyms": ["ur", "portico", "pórtico"],
            },
            "variable": {
                "column": "v.code",
                "type": "string",
                "synonyms": ["co", "co2", "temp", "temperatura"],
            },
            "threshold": {
                "column": "r.value",
                "type": "int",
                "synonyms": ["umbral", "threshold", "limite", "límite"],
            },
        },
        "default_output": {"type": "table", "title": "Clima fuera de norma (aprox)"},
        "default_chart": {"type": "bar", "x": "dia", "y": "lecturas_fuera_norma", "group_by": "ur"},
        "order_by": "dia ASC",
        "group_by": "nivel, ur, variable, dia",
    }
)
