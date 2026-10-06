-- Apply to the NOCONE database to grant the existing Sala CIC layout access.
-- Preserve all other map selections and visual settings.
UPDATE app_setting
SET value = jsonb_set(value::jsonb,
    '{sala,projects,andes_norte_tunel_correa,selected}', 'true'::jsonb)::text
WHERE key IN (
    SELECT 'sismico_visual:' || id || ':sala-sic'
    FROM users WHERE username = 'sala_cic'
)
AND value::jsonb #> '{sala,projects,andes_norte_tunel_correa}' IS NOT NULL;
