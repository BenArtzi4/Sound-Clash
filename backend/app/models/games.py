"""Game and team models — request/response shapes per ``api-contracts.md``."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.songs import SongPayload

TeamName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=30, strip_whitespace=True),
]


class CreateGameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_rounds: int = Field(default=10, ge=1, le=50)
    selected_genres: list[UUID] = Field(min_length=1)


class CreateGameResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    game_code: str
    status: str
    total_rounds: int
    selected_genres: list[UUID]
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


class SelectSongRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional manual pick. When set, the picker is bypassed and the round
    # starts with this exact song. Used by the manager's "Restart song"
    # action — see docs/game-rules.md §11.
    song_id: UUID | None = None


class SelectSongResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    round_id: UUID
    round_number: int
    song: SongPayload


class AwardPointsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    round_id: UUID
    title_correct: bool = False
    artist_correct: bool = False
    source_correct: bool = False
    timeout: bool = False


class AwardPointsResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    round_id: UUID
    team_id: UUID | None
    points_awarded: int
    team_total_score: int


class EndGameResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    game_code: str
    status: str
    ended_at: datetime
