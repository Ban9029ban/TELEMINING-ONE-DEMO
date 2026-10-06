from __future__ import annotations
import asyncio, hmac, json, os, sqlite3, subprocess, time, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Header
from pydantic import BaseModel, Field, model_validator
from pymodbus.client import AsyncModbusTcpClient

DATA=Path(os.getenv('DATA_DIR','/data')); UP=DATA/'uploads'; EV=DATA/'evidence'; DB=DATA/'traffic.db'
UP.mkdir(parents=True,exist_ok=True); EV.mkdir(parents=True,exist_ok=True)
app=FastAPI(title='Control de Trafico - Standalone',version='1.0.0')
allowed_origins=[item.strip() for item in os.getenv('INTEGRATION_ALLOW_ORIGINS','http://localhost:8081').split(',') if item.strip()]
app.add_middleware(CORSMiddleware,allow_origins=allowed_origins,allow_methods=['GET'],allow_headers=['*'])
INTEGRATION_API_KEY=os.getenv('INTEGRATION_API_KEY','')

def require_integration_key(value: Optional[str]):
    if not INTEGRATION_API_KEY or not value or not hmac.compare_digest(value,INTEGRATION_API_KEY):
        raise HTTPException(401,'Credencial de integración inválida')
app.mount('/static',StaticFiles(directory=Path(__file__).parent/'static'),name='static')
app.mount('/uploads',StaticFiles(directory=UP),name='uploads')
app.mount('/evidence',StaticFiles(directory=EV),name='evidence')

def con():
    c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c

def init_db():
    c=con(); c.executescript('''
    CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY,v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS barriers(
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sector TEXT DEFAULT '',
      enabled INTEGER DEFAULT 0, lifecycle TEXT DEFAULT 'installation', driver TEXT DEFAULT 'mock',
      plc_ip TEXT DEFAULT '', plc_port INTEGER DEFAULT 502, device_id INTEGER DEFAULT 255,
      open_write_addr INTEGER DEFAULT 0, close_write_addr INTEGER DEFAULT 1,
      state_read_addr INTEGER DEFAULT 8258, state_read_count INTEGER DEFAULT 3,
      idx_closed INTEGER DEFAULT 0, idx_open INTEGER DEFAULT 1, idx_ir INTEGER DEFAULT 2, ir_active_high INTEGER DEFAULT 1,
      camera_url TEXT DEFAULT '', camera_snapshot_url TEXT DEFAULT '',
      map_x REAL, map_y REAL, map_scale REAL DEFAULT 0.6, created_at TEXT, updated_at TEXT,
      plc_online INTEGER DEFAULT 0, is_open INTEGER DEFAULT 0, is_closed INTEGER DEFAULT 1, ir_intrusion INTEGER DEFAULT 0,
      moving INTEGER DEFAULT 0, fault INTEGER DEFAULT 0, camera_online INTEGER DEFAULT 0, control_mode TEXT DEFAULT 'remote',
      last_seen TEXT DEFAULT '', last_error TEXT DEFAULT '', last_change TEXT DEFAULT '', people_count INTEGER DEFAULT 0, last_person_crossing TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, barrier_id INTEGER NOT NULL, ts TEXT NOT NULL, level TEXT NOT NULL,
      event_type TEXT NOT NULL, message TEXT NOT NULL, actor TEXT DEFAULT 'system', evidence_url TEXT DEFAULT '',
      FOREIGN KEY(barrier_id) REFERENCES barriers(id)
    );
    ''')
    existing={row[1] for row in c.execute('PRAGMA table_info(barriers)').fetchall()}
    for name, definition in {
      'moving':'INTEGER DEFAULT 0', 'fault':'INTEGER DEFAULT 0', 'camera_online':'INTEGER DEFAULT 0',
      'control_mode':"TEXT DEFAULT 'remote'", 'last_change':"TEXT DEFAULT ''", 'people_count':'INTEGER DEFAULT 0', 'last_person_crossing':"TEXT DEFAULT ''", 'map_scale':'REAL DEFAULT 0.6'
    }.items():
      if name not in existing: c.execute(f'ALTER TABLE barriers ADD COLUMN {name} {definition}')
    c.commit(); c.close()
init_db()

