
from app.services.plc_executor import write, pulse

# M mapping based on user spec
# Pipa: M1 (verde), M2 (roja)
# Diamante FW: M3 (verde), M4 (roja)
# Diamante HW: M5 (verde), M6 (roja)
# Bajo Diamante: M7 (roja inf), M8 (verde centro), M9 (roja sup)
# Emergencia: M0 (parpadeo)

def set_normal():
    # verdes on, rojas off
    write("M1",1); write("M2",0)
    write("M3",1); write("M4",0)
    write("M5",1); write("M6",0)
    write("M7",0); write("M8",1); write("M9",0)
    write("M0",0)

def set_alerta():
    # rojas on, verdes off
    write("M1",0); write("M2",1)
    write("M3",0); write("M4",1)
    write("M5",0); write("M6",1)
    write("M7",1); write("M8",0); write("M9",1)
    write("M0",0)

def set_emergencia():
    # activar bit de emergencia (parpadeo en PLC)
    write("M0",1)
