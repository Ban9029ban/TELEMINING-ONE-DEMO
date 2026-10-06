"""Persistent per-polygon mode and latest automatic observation."""
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import text

SCHEMA = """CREATE TABLE IF NOT EXISTS polygon_control_mode (
 map_object_id BIGINT PRIMARY KEY REFERENCES map_object(id) ON DELETE CASCADE,
 mode VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manual')),
 automatic_data JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)"""

def control_rows(db):
 return {row['map_object_id']: dict(row) for row in db.execute(text('SELECT * FROM polygon_control_mode')).mappings()}

def cache_automatic(db, object_id, data):
 return db.execute(text("""INSERT INTO polygon_control_mode(map_object_id, automatic_data)
 VALUES (:id, CAST(:data AS JSONB)) ON CONFLICT(map_object_id) DO UPDATE
 SET automatic_data=EXCLUDED.automatic_data RETURNING mode"""),
 {'id':object_id,'data':json.dumps(data,default=str)}).scalar_one()

def require_manual(db, object_id):
 db.execute(text('INSERT INTO polygon_control_mode(map_object_id) VALUES (:id) ON CONFLICT DO NOTHING'),{'id':object_id})
 mode=db.execute(text('SELECT mode FROM polygon_control_mode WHERE map_object_id=:id FOR UPDATE'),{'id':object_id}).scalar_one()
 if mode != 'manual':raise HTTPException(409,'Cambia el polígono a Manual antes de seleccionar un estado.')

def change_mode(db, object_id, mode):
 if mode not in ('auto','manual'):raise HTTPException(422,'Modo inválido')
 db.execute(text('INSERT INTO polygon_control_mode(map_object_id) VALUES (:id) ON CONFLICT DO NOTHING'),{'id':object_id})
 row=db.execute(text('SELECT * FROM polygon_control_mode WHERE map_object_id=:id FOR UPDATE'),{'id':object_id}).mappings().one()
 data=row['automatic_data']
 if not data:
  current=db.execute(text("SELECT * FROM object_current_state WHERE map_object_id=:id AND source_status != 'manual'"),{'id':object_id}).mappings().first()
  if current:data={key:current[key] for key in ['site_id','state_code','raw_value','source_name','source_status','observed_at']}
 if mode=='auto':
  if not data:raise HTTPException(409,'Aún no hay una lectura automática disponible para este polígono.')
  db.execute(text("""INSERT INTO object_current_state(map_object_id,site_id,state_code,raw_value,source_name,source_status,observed_at,updated_at)
  VALUES (:id,:site_id,:state_code,:raw_value,:source_name,:source_status,:observed_at,NOW())
  ON CONFLICT(map_object_id) DO UPDATE SET state_code=EXCLUDED.state_code,raw_value=EXCLUDED.raw_value,
  source_name=EXCLUDED.source_name,source_status=EXCLUDED.source_status,observed_at=EXCLUDED.observed_at,updated_at=NOW()"""),{'id':object_id,**data})
  db.execute(text('UPDATE map_object SET state_code=:state_code WHERE id=:id'),{'id':object_id,'state_code':data['state_code']})
 result=db.execute(text("UPDATE polygon_control_mode SET mode=:mode, automatic_data=CAST(:data AS JSONB), updated_at=NOW() WHERE map_object_id=:id RETURNING mode,updated_at"),{'id':object_id,'mode':mode,'data':json.dumps(data,default=str) if data else None}).mappings().one()
 return {'mode':result['mode'],'updated_at':result['updated_at']}
