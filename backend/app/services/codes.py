"""Game-code generator.

Six characters from an unambiguous alphabet (no 0/O, 1/I/L, no lowercase).
On UNIQUE collision the caller retries up to ``MAX_RETRIES`` times via
:func:`generate_unique_code`.
"""

from __future__ import annotations

import secrets
from collections.abc import Awaitable, Callable

from app.db.errors import ConflictError, InternalError

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6
MAX_RETRIES = 5


def generate_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))


async def generate_unique_code(
    insert_fn: Callable[[str], Awaitable[None]],
    *,
    max_retries: int = MAX_RETRIES,
) -> str:
    """Try ``insert_fn(code)`` until it succeeds.

    The caller's ``insert_fn`` must raise :class:`ConflictError` on a unique
    violation (typical PostgREST/asyncpg path goes through
    :func:`app.db.errors.map_postgrest_error`). After ``max_retries`` failed
    inserts we give up with a 500.
    """
    for _ in range(max_retries):
        code = generate_code()
        try:
            await insert_fn(code)
        except ConflictError:
            continue
        else:
            return code
    raise InternalError("game_code_collision_exhausted")
