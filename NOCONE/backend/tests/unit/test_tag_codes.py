from app.core.tag_codes import normalize_tag_code


def test_normalize_tag_code_keeps_hex_epc():
    assert normalize_tag_code("000000000000000000112616") == "000000000000000000112616"


def test_normalize_tag_code_decodes_base64_epc():
    assert normalize_tag_code("AAAAAAAAAAAAESYW") == "000000000000000000112616"


def test_normalize_tag_code_decodes_urlsafe_base64_epc():
    assert normalize_tag_code("MDS3CLQrjYSqLtN2") == "3034B708B42B8D84AA2ED376"


def test_normalize_tag_code_strips_mac_separators():
    assert normalize_tag_code("80:ec:cc:ce:ed:1b") == "80ECCCCEED1B"
