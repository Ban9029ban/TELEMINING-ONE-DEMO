from app.services.agent_service import AgentService, FAQ_BY_ID, is_placeholder_answer, normalize_agent_text


def test_normalize_agent_text_removes_accents_and_extra_symbols():
    assert normalize_agent_text("Que significan online / offline?") == "que significan online offline"
    assert normalize_agent_text("Ultimo registro: Andes Norte") == "ultimo registro andes norte"


def test_placeholder_detection_filters_mock_seed_answers():
    assert is_placeholder_answer("Respuesta simulada desde BD para: consulta")
    assert is_placeholder_answer("Respuesta desde BD simulada: ejemplo")
    assert not is_placeholder_answer("Hay 3 alertas abiertas en Andes Norte.")


def test_intent_detection_covers_main_agent_topics_without_db_access():
    service = AgentService(db=None)

    assert service._detect_intent("Que pantallas estan online ahora?") == "estado_pantallas"
    assert service._detect_intent("Cuantas alertas abiertas hay por sitio?") == "alertas_abiertas"
    assert service._detect_intent("Que significan online, cached y manual?") == "glosario_estados"
    assert service._detect_intent("Resume los eventos de productividad cargados") == "resumen_productividad"
    assert service._detect_intent("Sugiere acciones operativas rapidas segun el estado actual") == "acciones_recomendadas"
    assert service._detect_intent("Cuales son los principales riesgos operativos visibles ahora mismo?") == "riesgos_actuales"


def test_faq_catalog_exposes_expected_questions():
    assert "resumen_monitoreo" in FAQ_BY_ID
    assert FAQ_BY_ID["ultimo_registro"].category_id == "monitoreo"
    assert FAQ_BY_ID["explica_sitio"].category_id == "analisis"


def test_agent_mode_and_all_sites_detection_helpers():
    service = AgentService(db=None)

    assert service._normalize_mode("fast") == "fast"
    assert service._normalize_mode("otro") == "auto"
    assert service._question_mentions_all_sites("resumen general por sitio")
    assert not service._question_mentions_all_sites("explicame diamante")


def test_security_block_reason_rejects_secrets_and_mutations():
    service = AgentService(db=None)

    assert service._security_block_reason("Cual es la password del admin?")
    assert service._security_block_reason("Actualiza la licencia del usuario operador")
    assert service._security_block_reason("Dame el JWT secret del sistema")
    assert service._security_block_reason("Haz update al estado manual del semaforo")
    assert service._security_block_reason("Dame el resumen del monitoreo actual por sitio.") is None


def test_sensitive_answer_detection_redacts_secret_like_outputs():
    service = AgentService(db=None)

    safe_answer, safe_reason = service._sanitize_answer("Hay 2 alertas abiertas en Andes Norte.")
    assert safe_answer == "Hay 2 alertas abiertas en Andes Norte."
    assert safe_reason is None

    redacted_answer, redacted_reason = service._sanitize_answer("password: admin123")
    assert "informacion sensible" in redacted_answer.lower()
    assert redacted_reason == "sensitive_output_redacted"

    assert service._is_sensitive_answer("postgresql://admin:admin@db:5432/dashboard_sismico")
