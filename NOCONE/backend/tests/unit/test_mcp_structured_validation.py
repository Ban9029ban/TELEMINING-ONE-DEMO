from app.routers.mcp import MCPStructuredAnswer, _looks_like_json_payload, _structured_answer_is_usable


def test_looks_like_json_payload_detects_embedded_json():
    assert _looks_like_json_payload('{ "headline": "x", "summary": "y" }')
    assert _looks_like_json_payload('  {"headline":"x","summary":"y"}  ') 
    assert _looks_like_json_payload('{ "headline": "x", "summary": "y", "details": ["a"] }')


def test_structured_answer_is_usable_rejects_raw_json_summary():
    structured = MCPStructuredAnswer(
        headline="Respuesta del agente",
        summary='{ "headline": "Haupsten", "summary": "..." }',
        follow_ups=["Puedo enfocarlo en una zona especifica si me indicas cual."],
    )
    assert not _structured_answer_is_usable(structured)


def test_structured_answer_is_usable_accepts_normal_summary():
    structured = MCPStructuredAnswer(
        headline="Resumen operativo disponible",
        summary="Hoy hay actividad en el sector sur y no hay alertas mayores.",
        details=["Sector sur activo"],
        evidence=["3 eventos de movimiento"],
        actions=["Revisar ingreso de personal"],
        follow_ups=["Dame un detalle por zona."],
    )
    assert _structured_answer_is_usable(structured)
