"""Game and team models; request/response shapes per ``api-contracts.md``."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

# Code points stripped from a team name before it is length-checked, stored, and
# shown on the projector (T5.2 — objective sanitization only): C0/C1 control
# chars, line/paragraph separators, zero-width / word-joiner chars, and the
# explicit bidirectional override/isolate marks that can scramble the display.
# Hebrew (and any RTL script) renders correctly via the Unicode bidi algorithm
# WITHOUT these marks, so stripping them never harms a legitimate name. ZWJ
# (U+200D) and ZWNJ (U+200C) are deliberately KEPT so compound emoji and script
# joiners survive. Built from code points so the source carries no invisible
# characters.
_UNSAFE_CODE_POINTS: tuple[int, ...] = (
    *range(0x00, 0x20),  # C0 control chars (incl. interior tab / newline / CR)
    0x7F,  # DEL
    *range(0x80, 0xA0),  # C1 control chars
    0x200B,  # zero-width space
    0x200E,  # left-to-right mark
    0x200F,  # right-to-left mark
    0x2028,  # line separator
    0x2029,  # paragraph separator
    *range(0x202A, 0x202F),  # bidi embedding / override (LRE RLE PDF LRO RLO)
    0x2060,  # word joiner
    *range(0x2066, 0x206A),  # bidi isolates (LRI RLI FSI PDI)
    0xFEFF,  # zero-width no-break space / BOM
)
_UNSAFE_NAME_CHARS = re.compile(
    "[" + "".join(re.escape(chr(cp)) for cp in _UNSAFE_CODE_POINTS) + "]"
)


def _sanitize_team_name(value: object) -> object:
    """Strip unsafe chars (and surrounding whitespace) before the length check.

    Runs as a ``BeforeValidator`` so the ``min_length`` / ``max_length``
    constraints apply to the *cleaned* string: a name that is nothing but
    stripped characters and/or whitespace collapses to ``""`` and is rejected
    by ``min_length=1``. We trim here rather than rely solely on
    ``StringConstraints(strip_whitespace=True)`` because pydantic (2.13.x)
    applies that strip *after* the length check once a ``BeforeValidator`` is
    present, which would otherwise let an all-whitespace name through as ``""``.
    """
    if isinstance(value, str):
        return _UNSAFE_NAME_CHARS.sub("", value).strip()
    return value


TeamName = Annotated[
    str,
    BeforeValidator(_sanitize_team_name),
    StringConstraints(min_length=1, max_length=30, strip_whitespace=True),
]
# A decade is stored as its start year (the 80s = 1980). Bounds mirror the
# songs.release_year CHECK; the picker floors release_year to its decade and
# matches by membership (migration 032).
Decade = Annotated[int, Field(ge=1900, le=2100)]


class CreateGameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_genres: list[UUID] = Field(min_length=1)
    selected_decades: list[Decade] = Field(default_factory=list)


class CreateGameResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    game_code: str
    status: str
    selected_genres: list[UUID]
    selected_decades: list[int] = Field(default_factory=list)
    started_at: datetime
    expires_at: datetime
    manager_token: UUID


class JoinTeamRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TeamName


class JoinTeamResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    game_code: str
    name: str
    score: int
    joined_at: datetime


class RejoinTeamRequest(BaseModel):
    """Body for ``POST /games/{code}/rejoin`` (issue #183). The per-team rejoin
    token, resolved server-side back to the existing team row. Distinct field
    name from the manager token so the two are never confused."""

    model_config = ConfigDict(extra="forbid")

    token: UUID


class TeamRejoinTokenResponse(BaseModel):
    """Body of ``GET /games/{code}/teams/{team_id}/rejoin-token`` — the only
    place a rejoin token is ever revealed, and only to the authenticated host
    (the endpoint is manager-token-gated). The host renders it as a transient
    QR for a team to scan on a new/borrowed device."""

    model_config = ConfigDict(extra="ignore")

    team_id: UUID
    rejoin_token: UUID


class AwardBonusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    team_id: UUID
    points: int = Field(default=4, ge=1, le=50)


class AwardBonusResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    team_id: UUID
    points_awarded: int
    team_total_score: int


class EndGameResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    game_code: str
    status: str
    ended_at: datetime
