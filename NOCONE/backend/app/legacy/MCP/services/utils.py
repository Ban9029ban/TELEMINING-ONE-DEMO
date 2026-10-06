from typing import Dict, Any

def extract_table_titles(agent_outputs: Dict[str, Any]) -> set:
    """
    Extrae los títulos de todas las tablas contenidas en la salida de los agentes.

    Args:
        agent_outputs (Dict[str, Any]): Diccionario con los resultados de cada agente.

    Returns:
        set: Un conjunto con los títulos de las tablas encontradas.
    """
    titles = set()
    for output in agent_outputs.values():
        if isinstance(output, dict) and "tables" in output:
            for table_entry in output["tables"]:
                title = table_entry.get("title")
                if title:
                    titles.add(title)
    return titles
