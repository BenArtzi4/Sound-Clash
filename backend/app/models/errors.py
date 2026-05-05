"""Canonical error envelope used in OpenAPI docs."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: dict[str, Any] | None = None
