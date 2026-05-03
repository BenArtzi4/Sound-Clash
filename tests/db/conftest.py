"""Pytest fixtures for database tests.

Phase 1 placeholder. The actual `db_with_migrations` fixture (testcontainers-postgres
spinning up Postgres 15 + applying all `db/migrations/*.sql`) is implemented in Phase 3.

See docs/testing-strategy.md §4.1 and docs/rpc-functions.md.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def placeholder() -> str:
    """Phase 1 placeholder fixture so this conftest is non-empty."""
    return "Phase 3 will replace this with `db_with_migrations`."
