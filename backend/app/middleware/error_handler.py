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


async def request_validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return _envelope(
        status=400,
        code="validation_error",
        message="invalid request body",
        details={"errors": exc.errors()},
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
