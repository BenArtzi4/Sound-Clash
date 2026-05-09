"""Translate the API's boolean flags into ``award_attempt`` RPC integers.

The Postgres function (``db/migrations/016_multi_buzz_rounds.sql``) takes
integer point values; the API contract (``docs/api-contracts.md §2.5``)
exposes booleans. This module is the bridge.
"""

from __future__ import annotations

from app.db.errors import ValidationError

TITLE_POINTS = 10
ARTIST_POINTS = 5
WRONG_BUZZ_PENALTY = 3
BONUS_POINTS = 4


def to_attempt_args(
    *,
    title_correct: bool,
    artist_correct: bool,
    wrong_buzz: bool,
) -> tuple[int, int, int]:
    """Return ``(p_title, p_artist, p_wrong_buzz)`` for the RPC.

    ``wrong_buzz`` is mutually exclusive with ``title_correct`` and
    ``artist_correct``; the SQL function enforces this too, but rejecting
    early lets the API return a 400 instead of bouncing through Postgres.
    """
    if wrong_buzz and (title_correct or artist_correct):
        raise ValidationError(
            "wrong_buzz cannot be combined with title_correct or artist_correct",
            details={"field": "wrong_buzz"},
        )

    if not (title_correct or artist_correct or wrong_buzz):
        raise ValidationError(
            "an attempt must set at least one of title_correct, artist_correct, wrong_buzz",
            details={"field": "title_correct"},
        )

    return (
        TITLE_POINTS if title_correct else 0,
        ARTIST_POINTS if artist_correct else 0,
        WRONG_BUZZ_PENALTY if wrong_buzz else 0,
    )
