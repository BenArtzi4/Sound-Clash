"""Translate the API's boolean flags into ``award_points`` RPC integers.

The Postgres function (``db/migrations/005_rpc_functions.sql:88``) takes
integer point values; the API contract (``docs/api-contracts.md §2.5``)
exposes booleans. This module is the bridge.
"""

from __future__ import annotations

from app.db.errors import ValidationError

TITLE_POINTS = 10
ARTIST_POINTS = 5
SOURCE_POINTS = 5
TIMEOUT_PENALTY = 2


def to_rpc_points(
    *,
    title_correct: bool,
    artist_correct: bool,
    source_correct: bool,
    timeout: bool,
    song_is_soundtrack: bool,
) -> tuple[int, int, int, int]:
    """Return ``(p_title, p_artist, p_source, p_timeout)`` for the RPC.

    Per the API contract:
    - ``timeout=True`` ignores the other flags and applies a fixed penalty.
    - ``source_correct`` is only valid when the song is a soundtrack.
    """
    if timeout:
        return (0, 0, 0, TIMEOUT_PENALTY)

    if source_correct and not song_is_soundtrack:
        raise ValidationError(
            "source_correct is only valid for soundtrack songs",
            details={"field": "source_correct"},
        )

    return (
        TITLE_POINTS if title_correct else 0,
        ARTIST_POINTS if artist_correct else 0,
        SOURCE_POINTS if source_correct else 0,
        0,
    )
