/* =========================================================
   ÍNDICES BASE ACCESS_EVENT
   ========================================================= */

CREATE INDEX IF NOT EXISTS idx_access_event_ts
    ON access_event (ts_ingested DESC);

CREATE INDEX IF NOT EXISTS idx_access_event_gateway
    ON access_event (gateway_id);

CREATE INDEX IF NOT EXISTS idx_portico_communication_last_seen
    ON portico_communication (last_seen_at DESC);

/* =========================================================
   MATERIALIZED VIEW: CUENTAS HORARIAS (LEGADO)
   ========================================================= */

CREATE MATERIALIZED VIEW IF NOT EXISTS vw_hourly_counts AS
SELECT
    date_trunc('hour', ts_ingested) AS h,
    gateway_id,
    signal,
    count(*) AS c
FROM access_event
GROUP BY 1, 2, 3;

/* =========================================================
   VIEW: ÚLTIMO EVENTO POR TAG
   ========================================================= */

CREATE OR REPLACE VIEW vw_access_tag_last_event AS
WITH last_ts AS (
    SELECT
        tag_id,
        MAX(ts_ingested) AS ts_last
    FROM access_event
    GROUP BY tag_id
)
SELECT ae.*
FROM access_event ae
JOIN last_ts lt
  ON ae.tag_id = lt.tag_id
 AND ae.ts_ingested = lt.ts_last;

-- ============================================================
-- VISTA: vw_access_interior
-- Personas, vehículos y equipos actualmente "dentro" por pórtico
--   - 1 fila vigente por ENTIDAD (no por tag)
--   - Si una entidad tiene más de un tag activo, se conserva el tag
--     cuyo último evento sea más reciente
--   - Considera como "dentro" solo si el último evento del tag es IN
-- ============================================================

CREATE OR REPLACE VIEW vw_access_interior AS
WITH last_event AS (
    SELECT
        ae.tag_id,
        ae.gateway_id,
        ae.zone,
        ae.direction,
        ae.ts_edge,
        GREATEST(ae.ts_edge, ae.ts_ingested) AS last_seen,
        COALESCE((ae.extra->>'portico')::int, NULL) AS portico_id,
        ROW_NUMBER() OVER (
            PARTITION BY ae.tag_id
            ORDER BY GREATEST(ae.ts_edge, ae.ts_ingested) DESC, ae.id DESC
        ) AS rn
    FROM access_event ae
),
entity_last_event AS (
    SELECT
        ta.tag_id,
        ta.entity_type,
        ta.entity_id,
        ta.display_name,
        le.gateway_id,
        le.zone,
        le.last_seen,
        le.portico_id,
        ROW_NUMBER() OVER (
            PARTITION BY ta.entity_type, ta.entity_id
            ORDER BY le.last_seen DESC, ta.id DESC
        ) AS entity_rn
    FROM tag_assignment ta
    JOIN last_event le
        ON le.tag_id = ta.tag_id
       AND le.rn = 1
       AND le.direction = 'in'
    WHERE ta.active = TRUE
)
SELECT
    COALESCE(ap_by_id.id, ap_by_gw.id) AS portico_id,
    COALESCE(ap_by_id.name, ap_by_gw.name) AS portico_name,
    ele.gateway_id AS gateway_id,
    ele.tag_id AS tag_id,
    ele.entity_type AS entity_type,
    ele.entity_id AS entity_id,
    ele.display_name AS display_name,
    ele.last_seen AS ts_last,
    ele.zone AS zone,

    -- Datos persona (si aplica)
    p.rut AS person_rut,
    p.full_name AS person_full_name,
    p.position AS person_position,
    pc.name AS person_company_name,

    -- Datos vehículo (si aplica)
    concat_ws(' ', NULLIF(v.status,''), v.patente) AS vehicle_patente,
    v.status AS vehicle_status,
    vc.name AS vehicle_company_name,

    -- Datos equipo/herramienta (si aplica)
    e.code AS equipment_code,
    e.name AS equipment_name,
    ec.name AS equipment_company_name

FROM entity_last_event ele
LEFT JOIN access_portico ap_by_id
    ON ap_by_id.id = ele.portico_id
LEFT JOIN LATERAL (
    SELECT ap2.*
    FROM access_portico ap2
    WHERE ap2.gateway_id = ele.gateway_id
    ORDER BY ap2.id
    LIMIT 1
) ap_by_gw ON TRUE

-- Datos de personas
LEFT JOIN person p
    ON p.id = ele.entity_id AND ele.entity_type = 'person'
LEFT JOIN company pc
    ON pc.id = p.company_id

-- Datos de vehículos
LEFT JOIN vehicles v
    ON v.id = ele.entity_id AND ele.entity_type = 'vehicle'
LEFT JOIN vehicle_company vc_rel
    ON vc_rel.vehicle_id = v.id AND vc_rel.active = TRUE
LEFT JOIN company vc
    ON vc.id = vc_rel.company_id

-- Datos de equipos/herramientas
LEFT JOIN equipment e
    ON e.id = ele.entity_id AND ele.entity_type = 'equipment'
LEFT JOIN company ec
    ON ec.id = e.company_id
WHERE ele.entity_rn = 1;

/* =========================================================
   VIEW: CONTADORES POR PÓRTICO (TOTAL / IN / OUT)
   ========================================================= */

CREATE OR REPLACE VIEW vw_access_portico_counters AS
SELECT
    ap.id   AS portico_id,
    ap.name AS portico_name,
    COUNT(ae.id) AS total_events,
    COUNT(*) FILTER (WHERE ae.direction = 'in')  AS total_in,
    COUNT(*) FILTER (WHERE ae.direction = 'out') AS total_out,
    MAX(ae.ts_ingested)                          AS last_event_at
FROM access_portico ap
JOIN gateway g
      ON g.id = ap.gateway_id
LEFT JOIN access_event ae
      ON ae.gateway_id = g.id
GROUP BY ap.id, ap.name;
