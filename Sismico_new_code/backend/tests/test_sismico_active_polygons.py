from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.api.routes import sismico
from app.core.state_codes import CRITICAL
from app.services.sismico_service import SismicoService


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def join(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return self.rows


class FakeSession:
    def __init__(self, rows):
        self.rows = rows

    def query(self, *args, **kwargs):
        return FakeQuery(self.rows)


def test_active_polygon_notifications_include_map_and_human_state():
    observed_at = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    rows = [
        (
            SimpleNamespace(map_object_id=17, state_code=CRITICAL, raw_value='alerta', observed_at=observed_at, updated_at=observed_at),
            SimpleNamespace(code='diamante_pipa', name='Diamante PIPA'),
            SimpleNamespace(code='diamante_main', name='Diamante principal'),
            SimpleNamespace(code='diamante', name='Diamante'),
        )
    ]

    response = SismicoService(FakeSession(rows)).get_active_polygons()

    assert len(response.items) == 1
    assert response.items[0].map_object_id == 17
    assert response.items[0].map_code == 'diamante_main'
    assert response.items[0].state_label == 'ALERTA'


def test_test_alert_endpoint_injects_only_a_dry_run_alert():
    operator = Mock()
    operator.set_manual_object_state.return_value = {'effectiveStateCode': 'critical'}

    with patch.object(sismico, 'SismicoOperatorService', return_value=operator):
        response = sismico.inject_test_alert(
            site_code='andesita',
            polygon_code='andesita-norte-hw',
            db=object(),
        )

    assert response['ok'] is True
    assert response['alert']['effectiveStateCode'] == 'critical'
    operator.set_manual_object_state.assert_called_once_with(
        site_code='andesita',
        object_code='andesita-norte-hw',
        state_code='alerta',
        requested_by='sismico_test_alert_api',
        action_type='state_change',
        dry_run=True,
    )
