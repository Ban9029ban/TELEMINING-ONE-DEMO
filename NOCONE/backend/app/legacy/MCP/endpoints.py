from fastapi import APIRouter, HTTPException, Depends
from app.legacy.MCP.models import UserMessage
from app.legacy.MCP.services.chatgpt_router import interpret_response, interpret_message
from app.legacy.MCP.services.operation_handler import ejecutar_operaciones
from app.legacy.MCP.services.utils import extract_table_titles
import json
from app.legacy.telemining.database import get_db
from sqlalchemy.orm import Session

router = APIRouter()

@router.post("/consulta")
def process_query(msg: UserMessage, db: Session = Depends(get_db)):
    """
    Procesa la consulta del usuario y enruta las operaciones solicitadas al agente correspondiente.

    Args:
        msg (UserMessage): Mensaje natural del usuario.

    Returns:
        dict: Respuesta final interpretada por ChatGPT.
    """

    try:
        print("--"* 40)
        print("[DEBUG] Mensaje recibido:", msg.message)
        raw_json = interpret_message(msg.message)
        print("[DEBUG] Interpretación del modelo:", raw_json)

        ctx = json.loads(raw_json)
        operations = ctx.get("operations")
        functions = ctx.get("functions")

        if not operations or not functions:
            raise HTTPException(status_code=400, detail="Faltan parámetros requeridos: 'operations' y 'functions'.")
        
        print("[DEBUG] Operaciones a ejecutar:", operations)

        # Construimos el diccionario de parámetros opcionales
        optional_params = {
            "zone": ctx.get("zone"),
            "start_date": ctx.get("start_date"),
            "end_date": ctx.get("end_date"),
            "gas": ctx.get("gas")
        }

        print("[DEBUG] Parámetros opcionales:", optional_params)

        filtered_params = {k: v for k, v in optional_params.items() if v is not None}

        respuestas_agentes = ejecutar_operaciones(
            operations=operations,
            params={"db": db, "functions": functions, **filtered_params}
        )
        all_tables = []
        for agent_output in respuestas_agentes.values():
            if isinstance(agent_output, dict) and "tables" in agent_output:
                all_tables.extend(agent_output["tables"])
        
        titles = list(extract_table_titles(respuestas_agentes))

        mensaje = interpret_response({
            "Mensaje_Usuario": msg.message,
            "titulos": titles
        })
        print("[DEBUG] Respuesta del modelo:", mensaje)

        return {
            "respuesta": mensaje,
            "tables": all_tables
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="La respuesta del modelo no es un JSON válido.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al procesar la consulta: {str(e)}")
