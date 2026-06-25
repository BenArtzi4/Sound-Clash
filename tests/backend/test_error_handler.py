"""domain_error_handler envelope behaviour.

5xx responses must not leak internal/DB error detail (table/column/constraint
names); 4xx responses keep their human-facing message.
"""

from __future__ import annotations

import json


async def test_internal_error_envelope_is_generic() -> None:
    from app.db.errors import InternalError
    from app.middleware.error_handler import domain_error_handler

    exc = InternalError('relation "songs" does not exist')
    resp = await domain_error_handler(None, exc)  # request arg is unused
    raw = resp.body.decode()
    assert resp.status_code == 500
    assert "songs" not in raw
    body = json.loads(raw)
    assert body["error"] == "internal_error"
    assert body["message"] == "internal server error"


async def test_client_error_envelope_preserves_message() -> None:
    from app.db.errors import NotFoundError
    from app.middleware.error_handler import domain_error_handler

    exc = NotFoundError("game ABCDEF not found")
    resp = await domain_error_handler(None, exc)
    raw = resp.body.decode()
    assert resp.status_code == 404
    body = json.loads(raw)
    assert body["error"] == "not_found"
    assert body["message"] == "game ABCDEF not found"
