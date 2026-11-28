"""Domain errors and Postgres → HTTP mapping.

Postgres surfaces RPC failures as SQLSTATE codes:
- ``P0002`` is raised for "not found" (game/round)
- ``P0001`` is raised for state conflicts (already-ended game/round)
- ``23505`` is the SQL standard unique-violation code

PostgREST relays these on the wire; supabase-py exposes the shape via
``postgrest.exceptions.APIError`` (a dict-like with ``code``/``message``/``details``).
The shape varies across postgrest-py versions, so the mapper inspects
multiple fallback fields.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any


class DomainError(Exception):
    """Base for application errors that map to HTTP responses."""

    code: str = "internal_error"
    status: int = 500

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class ValidationError(DomainError):
    code = "validation_error"
    status = 400


class SetlistError(DomainError):
    """A host's song list or song choice the server refuses (400).

    The code names the reason and is set per instance, so one class serves
    every refusal: ``setlist_too_long``, ``setlist_links_only``,
    ``setlist_no_songs`` and ``setlist_empty`` for a pasted list, and
    ``artists_not_enough`` for the Pick artists game. The message is the short
    plain-English text the host sees.
    """

    status = 400

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class UnauthorizedError(DomainError):
    code = "unauthorized"
    status = 401


class NotFoundError(DomainError):
    code = "not_found"
    status = 404


class ConflictError(DomainError):
    code = "conflict"
    status = 409


class GoneError(DomainError):
    code = "gone"
    status = 410


class PayloadTooLargeError(DomainError):
    code = "payload_too_large"
    status = 413


class RateLimitedError(DomainError):
    code = "rate_limited"
    status = 429


class InternalError(DomainError):
    code = "internal_error"
    status = 500


def _extract(exc: object) -> tuple[str | None, str | None]:
    """Pull (sqlstate, message) out of a postgrest-py-shaped error."""
    sqlstate: str | None = None
    message: str | None = None

    code_attr = getattr(exc, "code", None)
    if isinstance(code_attr, str):
        sqlstate = code_attr

    message_attr = getattr(exc, "message", None)
    if isinstance(message_attr, str):
        message = message_attr

    details = getattr(exc, "details", None)
    if isinstance(details, dict):
        if sqlstate is None:
            inner_code = details.get("code")
            if isinstance(inner_code, str):
                sqlstate = inner_code
        if message is None:
            inner_msg = details.get("message")
            if isinstance(inner_msg, str):
                message = inner_msg

    if sqlstate is None or message is None:
        args = getattr(exc, "args", ())
        if args and isinstance(args[0], dict):
            mapping = args[0]
            if sqlstate is None:
                code_val = mapping.get("code")
                if isinstance(code_val, str):
                    sqlstate = code_val
            if message is None:
                msg_val = mapping.get("message")
                if isinstance(msg_val, str):
                    message = msg_val

    return sqlstate, message


def sqlstate_and_message(exc: object) -> tuple[str | None, str | None]:
    """The (SQLSTATE, message) of a postgrest-py-shaped error, for a caller
    that must tell one database refusal from another (``None`` where absent)."""
    return _extract(exc)


def map_postgrest_error(exc: Exception) -> DomainError:
    """Translate a postgrest-py / asyncpg-shaped error to a DomainError."""
    sqlstate, message = _extract(exc)
    msg = message or str(exc) or "database error"

    if sqlstate == "P0002":
        return NotFoundError(msg)
    if sqlstate == "P0001":
        return ConflictError(msg)
    if sqlstate == "23505":
        return ConflictError(msg)
    if sqlstate == "23503":
        # Foreign-key violation: typically means parent (game) doesn't exist.
        return NotFoundError(msg)

    return InternalError(msg)


@contextmanager
def mapped_postgrest_errors() -> Iterator[None]:
    """Wrap a Supabase call and translate raw exceptions to DomainErrors.

    DomainErrors raised inside the block (already shaped) propagate untouched;
    every other exception goes through ``map_postgrest_error``.
    """
    try:
        yield
    except DomainError:
        raise
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
