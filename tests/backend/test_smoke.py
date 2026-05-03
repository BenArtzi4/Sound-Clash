"""Phase 1 smoke test — proves the test harness works.

Real tests arrive in Phase 4 per docs/testing-strategy.md §4.2.
"""

from __future__ import annotations


def test_smoke() -> None:
    """Sanity: 1 + 1 = 2. Replaces with real tests in Phase 4."""
    assert 1 + 1 == 2


def test_import_app() -> None:
    """The FastAPI app module imports without error."""
    from app.main import app

    assert app.title == "Sound Clash API"
