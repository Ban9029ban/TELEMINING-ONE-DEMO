"""
Catálogo de tablas/columnas que el Agente IA puede usar.

La idea es:
- Definir QUÉ tablas se exponen a IA.
- Qué columnas se pueden mostrar en tablas al usuario.
- Cómo se llaman (label amigable) y de qué tipo son.

NO hay SQL acá, sólo metadata. Las consultas viven en ia_system_queries.py.
"""

from typing import Dict, Any


# Tipos simples para documentar
#  - string, int, number, bool, datetime, json
IATablesMetadata = Dict[str, Dict[str, Any]]


IA_TABLES: IATablesMetadata = {
    # --------------------------------------------------
    # Empresas
    # --------------------------------------------------
    "company": {
        "table": "company",
        "expose": True,
        "description": "Empresas / contratistas",
        "columns": {
            "id": {
                "type": "int",
                "expose": False,  # PK interna
            },
            "name": {
                "type": "string",
                "expose": True,
                "label": "Empresa",
            },
            "rut": {
                "type": "string",
                "expose": True,
                "label": "RUT empresa",
            },
            "active": {
                "type": "bool",
                "expose": True,
                "label": "Activa",
            },
        },
    },

    # --------------------------------------------------
    # Personas
    # --------------------------------------------------
    "person": {
        "table": "person",
        "expose": True,
        "description": "Personas / trabajadores",
        "columns": {
            "id": {
                "type": "int",
                "expose": False,
            },
            "company_id": {
                "type": "int",
                "expose": False,
                "fk": "company.id",
            },
            "rut": {
                "type": "string",
                "expose": True,
                "label": "RUT",
            },
            "full_name": {
                "type": "string",
                "expose": True,
                "label": "Nombre completo",
            },
            "position": {
                "type": "string",
                "expose": True,
                "label": "Cargo",
            },
            "group_name": {
                "type": "string",
                "expose": True,
                "label": "Cuadrilla",
            },
            "active": {
                "type": "bool",
                "expose": True,
                "label": "Activo",
            },
        },
    },

    # --------------------------------------------------
    # Vehículos
    # --------------------------------------------------
    "vehicles": {
        "table": "vehicles",
        "expose": True,
        "description": "Vehículos monitoreados",
        "columns": {
            "id": {
                "type": "int",
                "expose": False,
            },
            "patente": {
                "type": "string",
                "expose": True,
                "label": "Patente",
            },
            "status": {
                "type": "string",
                "expose": True,
                "label": "Estado",
            },
            "level": {
                "type": "int",
                "expose": True,
                "label": "Nivel",
            },
        },
    },

    # Relación vehículo-empresa (no se expone directa al usuario)
    "vehicle_company": {
        "table": "vehicle_company",
        "expose": False,
        "description": "Relación vehículo ↔ empresa",
        "columns": {
            "id": {"type": "int", "expose": False},
            "vehicle_id": {"type": "int", "expose": False},
            "company_id": {"type": "int", "expose": False},
        },
    },

    # --------------------------------------------------
    # Tags & asignaciones (solo para joins)
    # --------------------------------------------------
    "tag": {
        "table": "tag",
        "expose": False,
        "description": "Tags físicos de tracking",
        "columns": {
            "id": {"type": "uuid", "expose": False},
            "code": {"type": "string", "expose": False},
        },
    },

    "tag_assignment": {
        "table": "tag_assignment",
        "expose": False,
        "description": "Asignación de tags a personas/vehículos",
        "columns": {
            "id": {"type": "int", "expose": False},
            "tag_id": {"type": "uuid", "expose": False},
            "entity_type": {"type": "string", "expose": False},
            "entity_id": {"type": "int", "expose": False},
            "display_name": {"type": "string", "expose": False},
            "active": {"type": "bool", "expose": False},
            "valid_from": {"type": "datetime", "expose": False},
            "valid_to": {"type": "datetime", "expose": False},
        },
    },

    # --------------------------------------------------
    # Eventos de acceso (movimientos)
    # --------------------------------------------------
    "access_event": {
        "table": "access_event",
        "expose": True,
        "description": "Eventos de acceso de tags por pórtico/zona",
        "columns": {
            "id": {"type": "uuid", "expose": False},
            "tag_id": {"type": "uuid", "expose": False},
            "gateway_id": {"type": "uuid", "expose": False},
            "ts_ingested": {
                "type": "datetime",
                "expose": True,
                "label": "Fecha/Hora",
            },
            "ts_edge": {
                "type": "datetime",
                "expose": False,
            },
            "zone": {
                "type": "string",
                "expose": True,
                "label": "Zona",
            },
            "direction": {
                "type": "string",
                "expose": True,
                "label": "Dirección",
            },
            "level": {
                "type": "int",
                "expose": True,
                "label": "Nivel",
            },
            "kind": {
                "type": "string",
                "expose": True,
                "label": "Tipo entidad (persona/vehículo)",
            },
            "extra": {
                "type": "json",
                "expose": False,
            },
        },
    },

    # --------------------------------------------------
    # Pórticos
    # --------------------------------------------------
    "access_portico": {
        "table": "access_portico",
        "expose": True,
        "description": "Pórticos de acceso",
        "columns": {
            "id": {"type": "int", "expose": False},
            "gateway_id": {"type": "uuid", "expose": False},
            "map_point_id": {"type": "int", "expose": False},
            "name": {
                "type": "string",
                "expose": True,
                "label": "Pórtico",
            },
            "site": {
                "type": "string",
                "expose": True,
                "label": "Faena / sitio",
            },
            "nivel": {
                "type": "string",
                "expose": True,
                "label": "Nivel",
            },
            "site_code": {
                "type": "string",
                "expose": True,
            },
            "zone": {
                "type": "string",
                "expose": True,
                "label": "Zona",
            },
            "has_climate": {
                "type": "bool",
                "expose": True,
                "label": "Tiene clima",
            },
        },
    },

    # --------------------------------------------------
    # Clima (variables y lecturas)
    # --------------------------------------------------
    "access_climate_var": {
        "table": "access_climate_var",
        "expose": True,
        "description": "Variables de clima/sensores",
        "columns": {
            "id": {"type": "int", "expose": False},
            "code": {"type": "string", "expose": True, "label": "Código"},
            "name": {"type": "string", "expose": True, "label": "Nombre"},
            "unit": {"type": "string", "expose": True, "label": "Unidad"},
            "description": {"type": "string", "expose": True, "label": "Descripción"},
        },
    },

    "access_portico_climate_reading": {
        "table": "access_portico_climate_reading",
        "expose": True,
        "description": "Lecturas de clima por pórtico",
        "columns": {
            "id": {"type": "int", "expose": False},
            "portico_id": {"type": "int", "expose": False, "fk": "access_portico.id"},
            "climate_var_id": {"type": "int", "expose": False, "fk": "access_climate_var.id"},
            "ts": {
                "type": "datetime",
                "expose": True,
                "label": "Fecha/Hora",
            },
            "value": {
                "type": "number",
                "expose": True,
                "label": "Valor",
            },
            "level": {
                "type": "string",
                "expose": True,
                "label": "Nivel",
            },
        },
    },

    # --------------------------------------------------
    # Polígonos y ocupación
    # --------------------------------------------------
    "map_polygons": {
        "table": "map_polygons",
        "expose": True,
        "description": "Polígonos (zonas) en el mapa",
        "columns": {
            "id": {"type": "int", "expose": False},
            "site": {"type": "string", "expose": True},
            "nivel": {"type": "string", "expose": True},
            "name": {"type": "string", "expose": True, "label": "Nombre zona"},
            "site_code": {"type": "string", "expose": True},
            "zone": {"type": "string", "expose": True},
        },
    },

    "map_polygon_occupancy": {
        "table": "map_polygon_occupancy",
        "expose": True,
        "description": "Ocupación de zonas (personas / vehículos) por instante",
        "columns": {
            "polygon_id": {"type": "int", "expose": False, "fk": "map_polygons.id"},
            "snapshot_time": {
                "type": "datetime",
                "expose": True,
                "label": "Fecha/Hora",
            },
            "people_count": {
                "type": "int",
                "expose": True,
                "label": "Personas",
            },
            "vehicle_count": {
                "type": "int",
                "expose": True,
                "label": "Vehículos",
            },
            "critical_equipment_count": {
                "type": "int",
                "expose": True,
                "label": "Equipos críticos",
            },
        },
    },

    # --------------------------------------------------
    # UR y sensores
    # --------------------------------------------------
    "ur": {
        "table": "ur",
        "expose": True,
        "description": "Unidades de referencia / riesgo",
        "columns": {
            "id": {"type": "int", "expose": False},
            "nombre": {"type": "string", "expose": True, "label": "UR"},
            "estado": {"type": "string", "expose": True, "label": "Estado"},
        },
    },

    "sensor": {
        "table": "sensor",
        "expose": True,
        "description": "Sensores instalados en polígonos",
        "columns": {
            "id": {"type": "int", "expose": False},
            "ur_id": {"type": "int", "expose": False, "fk": "ur.id"},
            "nombre": {"type": "string", "expose": True, "label": "Nombre"},
            "online": {"type": "bool", "expose": True, "label": "Online"},
        },
    },

    # --------------------------------------------------
    # Vistas resumidas
    # --------------------------------------------------
    "vw_access_interior": {
        "table": "vw_access_interior",
        "expose": True,
        "description": "Personas y vehículos actualmente dentro",
        "columns": {
            "portico_id": {"type": "int", "expose": False},
            "portico_name": {
                "type": "string",
                "expose": True,
                "label": "Pórtico",
            },
            "tag_id": {"type": "uuid", "expose": False},
            "entity_type": {
                "type": "string",
                "expose": True,
                "label": "Tipo (persona/vehículo)",
            },
            "display_name": {
                "type": "string",
                "expose": True,
                "label": "Nombre",
            },
            "ts_last": {
                "type": "datetime",
                "expose": True,
                "label": "Último evento",
            },
            "zone": {"type": "string", "expose": True},
            "person_company_name": {
                "type": "string",
                "expose": True,
                "label": "Empresa persona",
            },
            "person_position": {
                "type": "string",
                "expose": True,
                "label": "Cargo",
            },
            "vehicle_patente": {
                "type": "string",
                "expose": True,
                "label": "Patente",
            },
            "vehicle_company_name": {
                "type": "string",
                "expose": True,
                "label": "Empresa vehículo",
            },
        },
    },

    "vw_access_portico_counters": {
        "table": "vw_access_portico_counters",
        "expose": True,
        "description": "Contadores por pórtico (total / in / out)",
        "columns": {
            "portico_id": {"type": "int", "expose": False},
            "portico_name": {
                "type": "string",
                "expose": True,
                "label": "Pórtico",
            },
            "total_events": {
                "type": "int",
                "expose": True,
                "label": "Eventos totales",
            },
            "total_in": {
                "type": "int",
                "expose": True,
                "label": "Entradas",
            },
            "total_out": {
                "type": "int",
                "expose": True,
                "label": "Salidas",
            },
        },
    },
}


def get_table_metadata(key: str) -> Dict[str, Any]:
    """Devuelve la metadata de una tabla lógica (company, person, etc.)."""
    return IA_TABLES[key]
