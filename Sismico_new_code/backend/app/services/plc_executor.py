
import subprocess
import os

PLC_IP_1 = os.getenv("PLC_IP_1", "192.168.1.10")
PLC_IP_2 = os.getenv("PLC_IP_2", "192.168.1.30")

SCRIPT_PATH = os.getenv("PLC_SCRIPT", "/app/plcctl.py")

def run_cmd(args):
    cmd = ["python3", SCRIPT_PATH] + args
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(res.stderr.strip() or res.stdout)
    return res.stdout.strip()

def write(tag, val, ip=PLC_IP_1):
    return run_cmd(["--ip", ip, "--type", "delta", "--write", f"{tag}={val}"])

def pulse(tag, ms=500, ip=PLC_IP_1):
    return run_cmd(["--ip", ip, "--type", "delta", "--pulse", tag, "--ms", str(ms)])

def read(tag, ip=PLC_IP_1):
    return run_cmd(["--ip", ip, "--type", "delta", "--read", tag])
