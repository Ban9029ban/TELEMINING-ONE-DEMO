SQL pack v14

Corrige:
1) polygon_ui_config unique constraint sobre map_object_id
2) polygon_ui_state_option sin columna fill_color
3) mantiene compatibilidad legacy para site/site_map/map_object

Reemplaza estos archivos en db/:
- 90_runtime_schema_and_sequences.sql
- 91_runtime_compat_patches.sql
- 92_runtime_seed_base.sql
- 93_runtime_seed_demo.sql

Quita cualquier SQL runtime viejo conflictivo, especialmente:
- 92_seed_full_semaforos_bindings.sql