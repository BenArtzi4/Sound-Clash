"""Game and team models; request/response shapes per ``api-contracts.md``."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

TeamName = Annotated[
    str,
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