def now(): return datetime.now(timezone.utc).isoformat()
def event(bid,typ,msg,level='info',actor='system',evidence=''):
    c=con(); c.execute('INSERT INTO events(barrier_id,ts,level,event_type,message,actor,evidence_url) VALUES(?,?,?,?,?,?,?)',(bid,now(),level,typ,msg,actor,evidence)); c.commit(); c.close()

def rowdict(r): return dict(r) if r else None

class BarrierIn(BaseModel):
    code:str; name:str; sector:str=''; enabled:bool=False; lifecycle:Literal['installation','operational','maintenance']='installation'; driver:Literal['mock','modbus_tcp']='mock'
    plc_ip:str=''; plc_port:int=Field(default=502,ge=1,le=65535); device_id:int=Field(default=255,ge=0,le=255)
    open_write_addr:int=Field(default=0,ge=0); close_write_addr:int=Field(default=1,ge=0); state_read_addr:int=Field(default=8258,ge=0); state_read_count:int=Field(default=3,ge=1)
    idx_closed:int=Field(default=0,ge=0); idx_open:int=Field(default=1,ge=0); idx_ir:int=Field(default=2,ge=0); ir_active_high:bool=True
    camera_url:str=''; camera_snapshot_url:str=''; map_x:Optional[float]=None; map_y:Optional[float]=None; map_scale:float=Field(default=0.6,ge=.5,le=2.5)
    @model_validator(mode='after')
    def validate_state_indexes(self):
        if max(self.idx_closed,self.idx_open,self.idx_ir)>=self.state_read_count:
            raise ValueError('Cantidad bits debe cubrir todos los índices de estado')
        return self
class Pos(BaseModel): x:float; y:float
class Cmd(BaseModel): actor:str='operator'
class CameraStatus(BaseModel): online:bool
class MapSet(BaseModel): url:str
class SettingIn(BaseModel): value:str

@app.get('/')
def index(): return FileResponse(Path(__file__).parent/'static'/'index.html')

@app.get('/embed')
def embed(): return FileResponse(Path(__file__).parent/'static'/'index.html')
@app.get('/api/health')
def health(): return {'ok':True,'service':'control-trafico-standalone'}
@app.get('/api/settings')
def settings():
    c=con(); rows=c.execute('SELECT k,v FROM settings').fetchall(); c.close(); return {r['k']:r['v'] for r in rows}
@app.put('/api/settings/{key}')
def update_setting(key:str, body:SettingIn):
    if key not in {'map_zoom'}: raise HTTPException(400,'Configuracion no permitida')
    try: value=str(max(0.5,min(1.5,float(body.value))))
    except ValueError: raise HTTPException(400,'Valor de zoom invalido')
    c=con(); c.execute('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',(key,value)); c.commit(); c.close(); return {key:value}

@app.post('/api/map/upload')
async def upload_map(file:UploadFile=File(...)):
    ext=Path(file.filename or '').suffix.lower();
    if ext not in {'.png','.jpg','.jpeg','.webp','.svg'}: raise HTTPException(400,'Formato de plano no soportado')
    name='map'+ext; p=UP/name; p.write_bytes(await file.read()); url='/uploads/'+name
    c=con(); c.execute('INSERT INTO settings(k,v) VALUES("map_url",?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',(url,)); c.commit(); c.close(); return {'url':url}
def integration_view(row):
    return {
      'id':row['id'],'code':row['code'],'name':row['name'],'sector':row['sector'],
      'enabled':bool(row['enabled']),'lifecycle':row['lifecycle'],'line_online':bool(row['plc_online']) or row['driver']=='mock',
      'position':'open' if row['is_open'] else 'closed' if row['is_closed'] else 'moving' if row['moving'] else 'unknown',
      'fault':bool(row['fault']),'ir_alarm':bool(row['ir_intrusion']),'people_count_estimated':int(row['people_count'] or 0),
      'last_seen':row['last_seen'],'last_change':row['last_change'],'last_person_crossing':row['last_person_crossing']
    }

@app.get('/api/integration/summary',tags=['integration'])
def integration_summary(x_integration_key: Optional[str]=Header(default=None,alias='X-Integration-Key')):
    require_integration_key(x_integration_key)
    c=con(); rows=[rowdict(row) for row in c.execute('SELECT * FROM barriers ORDER BY name').fetchall()]; c.close()
    barriers=[integration_view(row) for row in rows]
    return {'service':'control-trafico','version':'1.0','read_only':True,'generated_at':now(),'totals':{
      'barriers':len(barriers),'operational':sum(1 for item in barriers if item['enabled'] and item['lifecycle']=='operational'),
      'line_online':sum(1 for item in barriers if item['line_online']),'alarms':sum(1 for item in barriers if item['ir_alarm'] or item['fault']),
      'people_count_estimated':sum(item['people_count_estimated'] for item in barriers)
    },'barriers':barriers}

