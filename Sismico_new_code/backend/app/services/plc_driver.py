
from pymodbus.client import ModbusTcpClient

class PLCDriver:
    def __init__(self, host, port=502):
        self.client = ModbusTcpClient(host, port=port)

    def connect(self):
        return self.client.connect()

    def write_coil(self, address, value):
        self.client.write_coil(address, value)

    def close(self):
        self.client.close()
