"""Constant-time password check for admin-gated endpoints."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header

from app.config import get_settings
from app.db.errors import UnauthorizedError


async def require_admin(
    x_admin_password: Annotated[str | None, Header(alias="X-Admin-Password")] = None,
) -> None:
    """Reject the request if the header is missing or wrong.

    Per ``docs/security-rls.md §10`` the response message is intentionally
    generic so a caller can't distinguish "missing" from "wrong".
    """
    expected = get_settings().admin_password
    provided = x_admin_password or ""
    if not secrets.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise UnauthorizedError("admin authentication required")
