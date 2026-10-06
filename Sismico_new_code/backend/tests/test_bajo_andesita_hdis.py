from io import BytesIO
from unittest.mock import patch
import unittest
from PIL import Image
from app.services.source_parsers import parse_payload_detail
from app.services.legacy_source_adapter import defaults_for_site

def assert_new_polygons_read_independent_hdis_images(site, endpoint, color, expected):
    def png(rgb):
        out=BytesIO(); Image.new("RGB",(60,24),rgb).save(out,format="PNG"); return out.getvalue()
    html='<table><tr><td>Polígono Bajo Andesita Profundo</td><td><img src="/profundo/estado.png"></td></tr><tr><td>Poligono Bajo Andesita Under</td><td><img src="/under/estado.png"></td></tr></table>'
    with patch("app.services.source_parsers._load_image_bytes", side_effect=lambda url: png(color if "profundo" in url else (0,0,0))):
        result=parse_payload_detail("legacy_tunel_correa" if "correa" in site else "legacy_andes_norte",html,"text/html",site_code=site,endpoint_code=endpoint,endpoint_url="http://10.18.18.83:8001/hdis1/resumen/")
    assert result.states["Poligono Bajo Andesita Profundo"] == expected
    assert result.states["Poligono Bajo Andesita Under"] == "centro"
    assert all(m.source_mode == "image" for m in result.matches if "Bajo Andesita" in m.expected_polygon)

def test_tc_defaults_use_hdis_not_template():
    endpoint=defaults_for_site("andes_norte_tunel_correa")[0]
    assert endpoint["endpoint_url"] == "http://10.18.18.83:8001/hdis1/resumen/"
    assert endpoint["parser_type"] == "legacy_tunel_correa"

def test_missing_reading_does_not_invent_new_polygon_state():
    result=parse_payload_detail("legacy_tunel_correa","<table></table>","text/html",site_code="andes_norte_tunel_correa")
    assert "Poligono Bajo Andesita Profundo" not in result.states
    assert "Poligono Bajo Andesita Under" not in result.states

class HdisNewPolygonsTest(unittest.TestCase):
    def test_colors_both_maps(self):
        for site,endpoint in [("andes_norte","andes_norte_legacy_main"),("andes_norte_tunel_correa","andes_norte_tunel_correa_template")]:
            for color,state in [((0,0,255),"inferior"),((0,0,0),"centro"),((255,0,0),"superior")]:
                with self.subTest(site=site,state=state):
                    assert_new_polygons_read_independent_hdis_images(site,endpoint,color,state)
    def test_endpoint(self): test_tc_defaults_use_hdis_not_template()
    def test_missing(self): test_missing_reading_does_not_invent_new_polygon_state()
if __name__ == "__main__": unittest.main()
