from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from datetime import date
from io import BytesIO
import pandas as pd
from app.legacy.control.utils.people import get_person_data
from app.legacy.control.utils.vehicles import get_vehicle_data
from app.legacy.control.utils.graphics import get_graphic_data

router = APIRouter()

@router.get("/generate-excel")
async def generate_excel_report(
    start_date: str = Query("2024-01-01"),
    end_date: str = Query(date.today().strftime("%Y-%m-%d")),
    filename: str = Query("Reporte_Zenit"),
    include_vehicle_status: bool = Query(True),
    include_people_per_level: bool = Query(True),
    include_vehicles_per_level: bool = Query(True),
    include_zenit_system_status: bool = Query(True),
):
    data = get_graphic_data(False, start_date, end_date)
    vehicle_data = get_vehicle_data(start_date, end_date)
    person_data = get_person_data(start_date, end_date)
    dfs = {}
    if include_vehicle_status:
        dfs['Estado Vehiculos'] = pd.DataFrame([data['vehicleStatus']])
    if include_people_per_level:
        dfs['Personas por Nivel'] = pd.DataFrame([data['peoplePerLevel']])
    if include_vehicles_per_level:
        conteo_vehiculos = data['vehiclesPerLevel']['conteo_vehiculos_por_nivel']
        flat_records = []
        for nivel, conteo in conteo_vehiculos.items():
            for tipo, cantidad in conteo.items():
                flat_records.append({"Nivel": nivel, "Tipo": tipo, "Cantidad": cantidad})
        dfs['Vehiculos por Nivel'] = pd.DataFrame(flat_records)
    if include_zenit_system_status:
        dfs['Sistema Zenit'] = pd.DataFrame([data['zenitSystemStatus']])
    dfs['Personas Detalle'] = pd.DataFrame(person_data)
    dfs['Vehiculos Detalle'] = pd.DataFrame(vehicle_data)
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        for sheet_name, df in dfs.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)
    output.seek(0)
    headers = {
        'Content-Disposition': f'attachment; filename="{filename}.xlsx"'
    }
    return StreamingResponse(output, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers=headers)