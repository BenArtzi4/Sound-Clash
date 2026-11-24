"""domain_error_handler and request_validation_error_handler envelope behaviour.

5xx responses must not leak internal/DB error detail (table/column/constraint
names); 4xx responses keep their human-facing message. A validation error's
details never echo the request body.
"""

from __future__ import annotations

import json

from fastapi.exceptions import RequestValidationError


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


# ----- validation errors: never the body ---------------------------------------
#
# Each pydantic error carries an "input" (the part of the body that failed: a
# whole pasted list, or the raw bytes of a body that is not JSON) and maybe a
# "ctx" (which can hold an exception object). The envelope keeps only "type",
# "loc", "msg" and "url": echoing the rest made a 2 MB answer, or a 500 when it
# could not be written as JSON. Every name here is made up.

URL_MODEL = "https://errors.pydantic.dev/2.13/v/model_attributes_type"


async def _validation_body(errors: list[dict[str, object]]) -> tuple[int, str]:
    from app.middleware.error_handler import request_validation_error_handler

    resp = await request_validation_error_handler(None, RequestValidationError(errors))
    return resp.status_code, resp.body.decode("utf-8")


async def test_validation_envelope_keeps_only_type_loc_msg_and_url() -> None:
    list_text = "Velvet Comet - Paper Lanterns\n" * 2000
    errors: list[dict[str, object]] = [
        {  # a text/plain body arrives as bytes
            "type": "model_attributes_type",
            "loc": ("body",),
            "msg": "Input should be a valid dictionary",
            "input": list_text.encode("utf-8"),
            "url": URL_MODEL,
        },
        {  # a refused create: the input is the whole body, with a lone surrogate
            "type": "song_source",
            "loc": ("body",),
            "msg": "a game from a song list has no decades",
            "input": {"setlist": {"text": list_text + chr(0xD800)}, "selected_decades": [1980]},
        },
        {  # ctx can hold an exception object, which is not JSON
            "type": "value_error",
            "loc": ("body", "name"),
            "msg": "Value error, bad name",
            "input": "Glass Harbor",
            "ctx": {"error": ValueError("bad name")},
        },
    ]

    status, raw = await _validation_body(errors)

    assert status == 400
    assert "Velvet Comet" not in raw and "Glass Harbor" not in raw
    assert len(raw) < 1000
    assert json.loads(raw) == {
        "error": "validation_error",
        "message": "invalid request body",
        "details": {
            "errors": [
                {
                    "type": "model_attributes_type",
                    "loc": ["body"],
                    "msg": "Input should be a valid dictionary",
                    "url": URL_MODEL,
                },
                {
                    "type": "song_source",
                    "loc": ["body"],
                    "msg": "a game from a song list has no decades",
                },
                {"type": "value_error", "loc": ["body", "name"], "msg": "Value error, bad name"},
            ]
        },
    }


async def test_validation_envelope_cuts_long_names_and_drops_lone_surrogates() -> None:
    # An unknown field's name is part of its "loc": a long one is cut, and a
    # lone surrogate (UTF-8 cannot encode it) becomes "?".
    errors: list[dict[str, object]] = [
        {"type": "extra_forbidden", "loc": ("body", "x" * 5000), "msg": "Extra inputs"},
        {"type": "extra_forbidden", "loc": ("body", "a" + chr(0xD800)), "msg": "b" + chr(0xDFFF)},
        {"type": "missing", "loc": ("body", "selected_genres", 0), "msg": "Field required"},
    ]

    status, raw = await _validation_body(errors)

    assert status == 400
    assert json.loads(raw)["details"]["errors"] == [
        {"type": "extra_forbidden", "loc": ["body", "x" * 200], "msg": "Extra inputs"},
        {"type": "extra_forbidden", "loc": ["body", "a?"], "msg": "b?"},
        {"type": "missing", "loc": ["body", "selected_genres", 0], "msg": "Field required"},
    ]
