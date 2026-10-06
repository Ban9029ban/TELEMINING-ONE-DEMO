from app.services.sismico_operator_service import SismicoOperatorService


def test_canonical_object_code_supports_site_specific_aliases():
    service = SismicoOperatorService(db=None)

    assert service._canonical_object_code("andes_norte", "ann_monitoreo_post_evento_2025") == "monitoreo_post_evento_2025"
    assert service._canonical_object_code("andes_norte", "ann_monitoreo_post_evento") == "monitoreo_post_evento"
    assert service._canonical_object_code("andes_norte", "ann_p4600") == "p_4600"
    assert service._canonical_object_code("andes_norte", "ann_bajo_andes_norte") == "bajo_footprint_an"
    assert service._canonical_object_code("andes_norte_tunel_correa", "pilar_2_profundo") == "poligono_pilar_2"
    assert service._canonical_object_code("diamante", "bde") == "diamante_bajo_diamante_esmeralda"


def test_canonical_object_code_tolerates_hyphenated_site_codes():
    service = SismicoOperatorService(db=None)

    assert service._canonical_object_code("andes-norte", "ann_tc_oim") == "tc_oim"
