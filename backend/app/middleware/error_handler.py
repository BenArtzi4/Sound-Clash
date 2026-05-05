"""Translate exceptions to ``ErrorResponse`` envelopes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.db.errors import DomainError, map_postgrest_error

logger = logging.getLogger("app.errors")


def _envelope(
    *, status: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    body: dict[str, Any] = {"error": code, "message": message}
    if details is not None:
        body["details"] = details
    return JSONResponse(status_code=status, content=body)


async def domain_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, DomainError):
        return await unhandled_handler(request, exc)
    return _envelope(
        status=exc.status,
        code=exc.code,
        message=exc.message,
        details=exc.details,
    )


async def request_validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        return await unhandled_handler(request, exc)
    return _envelope(
        status=400,
        code="validation_error",
        message="invalid request body",
        details={"errors": exc.errors()},
    )


async def postgrest_error_handler(request: Request, exc: Exception) -> JSONResponse:
    domain = map_postgrest_error(exc)
    return _envelope(
        status=domain.status,
        code=domain.code,
        message=domain.message,
        details=domain.details,
    )


async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error", exc_info=exc)
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except Exception as send_err:
        logger.debug("sentry capture skipped: %s", send_err)
    return _envelope(
        status=500,
        code="internal_error",
        message="internal server error",
    )


def install(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, domain_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.add_exception_handler(Exception, unhandled_handler)
