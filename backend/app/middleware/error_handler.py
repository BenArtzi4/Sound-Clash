"""Translate exceptions to ``ErrorResponse`` envelopes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.db.errors import DomainError

logger = logging.getLogger("app.errors")


def _envelope(
    *, status: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {"error": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status, content=body)


async def domain_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, DomainError)
    if exc.status >= 500:
        # Never expose internal/DB error detail to clients (it may carry table,
        # column, or constraint names); log it server-side and return a generic
        # body, matching unhandled_handler.
        logger.error("internal domain error: %s", exc.message)
        return _envelope(status=exc.status, code=exc.code, message="internal server error")
    return _envelope(
        status=exc.status,
        code=exc.code,
        message=exc.message,
        details=exc.details,
    )


# The keys of a pydantic error that the 400 envelope keeps. Never "input", the
# part of the body that failed (a whole pasted list, or the raw bytes of a body
# that is not JSON), and never "ctx", which can hold an exception object:
# echoing them gave a 2 MB answer, or a 500 when they could not be written as
# JSON.
_PUBLIC_ERROR_KEYS = ("type", "loc", "msg", "url")
# A "loc" can hold a field name from the body (an unknown field), so its text
# is cut too.
_MAX_ERROR_TEXT = 200


def _safe_text(text: str) -> str:
    """Cut to ``_MAX_ERROR_TEXT`` characters, lone surrogates (which UTF-8
    cannot encode) replaced with "?"."""
    return text[:_MAX_ERROR_TEXT].encode("utf-8", "replace").decode("utf-8")


def _public_error(error: Any) -> dict[str, Any]:
    kept = {key: error[key] for key in _PUBLIC_ERROR_KEYS if key in error}
    if "loc" in kept:
        kept["loc"] = [_safe_text(p) if isinstance(p, str) else p for p in kept["loc"]]
    if "msg" in kept:
        kept["msg"] = _safe_text(str(kept["msg"]))
    return kept


async def request_validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return _envelope(
        status=400,
        code="validation_error",
        message="invalid request body",
        details={"errors": [_public_error(error) for error in exc.errors()]},
    )


async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error", exc_info=exc)
    return _envelope(
        status=500,
        code="internal_error",
        message="internal server error",
    )


def install(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, domain_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.add_exception_handler(Exception, unhandled_handler)
