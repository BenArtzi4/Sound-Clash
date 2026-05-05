"""Conditional Sentry init.

Skips initialization in tests (``PYTEST_CURRENT_TEST`` is set by pytest)
and when ``SENTRY_DSN_BACKEND`` is empty.
"""

from __future__ import annotations

import os

from app.config import get_settings


def install() -> None:
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    dsn = get_settings().sentry_dsn_backend
    if not dsn:
        return

    import sentry_sdk

    sentry_sdk.init(dsn=dsn, traces_sample_rate=0.0, send_default_pii=False)
