"""Database access layer.

Re-exports the supabase client factory and the Postgres → HTTP error mapper.
"""

from __future__ import annotations

from app.db.errors import (
    ConflictError,
    DomainError,
    GoneError,
    InternalError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
    map_postgrest_error,
)
from app.db.supabase_client import (
    SupabaseClientLike,
    get_supabase_client,
    health_check_supabase,
    set_supabase_client_factory,
)

__all__ = [
    "ConflictError",
    "DomainError",
    "GoneError",
    "InternalError",
    "NotFoundError",
    "SupabaseClientLike",
    "UnauthorizedError",
    "ValidationError",
    "get_supabase_client",
    "health_check_supabase",
    "map_postgrest_error",
    "set_supabase_client_factory",
]
