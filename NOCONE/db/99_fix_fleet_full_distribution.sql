/* ============================================================
   FIX FLEET FULL DISTRIBUTION
   ------------------------------------------------------------
   Objetivo:
   - Garantizar que todas las personas, vehículos y equipos activos
     tengan tag_assignment activo.
   - Generar eventos actuales distribuidos en los pórticos activos,
     con entradas y salidas, para que los mapas y resumen operativo
     muestren movimiento realista y no solo un subconjunto pequeño.
   - Corregir escenarios demo donde existen 549 personas / muchos
     vehículos en configuración, pero solo pocos tienen movimiento.

   Ejecución segura/idempotente:
   - Elimina solo eventos creados por este fix usando seed_batch.
   - No elimina eventos reales/productivos.
   ============================================================ */

BEGIN;

-- 1) Limpiar únicamente eventos generados por este fix.
DELETE FROM access_event
WHERE extra ->> 'seed_batch' = 'fleet_full_distribution_v2';

-- 2) Asegurar tags y asignaciones para TODAS las personas sin tag activo.
INSERT INTO tag (code)
SELECT 'AUTO-PERSON-' || p.id::text
FROM person p
WHERE NOT EXISTS (
    SELECT 1
    FROM tag_assignment ta
    WHERE ta.entity_type = 'person'
      AND ta.entity_id = p.id
      AND ta.active = TRUE
)
AND NOT EXISTS (
    SELECT 1 FROM tag t WHERE t.code = 'AUTO-PERSON-' || p.id::text
);

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT DISTINCT ON (p.id)
       t.id,
       'person',
       p.id,
       COALESCE(NULLIF(p.full_name, ''), 'Persona ' || p.id::text),
       TRUE
FROM person p
JOIN tag t ON t.code = 'AUTO-PERSON-' || p.id::text
WHERE NOT EXISTS (
    SELECT 1
    FROM tag_assignment ta
    WHERE ta.entity_type = 'person'
      AND ta.entity_id = p.id
      AND ta.active = TRUE
)
ORDER BY p.id, t.id::text;

-- 3) Asegurar tags y asignaciones para TODOS los vehículos sin tag activo.
INSERT INTO tag (code)
SELECT 'AUTO-VEHICLE-' || v.id::text
FROM vehicles v
WHERE NOT EXISTS (
    SELECT 1
    FROM tag_assignment ta
    WHERE ta.entity_type = 'vehicle'
      AND ta.entity_id = v.id
      AND ta.active = TRUE
)
AND NOT EXISTS (
    SELECT 1 FROM tag t WHERE t.code = 'AUTO-VEHICLE-' || v.id::text
);

INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
SELECT DISTINCT ON (v.id)
       t.id,
       'vehicle',
       v.id,
       COALESCE(NULLIF(v.patente, ''), 'Vehiculo ' || v.id::text),
       TRUE
FROM vehicles v
JOIN tag t ON t.code = 'AUTO-VEHICLE-' || v.id::text
WHERE NOT EXISTS (
    SELECT 1
    FROM tag_assignment ta
    WHERE ta.entity_type = 'vehicle'
      AND ta.entity_id = v.id
      AND ta.active = TRUE
)
ORDER BY v.id, t.id::text;

-- 4) Asegurar tags y asignaciones para TODOS los equipos sin tag activo.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'equipment') THEN
        INSERT INTO tag (code)
        SELECT 'AUTO-EQUIPMENT-' || e.id::text
        FROM equipment e
        WHERE NOT EXISTS (
            SELECT 1
            FROM tag_assignment ta
            WHERE ta.entity_type = 'equipment'
              AND ta.entity_id = e.id
              AND ta.active = TRUE
        )
        AND NOT EXISTS (
            SELECT 1 FROM tag t WHERE t.code = 'AUTO-EQUIPMENT-' || e.id::text
        );

        INSERT INTO tag_assignment (tag_id, entity_type, entity_id, display_name, active)
        SELECT DISTINCT ON (e.id)
               t.id,
               'equipment',
               e.id,
               COALESCE(NULLIF(e.name, ''), NULLIF(e.code, ''), 'Equipo ' || e.id::text),
               TRUE
        FROM equipment e
        JOIN tag t ON t.code = 'AUTO-EQUIPMENT-' || e.id::text
        WHERE NOT EXISTS (
            SELECT 1
            FROM tag_assignment ta
            WHERE ta.entity_type = 'equipment'
              AND ta.entity_id = e.id
              AND ta.active = TRUE
        )
        ORDER BY e.id, t.id::text;
    END IF;
END $$;

