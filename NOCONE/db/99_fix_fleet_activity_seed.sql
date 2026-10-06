/* ============================================================
   FIX FLEET ACTIVITY / MOVIMIENTO ACTUAL
   ------------------------------------------------------------
   Objetivo:
   - Garantizar eventos actuales con tag_id, gateway_id y portico_id.
   - Evitar que el mapa de flota muestre solo un subconjunto reducido.
   - Mantener idempotencia: elimina solo eventos generados por este fix.
   ============================================================ */

BEGIN;

-- Índices útiles para consultas de movimiento/mapas.
CREATE INDEX IF NOT EXISTS idx_access_event_tag_ts
    ON access_event (tag_id, ts_ingested DESC);

CREATE INDEX IF NOT EXISTS idx_access_event_gateway_ts
    ON access_event (gateway_id, ts_ingested DESC);

CREATE INDEX IF NOT EXISTS idx_access_event_extra_portico
    ON access_event ((extra->>'portico'));

CREATE INDEX IF NOT EXISTS idx_tag_assignment_active_entity
    ON tag_assignment (entity_type, entity_id)
    WHERE active = TRUE;

-- Elimina solamente eventos generados por este fix para que sea reejecutable.
DELETE FROM access_event
WHERE extra->>'source' = '99_fix_fleet_activity_seed';

-- Deja una sola asignación activa por entidad, priorizando la más reciente.
WITH ranked_assignment AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY entity_type, entity_id
            ORDER BY created_at DESC, id DESC
        ) AS rn
    FROM tag_assignment
    WHERE active = TRUE
)
UPDATE tag_assignment ta
SET active = FALSE,
    updated_at = now()
FROM ranked_assignment ra
WHERE ta.id = ra.id
  AND ra.rn > 1;

-- Genera movimiento actual para todas las entidades activas con tag.
-- Cada entidad queda con historial IN/OUT durante el día y último estado IN.
WITH porticos AS (
    SELECT
        ap.id AS portico_id,
        ap.gateway_id,
        ap.zone,
        ap.site_code,
        ROW_NUMBER() OVER (ORDER BY ap.id) AS rn,
        COUNT(*) OVER () AS total
    FROM access_portico ap
    WHERE ap.active = TRUE
      AND ap.gateway_id IS NOT NULL
),
entities AS (
    SELECT
        ta.tag_id,
        ta.entity_type,
        ta.entity_id,
        ROW_NUMBER() OVER (ORDER BY ta.entity_type, ta.entity_id, ta.id) AS ern
    FROM tag_assignment ta
    WHERE ta.active = TRUE
      AND ta.tag_id IS NOT NULL
      AND ta.entity_type IN ('person', 'vehicle', 'equipment')
),
steps AS (
    SELECT
        e.tag_id,
        e.entity_type,
        e.entity_id,
        s.step_no,
        CASE WHEN s.step_no % 2 = 1 THEN 'in' ELSE 'out' END AS direction,
        (current_date::timestamptz + interval '7 hours')
          + ((e.ern % 90) * interval '1 minute')
          + (s.step_no * interval '25 minutes') AS event_ts,
        1 + ((e.ern + s.step_no - 2) % NULLIF((SELECT MAX(total) FROM porticos), 0)) AS portico_rn
    FROM entities e
    CROSS JOIN generate_series(1, 4) AS s(step_no)
),
selected_steps AS (
    SELECT
        st.*,
        p.portico_id,
        p.gateway_id,
        p.zone,
        p.site_code
    FROM steps st
    JOIN porticos p
      ON p.rn = st.portico_rn
),
insert_history AS (
    INSERT INTO access_event (
        msg_id,
        tag_id,
        gateway_id,
        ts_edge,
        ts_ingested,
        zone,
        direction,
        level,
        kind,
        extra
    )
    SELECT
        gen_random_uuid(),
        ss.tag_id,
        ss.gateway_id,
        ss.event_ts,
        ss.event_ts,
        ss.zone,
        ss.direction,
        1,
        ss.entity_type,
        jsonb_build_object(
            'source', '99_fix_fleet_activity_seed',
            'entity_type', ss.entity_type,
            'entity_id', ss.entity_id,
            'portico', ss.portico_id,
            'portico_id', ss.portico_id,
            'site_code', ss.site_code,
            'hist_day', current_date,
            'step_no', ss.step_no
        )
    FROM selected_steps ss
    RETURNING 1
),
final_positions AS (
    SELECT DISTINCT ON (e.tag_id)
        e.tag_id,
        e.entity_type,
        e.entity_id,
        p.portico_id,
        p.gateway_id,
        p.zone,
        p.site_code,
        (current_date::timestamptz + interval '12 hours')
          + ((e.ern % 180) * interval '1 minute') AS event_ts
    FROM entities e
    JOIN porticos p
      ON p.rn = 1 + ((e.ern - 1) % p.total)
    ORDER BY e.tag_id, e.ern
)
INSERT INTO access_event (
    msg_id,
    tag_id,
    gateway_id,
    ts_edge,
    ts_ingested,
    zone,
    direction,
    level,
    kind,
    extra
)
SELECT
    gen_random_uuid(),
    fp.tag_id,
    fp.gateway_id,
    fp.event_ts,
    fp.event_ts,
    fp.zone,
    'in',
    1,
    fp.entity_type,
    jsonb_build_object(
        'source', '99_fix_fleet_activity_seed',
        'entity_type', fp.entity_type,
        'entity_id', fp.entity_id,
        'portico', fp.portico_id,
        'portico_id', fp.portico_id,
        'site_code', fp.site_code,
        'hist_day', current_date,
        'final_state', 'in'
    )
FROM final_positions fp;

COMMIT;
