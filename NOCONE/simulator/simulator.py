
import asyncio, random, uuid, argparse, time, yaml, sys, json
from datetime import datetime, timezone, timedelta
from rich.console import Console
from rich.table import Table
from rich.live import Live
try:
    import aiohttp
except ImportError:
    aiohttp = None
console = Console()
def now_iso(dt=None): return (dt or datetime.now(timezone.utc)).isoformat().replace("+00:00","Z")
class Entity:
    def __init__(self, name, uuid_s, major, minor, route, speed_mps):
        self.name=name; self.uuid=uuid_s; self.major=int(major); self.minor=int(minor)
        self.route=list(route or []); self.idx=0; self.speed_mps=float(speed_mps or 1.0)
        self.last_zone = self.route[0] if self.route else "PORTICO-1"; self.last_move = time.time()
    def next_zone(self):
        if not self.route: return self.last_zone
        if time.time()-self.last_move >= max(1.0, 10.0/self.speed_mps):
            self.idx = (self.idx+1) % len(self.route); self.last_zone = self.route[self.idx]; self.last_move = time.time()
        return self.last_zone
def sample_rssi(base=-62, var=8): return int(random.gauss(base, var/2))
def build_event(edge_id, ent, zone, rssi, jitter_ms=250):
    j = random.randint(0, max(0, int(jitter_ms))); ts = datetime.now(timezone.utc) - timedelta(milliseconds=j)
    payload = {"uuid": ent.uuid, "major": ent.major, "minor": ent.minor, "rssi": rssi, "zone": zone}
    return {"msg_id": str(uuid.uuid4()), "edge_id": edge_id, "ts_edge": ts.isoformat().replace("+00:00","Z"), "type": "ble", "payload": payload}
async def http_sender(session, url, queue):
    while True:
        batch=[]
        try:
            while len(batch)<20:
                batch.append(queue.get_nowait())
        except asyncio.QueueEmpty:
            pass
        if not batch:
            await asyncio.sleep(0.02)
            continue
        data = batch[0] if len(batch)==1 else {"events": batch}
        try:
            async with session.post(url, json=data, timeout=5) as r:
                _ = await r.text()
        except Exception:
            pass
        await asyncio.sleep(0.005)
        
async def tcp_sender(host, port, queue):
    reader, writer = await asyncio.open_connection(host, port)
    while True:
        evt = await queue.get()
        line = (json.dumps(evt) + "\n").encode(); writer.write(line)
        try: await writer.drain(); await reader.readline()
        except Exception: 
            try: writer.close(); await writer.wait_closed()
            except: pass
            reader, writer = await asyncio.open_connection(host, port)
async def simulator(cfg, args):
    mode = args.mode or cfg.get("mode","http"); host = args.host or cfg.get("listener",{}).get("host","127.0.0.1")
    http_port = args.http_port or cfg.get("listener",{}).get("http_port",8080)
    tcp_port  = args.tcp_port  or cfg.get("listener",{}).get("tcp_port",7070)
    rate = args.rate or cfg.get("rate_per_sec",10); jitter = cfg.get("jitter_ms",250)
    rssi_base = cfg.get("rssi_base",-62); rssi_var = cfg.get("rssi_var",8)
    entities_cfg = cfg.get("entities",[])
    if args.entities and args.entities > len(entities_cfg):
        base = entities_cfg[:]
        while len(entities_cfg) < args.entities:
            e = random.choice(base).copy(); e["minor"] = random.randint(1000,9000); e["name"] = f"{e.get('name','ent')}-{e['minor']}"; entities_cfg.append(e)
    entities = [Entity(e["name"], e["uuid"], e["major"], e["minor"], e.get("route") or [], e.get("speed_mps") or 1.0) for e in entities_cfg]
    queue = asyncio.Queue(maxsize=2000); edge_ids = ["UR-T-001","UR-S-011","UR-T-042","UR-S-100"]
    async def producer():
        while True:
            for ent in entities:
                zone = ent.next_zone(); evt = build_event(random.choice(edge_ids), ent, zone, sample_rssi(rssi_base, rssi_var), jitter)
                try: queue.put_nowait(evt)
                except asyncio.QueueFull: await asyncio.sleep(0.01)
            await asyncio.sleep(max(0.0, 1.0/max(1, rate)))
    tasks = [asyncio.create_task(producer())]
    if mode == "http":
        if aiohttp is None: console.print("[red]aiohttp no instalado. pip install -r requirements.txt[/red]"); return
        url = f"http://{host}:{http_port}/ingest"; session = aiohttp.ClientSession(); tasks.append(asyncio.create_task(http_sender(session, url, queue)))
    else:
        tasks.append(asyncio.create_task(tcp_sender(host, tcp_port, queue)))
    table = Table(title="ZENIT Tag Simulator", expand=True, show_lines=True); table.add_column("Modo"); table.add_column("Destino"); table.add_column("Entidades"); table.add_column("Tasa (ev/s)"); table.add_column("Cola")
    start = time.time()
    async def dashboard():
        with Live(table, console=console, refresh_per_second=4):
            while True:
                qsize = queue.qsize(); table.rows = []; table.add_row(mode, f"{host}:{http_port if mode=='http' else tcp_port}", str(len(entities)), str(rate), str(qsize)); await asyncio.sleep(0.25)
    tasks.append(asyncio.create_task(dashboard()))
    if args.duration: await asyncio.sleep(args.duration); [t.cancel() for t in tasks]
    else: await asyncio.gather(*tasks)
def main():
    ap = argparse.ArgumentParser(description="ZENIT Tag Simulator")
    ap.add_argument("--config", default="config.yaml"); ap.add_argument("--mode", choices=["http","tcp"]); ap.add_argument("--host")
    ap.add_argument("--http-port", type=int); ap.add_argument("--tcp-port", type=int); ap.add_argument("--rate", type=int)
    ap.add_argument("--entities", type=int); ap.add_argument("--duration", type=int)
    args = ap.parse_args(); cfg = yaml.safe_load(open(args.config,"r",encoding="utf-8")) or {}
    try: asyncio.run(simulator(cfg, args))
    except KeyboardInterrupt: console.print("[yellow]Detenido por usuario.[/yellow]")
if __name__ == "__main__": main()
