BEGIN;

-- Limpia solo el historico generado por este script para permitir reejecucion
-- sin duplicar eventos ni lecturas de clima demo.
DELETE FROM access_event
WHERE extra ? 'hist_day';

DELETE FROM access_portico_climate_reading
WHERE extra ? 'hist_day';

-- ============================================================
-- 1) HISTÃ“RICO DE MOVIMIENTO (90 dÃ­as hacia atrÃ¡s)
-- ============================================================
DO $$
DECLARE
    v_day_start  DATE := current_date - 90;
    v_day_end    DATE := current_date - 1;

    d_start      TIMESTAMPTZ;
    d_end        TIMESTAMPTZ;

    rec          RECORD;
    site_codes   TEXT[];
    p_ids        TEXT[];
    p_zones      TEXT[];
    p_gws        UUID[];
    p_len        INT;
    v_site_code  TEXT;
    v_site_count INT;

    v_ts_in      TIMESTAMPTZ;
    v_ts_out     TIMESTAMPTZ;

    v_stay       INT;
    v_gap        INT;
    v_visits     INT;
    v_visit_idx  INT;
    v_direction  INT;
    v_step_idx   INT;
BEGIN
    RAISE NOTICE 'seed 90 dias: iniciando historico de movimiento';
    CREATE TEMP TABLE tmp_demo_portico_order ON COMMIT DROP AS
    SELECT
        ap.site_code,
        ap.id::text AS portico_id_text,
        ap.zone,
        ap.gateway_id,
        row_number() OVER (
            PARTITION BY ap.site_code
            ORDER BY
                COALESCE(NULLIF(substring(ap.name FROM '^([0-9]+)'), ''), '999999')::INT,
                ap.id
        ) AS ordinal
    FROM access_portico ap
    WHERE ap.gateway_id IS NOT NULL
      AND (ap.active IS DISTINCT FROM FALSE)
      AND COALESCE(ap.site_code, '') <> '';

    SELECT array_agg(site_code ORDER BY site_code)
    INTO site_codes
    FROM (
        SELECT DISTINCT site_code
        FROM tmp_demo_portico_order
    ) AS site_list;

    v_site_count := COALESCE(array_length(site_codes, 1), 0);

    IF v_site_count = 0 THEN
        RAISE EXCEPTION 'No hay access_portico con gateway_id valido para generar historico secuencial.';
    END IF;

    WHILE v_day_start <= v_day_end LOOP

        d_start := v_day_start::timestamptz;
        d_end   := (v_day_start + 1)::timestamptz;

        FOR rec IN
            SELECT ta.tag_id, ta.entity_type, ta.entity_id
            FROM tag_assignment ta
            WHERE ta.active = TRUE
        LOOP
            IF random() > 0.40 THEN
                CONTINUE;
            END IF;

            v_site_code := site_codes[1 + floor(random() * v_site_count)::INT];

            SELECT
                array_agg(portico_id_text ORDER BY ordinal),
                array_agg(zone ORDER BY ordinal),
                array_agg(gateway_id ORDER BY ordinal)
            INTO p_ids, p_zones, p_gws
            FROM tmp_demo_portico_order
            WHERE site_code = v_site_code;

            p_len := COALESCE(array_length(p_ids, 1), 0);
            IF p_len = 0 THEN
                CONTINUE;
            END IF;

            IF p_len = 1 THEN
                v_visits := 1;
            ELSIF p_len = 2 THEN
                v_visits := 2;
            ELSE
                v_visits := 2 + floor(random() * LEAST(p_len - 1, 4))::INT;
            END IF;

            v_direction := CASE WHEN random() < 0.5 THEN 1 ELSE -1 END;
            v_step_idx := CASE WHEN v_direction = 1 THEN 1 ELSE p_len END;
            v_ts_in := d_start + (random() * INTERVAL '90 minutes');

            FOR v_visit_idx IN 1..v_visits LOOP
                v_stay := CASE
                    WHEN random() < 0.75 THEN 8 + floor(random() * 14)::INT
                    ELSE 22 + floor(random() * 25)::INT
                END;
                v_ts_out := v_ts_in + make_interval(mins => v_stay);

                IF v_ts_out >= d_end THEN
                    EXIT;
                END IF;

                INSERT INTO access_event (
                    msg_id, tag_id, gateway_id,
                    ts_edge, ts_ingested,
                    zone, direction, level, kind, extra
                )
                VALUES (
                    gen_random_uuid(),
                    rec.tag_id,
                    p_gws[v_step_idx],
                    v_ts_in,
                    v_ts_in,
                    p_zones[v_step_idx],
                    'in',
                    1,
                    rec.entity_type,
                    jsonb_build_object(
                        'entity_type', rec.entity_type,
                        'entity_id',   rec.entity_id,
                        'portico',     p_ids[v_step_idx],
                        'portico_id',  p_ids[v_step_idx],
                        'hist_day',    v_day_start,
                        'site_code',   v_site_code,
                        'ordinal',     v_step_idx
                    )
                );

                INSERT INTO access_event (
                    msg_id, tag_id, gateway_id,
                    ts_edge, ts_ingested,
                    zone, direction, level, kind, extra
                )
                VALUES (
                    gen_random_uuid(),
                    rec.tag_id,
                    p_gws[v_step_idx],
                    v_ts_out,
                    v_ts_out,
                    p_zones[v_step_idx],
                    'out',
                    1,
                    rec.entity_type,
                    jsonb_build_object(
                        'entity_type', rec.entity_type,
                        'entity_id',   rec.entity_id,
                        'portico',     p_ids[v_step_idx],
                        'portico_id',  p_ids[v_step_idx],
                        'hist_day',    v_day_start,
                        'site_code',   v_site_code,
                        'ordinal',     v_step_idx
                    )
                );

                IF v_visit_idx >= v_visits THEN
                    EXIT;
                END IF;

                v_gap := CASE
                    WHEN random() < 0.75 THEN 4 + floor(random() * 10)::INT
                    ELSE 15 + floor(random() * 20)::INT
                END;

                v_ts_in := v_ts_out + make_interval(mins => v_gap);
                IF v_ts_in >= d_end THEN
                    EXIT;
                END IF;

                v_step_idx := v_step_idx + v_direction;
            END LOOP;
        END LOOP;

        v_day_start := v_day_start + 1;
    END LOOP;

    RAISE NOTICE 'seed 90 dias: historico de movimiento generado';
