from typing import List, Dict, Any
from app.legacy.MCP.agents.agents_factory import AgentFactory

def ejecutar_operaciones(operations: List[str], params: Dict[str, Any]) -> dict:
    responses = {}
    db = params.get("db")  # ✅ extraemos la sesión de base de datos

    print(f"[DEBUG] Ejecutando operaciones: {operations} con parámetros: {params}")

    for operation in operations:
        try:
            agent = AgentFactory.create_agent(
                agent_type=operation,
                db=db,  # ✅ pasamos la sesión explícitamente
                start_date=params.get("start_date"),
                end_date=params.get("end_date"),
                zone=params.get("zone"),
                functions=params.get("functions"),
                params=params  # puedes incluir otros parámetros personalizados aquí
            )
            responses[operation] = agent.run()
        except Exception as e:
            responses[operation] = f"[ERROR] Falló operación '{operation}': {str(e)}"

    return responses
