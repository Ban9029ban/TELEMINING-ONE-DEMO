from pydantic import BaseModel

class DashboardSummary(BaseModel):
    sites_activos: int
    pantallas_online: int
    alertas_abiertas: int
    endpoints_ok: int
    endpoints_total: int