-- 5) Generar movimiento actual distribuido en pórticos activos.
--    Se usa map_device cuando existe para priorizar pórticos visibles en mapas.
WITH porticos AS (
    SELECT
        ap.id,
        ap.gateway_id,
        ap.zone,
        ap.nivel,
        ROW_NUMBER() OVER (ORDER BY COALESCE(md.map_code, ''), ap.id) AS rn,
        COUNT(*) OVER () AS total_porticos
    FROM access_portico ap
    LEFT JOIN map_device md
      ON md.ref_id = ap.id
     AND md.kind IN ('portico', 'portico_clima')
    WHERE ap.active = TRUE
      AND ap.gateway_id IS NOT NULL
),
entities AS (
    SELECT
        ta.tag_id,
        ta.entity_type,
        ta.entity_id,
        ROW_NUMBER() OVER (ORDER BY ta.entity_type, ta.entity_id) AS rn
    FROM tag_assignment ta
    WHERE ta.active = TRUE
      AND ta.entity_type IN ('person', 'vehicle', 'equipment')
),
assigned AS (
    SELECT
        e.tag_id,
        e.entity_type,
        e.entity_id,
        e.rn AS entity_rn,
        p.id AS portico_id,
        p.gateway_id,
        p.zone,
        p.nivel,
        p.total_porticos
    FROM entities e
    JOIN porticos p
      ON p.rn = (((e.rn - 1) % p.total_porticos) + 1)
),
entry_events AS (
    INSERT INTO access_event (
        tag_id,
        gateway_id,
        ts_edge,
        ts_ingested,
        signal,
        rssi,
        zone,
        direction,
        level,
        kind,
        extra
    )
    SELECT
        a.tag_id,
        a.gateway_id,
        now() - ((a.entity_rn % 180) || ' minutes')::interval,
        now() - ((a.entity_rn % 180) || ' minutes')::interval,
        'ok',
        -55 - (a.entity_rn % 25),
        COALESCE(a.zone, 'Zona_' || a.portico_id::text),
        'in',
        COALESCE(NULLIF(regexp_replace(COALESCE(a.nivel, ''), '[^0-9]', '', 'g'), '')::integer, 1),
        a.entity_type,
        jsonb_build_object(
            'seed_batch', 'fleet_full_distribution_v2',
            'portico', a.portico_id,
            'entity_type', a.entity_type,
            'entity_id', a.entity_id,
            'movement', 'in'
        )
    FROM assigned a
    RETURNING id
),
exit_events AS (
    INSERT INTO access_event (
        tag_id,
        gateway_id,
        ts_edge,
        ts_ingested,
        signal,
        rssi,
        zone,
        direction,
        level,
        kind,
        extra
    )
    SELECT
        a.tag_id,
        a.gateway_id,
        now() - (((a.entity_rn % 90) + 1) || ' minutes')::interval,
        now() - (((a.entity_rn % 90) + 1) || ' minutes')::interval,
        'ok',
        -60 - (a.entity_rn % 20),
        COALESCE(a.zone, 'Zona_' || a.portico_id::text),
        'out',
        COALESCE(NULLIF(regexp_replace(COALESCE(a.nivel, ''), '[^0-9]', '', 'g'), '')::integer, 1),
        a.entity_type,
        jsonb_build_object(
            'seed_batch', 'fleet_full_distribution_v2',
            'portico', a.portico_id,
            'entity_type', a.entity_type,
            'entity_id', a.entity_id,
            'movement', 'out'
        )
    FROM assigned a
    -- genera salidas parciales para que exista movimiento sin dejar todo en cero.
    WHERE (a.entity_rn % 4) = 0
    RETURNING id
)
SELECT
    (SELECT COUNT(*) FROM entry_events) AS entradas_generadas,
    (SELECT COUNT(*) FROM exit_events) AS salidas_generadas;

-- 6) Estadística de control para logs de despliegue.
DO $$
DECLARE
    v_persons BIGINT;
    v_vehicles BIGINT;
    v_equipment BIGINT;
    v_events BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_persons FROM tag_assignment WHERE active = TRUE AND entity_type = 'person';
    SELECT COUNT(*) INTO v_vehicles FROM tag_assignment WHERE active = TRUE AND entity_type = 'vehicle';
    SELECT COUNT(*) INTO v_equipment FROM tag_assignment WHERE active = TRUE AND entity_type = 'equipment';
    SELECT COUNT(*) INTO v_events FROM access_event WHERE extra ->> 'seed_batch' = 'fleet_full_distribution_v2';

    RAISE NOTICE 'Fleet fix aplicado. Personas con tag: %, Vehiculos con tag: %, Equipos con tag: %, Eventos generados: %',
        v_persons, v_vehicles, v_equipment, v_events;
END $$;

COMMIT;
