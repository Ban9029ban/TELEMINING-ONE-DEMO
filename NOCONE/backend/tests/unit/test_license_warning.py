from datetime import date
from app.services.user_licenses import license_warning_due


def test_calendar_month_boundary():
    assert not license_warning_due(date(2026, 11, 24), date(2026, 9, 23))
    assert license_warning_due(date(2026, 11, 24), date(2026, 9, 24))
    assert license_warning_due(date(2026, 11, 24), date(2026, 11, 24))


def test_month_end_and_renewal():
    assert license_warning_due(date(2026, 4, 30), date(2026, 2, 28))
    assert not license_warning_due(date(2026, 4, 30), date(2026, 2, 27))
    assert not license_warning_due(date(2027, 9, 24), date(2026, 9, 24))
    assert not license_warning_due(None, date(2026, 9, 24))
