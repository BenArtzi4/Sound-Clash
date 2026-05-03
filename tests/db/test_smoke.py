"""Phase 1 smoke test for the db tests directory.

Real DB tests arrive in Phase 3 per docs/testing-strategy.md §4.1.
"""

from __future__ import annotations


def test_smoke() -> None:
    """Sanity test so CI confirms pytest discovery works in tests/db/."""
    assert True


def test_placeholder_fixture(placeholder: str) -> None:
    """The conftest fixture is wired up correctly."""
    assert "Phase 3" in placeholder
