"""Postgres ``P0001`` / ``P0002`` / ``23505`` → HTTP envelope."""

from __future__ import annotations

import pytest

from app.db import errors as errors_module

pytestmark = pytest.mark.needs_docker


def test_p0002_maps_to_not_found() -> None:
    err = errors_module.map_postgrest_error(_apierror("P0002", "game_not_found"))
    assert isinstance(err, errors_module.NotFoundError)
    assert err.status == 404


def test_p0001_maps_to_conflict() -> None:
    err = errors_module.map_postgrest_error(_apierror("P0001", "game_already_ended"))
    assert isinstance(err, errors_module.ConflictError)
    assert err.status == 409


def test_unique_violation_maps_to_conflict() -> None:
    err = errors_module.map_postgrest_error(_apierror("23505", "duplicate"))
    assert isinstance(err, errors_module.ConflictError)


def test_fk_violation_maps_to_not_found() -> None:
    err = errors_module.map_postgrest_error(_apierror("23503", "fk violation"))
    assert isinstance(err, errors_module.NotFoundError)


def test_unknown_state_maps_to_internal() -> None:
    err = errors_module.map_postgrest_error(_apierror("XX000", "weird"))
    assert isinstance(err, errors_module.InternalError)
    assert err.status == 500


def test_dict_args_fallback_extraction() -> None:
    """When ``code``/``message`` aren't on the exception attrs, pull from args."""

    class Bare(Exception):
        pass

    raw = Bare({"code": "P0002", "message": "from-args"})
    err = errors_module.map_postgrest_error(raw)
    assert isinstance(err, errors_module.NotFoundError)
    assert err.message == "from-args"


async def test_not_found_envelope_via_router(client) -> None:
    # The manager-token dep does the lookup and produces the 404 envelope
    # before the route body runs. Any token value is fine since the game
    # does not exist.
    resp = await client.post(
        "/games/AAAAAA/end",
        headers={"X-Manager-Token": "00000000-0000-0000-0000-000000000000"},
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"] == "not_found"
    assert "message" in body


def _apierror(code: str, message: str) -> Exception:
    """Build a fake postgrest-shaped APIError."""

    class _Fake(Exception):
        pass

    exc = _Fake(message)
    exc.code = code  # type: ignore[attr-defined]
    exc.message = message  # type: ignore[attr-defined]
    exc.details = None  # type: ignore[attr-defined]
    return exc
