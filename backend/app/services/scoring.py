"""Translate the API's boolean flags into ``award_points`` RPC integers.

The Postgres function (``db/migrations/014_scoring_revamp.sql``) takes
integer point values; the API contract (``docs/api-contracts.md §2.5``)
exposes booleans. This module is the bridge.
"""

from __future__ import annotations

from app.db.errors import ValidationError

TITLE_POINTS = 10
ARTIST_POINTS = 5
WRONG_BUZZ_PENALTY = 3
BONUS_POINTS = 4


def to_rpc_points(
    *,
    title_correct: bool,
    artist_correct: bool,
    wrong_buzz: bool,
    timeout: bool,
) -> tuple[int, int, int, int]:
    """Return ``(p_title, p_artist, p_wrong_buzz, p_timeout)`` for the RPC.

    Per the API contract:
    - ``timeout=True`` is mutually exclusive with everything else.
    - ``wrong_buzz=True`` is mutually exclusive with ``title_correct`` and
      ``artist_correct``.
    """
    if timeout and (title_correct or artist_correct or wrong_buzz):
        raise ValidationError(
            "timeout is mutually exclusive with other scoring flags",
            details={"field": "timeout"},
        )

    if wrong_buzz and (title_correct or artist_correct):
        raise ValidationError(
            "wrong_buzz cannot be combined with title_correct or artist_correct",
            details={"field": "wrong_buzz"},
        )

    if timeout:
        return (0, 0, 0, 1)

    return (
        TITLE_POINTS if title_correct else 0,
        ARTIST_POINTS if artist_correct else 0,
        WRONG_BUZZ_PENALTY if wrong_buzz else 0,
        0,
    )
