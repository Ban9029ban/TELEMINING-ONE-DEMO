from pathlib import Path

from PIL import Image

from app.services.source_parsers import parse_payload_detail


def test_legacy_andesita_invalid_json_falls_back_to_html():
    html = """
    <table>
      <tr>
        <td>Andesita Norte HW</td>
        <td>SUPERIOR</td>
      </tr>
    </table>
    """

    result = parse_payload_detail(
        "legacy_andesita",
        html,
        "application/json",
        site_code="andesita",
        endpoint_code="andesita_legacy_json",
    )

    assert result.endpoint_kind == "html_fallback"
    assert result.states["Andesita Norte HW"] == "superior"


def test_local_capture_assets_are_used_when_endpoint_is_file(tmp_path: Path):
    html_path = tmp_path / "diamante_legacy_resumen.html"
    asset_path = tmp_path / "diamante_legacy_resumen__asset_1.png"

    Image.new("RGBA", (60, 24), (220, 20, 20, 255)).save(asset_path)
    html_path.write_text(
        """
        <table>
          <tr>
            <td>Bajo Diamante Esmeralda</td>
            <td><img src="/site_media/graph/html/sectores/Bajo_Diamante_Esmeralda/estado.png" /></td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    result = parse_payload_detail(
        "legacy_diamante",
        html_path.read_text(encoding="utf-8"),
        "text/html; charset=utf-8",
        endpoint_url=html_path.as_uri(),
        endpoint_code="diamante_legacy_resumen",
        site_code="diamante",
    )

    matched = next(match for match in result.matches if match.expected_polygon == "Bajo Diamante Esmeralda")
    assert matched.operational_state == "superior"
    assert matched.image_url is not None and matched.image_url.startswith("file://")