END $$;


-- ============================================================
-- 2) HISTÃ“RICO DE CLIMA (90 dÃ­as hacia atrÃ¡s)
-- ============================================================

DO $$
DECLARE
    v_today       DATE := current_date;
    v_day_start   DATE := current_date - 90;
    v_day_end     DATE := current_date - 1;

    d_start       TIMESTAMPTZ;
    d_end         TIMESTAMPTZ;

    rec           RECORD;
    v_ts          TIMESTAMPTZ;
    v_val         NUMERIC(10,3);
    v_lvl         TEXT;
    v_center      NUMERIC(10,3);
    v_step        INT;
BEGIN
    RAISE NOTICE 'seed 90 dias: iniciando historico de clima';

    WHILE v_day_start <= v_day_end LOOP

        d_start := v_day_start::timestamptz;
        d_end   := (v_day_start + 1)::timestamptz;

        FOR rec IN
            SELECT
                cfg.portico_id,
                cfg.climate_var_id,
                cv.code,
                cfg.green_max,
                cfg.yellow_max
            FROM access_portico_climate_cfg cfg
            JOIN access_climate_var cv ON cv.id = cfg.climate_var_id
            WHERE cfg.active = TRUE
        LOOP
            v_ts := d_start;

            WHILE v_ts < d_end LOOP
                v_center := COALESCE(rec.green_max, rec.yellow_max, 20);
                v_val := v_center + (random()*6 - 3);

                IF rec.green_max IS NOT NULL AND v_val <= rec.green_max THEN
                    v_lvl := 'green';
                ELSIF rec.yellow_max IS NOT NULL AND v_val <= rec.yellow_max THEN
                    v_lvl := 'yellow';
                ELSE
                    v_lvl := 'red';
                END IF;

                INSERT INTO access_portico_climate_reading (
                    portico_id, climate_var_id, ts, value, level, extra, created_at
                )
                VALUES (
                    rec.portico_id,
                    rec.climate_var_id,
                    v_ts,
                    v_val,
                    v_lvl,
                    jsonb_build_object('hist_day', v_day_start),
                    v_ts
                );

                -- Para histÃ³rico los intervalos son mÃ¡s grandes: 10â€“30 min
                v_step := 10 + floor(random()*21);
                v_ts := v_ts + make_interval(mins => v_step);
            END LOOP;
        END LOOP;

        v_day_start := v_day_start + 1;
    END LOOP;

    RAISE NOTICE 'seed 90 dias: historico de clima generado';
END $$;

COMMIT;