@app.get('/api/integration/events',tags=['integration'])
def integration_events(limit:int=50,x_integration_key: Optional[str]=Header(default=None,alias='X-Integration-Key')):
    require_integration_key(x_integration_key)
    c=con(); rows=c.execute('''SELECT events.ts,events.level,events.event_type,events.message,events.actor,barriers.code AS barrier_code,barriers.name AS barrier_name
      FROM events JOIN barriers ON barriers.id=events.barrier_id ORDER BY events.id DESC LIMIT ?''',(min(max(limit,1),200),)).fetchall(); c.close()
    return {'service':'control-trafico','read_only':True,'events':[dict(row) for row in rows]}

@app.get('/api/barriers')

def list_barriers():
    c=con(); rows=c.execute('SELECT * FROM barriers ORDER BY name').fetchall(); c.close(); return [rowdict(r) for r in rows]
@app.get('/api/events')
def all_events(limit:int=200):
    c=con(); rows=c.execute('''SELECT events.*, barriers.code AS barrier_code, barriers.name AS barrier_name
      FROM events JOIN barriers ON barriers.id=events.barrier_id ORDER BY events.id DESC LIMIT ?''',(min(limit,1000),)).fetchall(); c.close(); return [rowdict(r) for r in rows]
@app.post('/api/barriers')
def create_barrier(b:BarrierIn):
    c=con(); ts=now()
    try:
      cur=c.execute('''INSERT INTO barriers(code,name,sector,enabled,lifecycle,driver,plc_ip,plc_port,device_id,open_write_addr,close_write_addr,state_read_addr,state_read_count,idx_closed,idx_open,idx_ir,ir_active_high,camera_url,camera_snapshot_url,map_x,map_y,map_scale,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(b.code,b.name,b.sector,int(b.enabled),b.lifecycle,b.driver,b.plc_ip,b.plc_port,b.device_id,b.open_write_addr,b.close_write_addr,b.state_read_addr,b.state_read_count,b.idx_closed,b.idx_open,b.idx_ir,int(b.ir_active_high),b.camera_url,b.camera_snapshot_url,b.map_x,b.map_y,b.map_scale,ts,ts)); c.commit(); bid=cur.lastrowid
    except sqlite3.IntegrityError: c.close(); raise HTTPException(409,'El codigo ya existe')
    r=c.execute('SELECT * FROM barriers WHERE id=?',(bid,)).fetchone(); c.close(); event(bid,'CREATED','Barrera creada','info','admin'); return rowdict(r)
@app.put('/api/barriers/{bid}')
def update_barrier(bid:int,b:BarrierIn):
    c=con();
    if not c.execute('SELECT 1 FROM barriers WHERE id=?',(bid,)).fetchone(): c.close(); raise HTTPException(404,'No existe')
    c.execute('''UPDATE barriers SET code=?,name=?,sector=?,enabled=?,lifecycle=?,driver=?,plc_ip=?,plc_port=?,device_id=?,open_write_addr=?,close_write_addr=?,state_read_addr=?,state_read_count=?,idx_closed=?,idx_open=?,idx_ir=?,ir_active_high=?,camera_url=?,camera_snapshot_url=?,map_x=?,map_y=?,map_scale=?,updated_at=? WHERE id=?''',(b.code,b.name,b.sector,int(b.enabled),b.lifecycle,b.driver,b.plc_ip,b.plc_port,b.device_id,b.open_write_addr,b.close_write_addr,b.state_read_addr,b.state_read_count,b.idx_closed,b.idx_open,b.idx_ir,int(b.ir_active_high),b.camera_url,b.camera_snapshot_url,b.map_x,b.map_y,b.map_scale,now(),bid)); c.commit(); r=c.execute('SELECT * FROM barriers WHERE id=?',(bid,)).fetchone(); c.close(); event(bid,'UPDATED','Configuracion actualizada','info','admin'); return rowdict(r)
@app.delete('/api/barriers/{bid}')
def delete_barrier(bid:int):
    c=con(); c.execute('DELETE FROM events WHERE barrier_id=?',(bid,)); c.execute('DELETE FROM barriers WHERE id=?',(bid,)); c.commit(); c.close(); return {'ok':True}
@app.post('/api/barriers/{bid}/position')
def position(bid:int,p:Pos):
    c=con(); c.execute('UPDATE barriers SET map_x=?,map_y=?,updated_at=? WHERE id=?',(p.x,p.y,now(),bid)); c.commit(); c.close(); event(bid,'POSITION','Posicion actualizada en plano','info','admin'); return {'ok':True}

async def read_modbus(b):
    cl=AsyncModbusTcpClient(b['plc_ip'],port=b['plc_port'],timeout=2)
    try:
      if not await cl.connect(): return None,'No conecta TCP'
      rr=await cl.read_coils(address=b['state_read_addr'],count=b['state_read_count'],device_id=b['device_id'])
      if rr.isError(): return None,str(rr)
      bits=list(rr.bits)[:b['state_read_count']]
      closed=bool(bits[b['idx_closed']]); opened=bool(bits[b['idx_open']]); raw_ir=bool(bits[b['idx_ir']]); intrusion=raw_ir if b['ir_active_high'] else not raw_ir
      return {'plc_online':1,'is_closed':int(closed),'is_open':int(opened),'ir_intrusion':int(intrusion)},''
    except Exception as e: return None,str(e)
    finally: cl.close()

@app.post('/api/barriers/{bid}/test')
async def test_barrier(bid:int):
    c=con(); b=c.execute('SELECT * FROM barriers WHERE id=?',(bid,)).fetchone(); c.close();
    if not b: raise HTTPException(404,'No existe')
    b=rowdict(b)
    if b['driver']=='mock': return {'ok':True,'driver':'mock','state':{'plc_online':1,'is_closed':b['is_closed'],'is_open':b['is_open'],'ir_intrusion':b['ir_intrusion']}}
    st,err=await read_modbus(b); return {'ok':bool(st),'state':st,'error':err}

async def pulse(b,addr):
    if b['driver']=='mock': return True,''
    cl=AsyncModbusTcpClient(b['plc_ip'],port=b['plc_port'],timeout=2)
    try:
      if not await cl.connect(): return False,'No conecta TCP'
      a=await cl.write_coil(address=addr,value=True,device_id=b['device_id']);
      if a.isError(): return False,str(a)
      await asyncio.sleep(.25)
      z=await cl.write_coil(address=addr,value=False,device_id=b['device_id']); return (not z.isError(), '' if not z.isError() else str(z))
    except Exception as e: return False,str(e)
    finally: cl.close()

@app.post('/api/barriers/{bid}/command/{cmd}')
async def command(bid:int,cmd:str,body:Cmd):
    c=con(); br=c.execute('SELECT * FROM barriers WHERE id=?',(bid,)).fetchone(); c.close();
    if not br: raise HTTPException(404,'No existe')
    b=rowdict(br); cmd=cmd.lower()
    if cmd not in {'open','close'}: raise HTTPException(400,'Comando invalido')
    if b.get('control_mode','remote') != 'remote': raise HTTPException(409,'Mando bloqueado: barrera en modo LOCAL')
    if cmd=='close' and b['ir_intrusion']: raise HTTPException(409,'Cierre bloqueado: cortina IR transgredida')
    addr=b['open_write_addr'] if cmd=='open' else b['close_write_addr']; ok,err=await pulse(b,addr)
    if not ok: event(bid,'COMMAND_FAILED',f'Fallo comando {cmd}: {err}','error',body.actor); raise HTTPException(502,err)
    event(bid,'OPEN_REQUEST' if cmd=='open' else 'CLOSE_REQUEST','Solicitud de APERTURA enviada' if cmd=='open' else 'Solicitud de CIERRE enviada','info',body.actor)
    if b['driver']=='mock':
      c=con(); c.execute('UPDATE barriers SET is_open=?,is_closed=?,moving=0,fault=0,plc_online=1,last_seen=?,last_change=?,updated_at=? WHERE id=?',(1 if cmd=='open' else 0,0 if cmd=='open' else 1,now(),now(),now(),bid)); c.commit(); c.close(); event(bid,'OPENED' if cmd=='open' else 'CLOSED','Barrera confirmo ABIERTA' if cmd=='open' else 'Barrera confirmo CERRADA')
    return {'ok':True}
@app.post('/api/barriers/{bid}/camera-status')
def camera_status(bid:int, body:CameraStatus):
    c=con(); c.execute('UPDATE barriers SET camera_online=?,updated_at=? WHERE id=?',(int(body.online),now(),bid)); c.commit(); c.close(); return {'ok':True}
@app.post('/api/barriers/{bid}/mock/intrusion')
def mock_intrusion(bid:int):
    c=con(); b=c.execute('SELECT * FROM barriers WHERE id=?',(bid,)).fetchone();
    if not b: c.close(); raise HTTPException(404,'No existe')
    if b['driver']!='mock': c.close(); raise HTTPException(400,'Solo mock')
    new=0 if b['ir_intrusion'] else 1; ts=now(); c.execute('UPDATE barriers SET ir_intrusion=?,plc_online=1,last_seen=?,people_count=people_count+?,last_person_crossing=CASE WHEN ? THEN ? ELSE last_person_crossing END WHERE id=?',(new,ts,int(new),int(new),ts,bid)); c.commit(); c.close(); event(bid,'PERSON_CROSSING_IR' if new else 'IR_CLEAR','Paso detectado por cortina IR (conteo estimado)' if new else 'Cortina IR liberada','critical' if new else 'info'); return {'ok':True,'ir_intrusion':new}
@app.get('/api/barriers/{bid}/events')
def events(bid:int,limit:int=50):
    c=con(); rows=c.execute('SELECT * FROM events WHERE barrier_id=? ORDER BY id DESC LIMIT ?',(bid,min(limit,500))).fetchall(); c.close(); return [rowdict(r) for r in rows]

_prev={}
async def monitor():
  while True:
    try:
      c=con(); rows=c.execute("SELECT * FROM barriers WHERE enabled=1 AND lifecycle='operational'").fetchall(); c.close()
      for rr in rows:
        b=rowdict(rr); bid=b['id']; old=_prev.get(bid,{'plc_online':b['plc_online'],'is_open':b['is_open'],'is_closed':b['is_closed'],'ir_intrusion':b['ir_intrusion']})
        if b['driver']=='mock': st={'plc_online':1,'is_open':b['is_open'],'is_closed':b['is_closed'],'ir_intrusion':b['ir_intrusion']}; err=''
        else: st,err=await read_modbus(b); st=st or {'plc_online':0,'is_open':b['is_open'],'is_closed':b['is_closed'],'ir_intrusion':b['ir_intrusion']}
        moving=int(not st['is_open'] and not st['is_closed'] and st['plc_online']); fault=int((st['is_open'] and st['is_closed']) or bool(err))
        changed=old['is_open']!=st['is_open'] or old['is_closed']!=st['is_closed']
        person_crossing=int(not old['ir_intrusion'] and st['ir_intrusion'])
        ts=now()
        c=con(); c.execute('UPDATE barriers SET plc_online=?,is_open=?,is_closed=?,ir_intrusion=?,moving=?,fault=?,last_seen=?,last_error=?,last_change=CASE WHEN ? THEN ? ELSE last_change END,people_count=people_count+?,last_person_crossing=CASE WHEN ? THEN ? ELSE last_person_crossing END WHERE id=?',(st['plc_online'],st['is_open'],st['is_closed'],st['ir_intrusion'],moving,fault,ts if st['plc_online'] else b['last_seen'],err,int(changed),ts,person_crossing,person_crossing,ts,bid)); c.commit(); c.close()
        if old['plc_online']!=st['plc_online']: event(bid,'PLC_ONLINE' if st['plc_online'] else 'PLC_OFFLINE','PLC online' if st['plc_online'] else 'PLC sin comunicacion','info' if st['plc_online'] else 'error')
        if old['is_open']!=st['is_open'] and st['is_open']: event(bid,'OPENED','Barrera confirmo estado ABIERTA')
        if old['is_closed']!=st['is_closed'] and st['is_closed']: event(bid,'CLOSED','Barrera confirmo estado CERRADA')
        if old['ir_intrusion']!=st['ir_intrusion']: event(bid,'IR_INTRUSION' if st['ir_intrusion'] else 'IR_CLEAR','TRANSGRESION cortina IR' if st['ir_intrusion'] else 'Cortina IR liberada','critical' if st['ir_intrusion'] else 'info')
        _prev[bid]=st
    except Exception as e: print('monitor',e)
    await asyncio.sleep(1)
@app.on_event('startup')
async def startup(): asyncio.create_task(monitor())







