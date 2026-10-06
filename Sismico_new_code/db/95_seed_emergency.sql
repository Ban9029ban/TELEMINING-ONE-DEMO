-- V15: emergency state option for all polygons
INSERT INTO public.polygon_ui_state_option (
  polygon_ui_config_id, config_id, map_object_id,
  state_code, button_label, label,
  color_hex, button_color, overlay_color, fill_color,
  sort_order, is_visible, is_enabled, is_active
)
SELECT c.id, c.id, c.map_object_id,
       'emergency', 'EMERGENCIA', 'EMERGENCIA',
       '#ff0000', '#ff0000', '#ff0000', '#ff0000',
       0, TRUE, TRUE, TRUE
FROM public.polygon_ui_config c
WHERE NOT EXISTS (
  SELECT 1 FROM public.polygon_ui_state_option o
  WHERE (o.polygon_ui_config_id = c.id OR o.config_id = c.id OR o.map_object_id = c.map_object_id)
    AND o.state_code = 'emergency'
);