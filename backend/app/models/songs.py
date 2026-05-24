"""Song models; admin CRUD payloads."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

YouTubeId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{11}$")]
SongTitle = Annotated[str, StringConstraints(min_length=1, max_length=200)]
SongArtist = Annotated[str, StringConstraints(min_length=1, max_length=200)]
SongSource = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class GenreRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    name: str
    slug: str


class SongPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    title: str
    artist: str
    youtube_id: str
    start_time: int
    source: str | None = None
    genres: list[GenreRef] = Field(default_factory=list)


class SongCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: SongTitle
    artist: SongArtist
    youtube_id: YouTubeId
    start_time: int = Field(default=0, ge=0)
    source: SongSource | None = None
    genre_ids: list[UUID] = Field(default_factory=list, min_length=1)


class SongUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: SongTitle
    artist: SongArtist
    youtube_id: YouTubeId
    start_time: int = Field(default=0, ge=0)
    source: SongSource | None = None
    genre_ids: list[UUID] = Field(default_factory=list, min_length=1)


class SongList(BaseModel):
    model_config = ConfigDict(extra="ignore")

    items: list[SongPayload]
    page: int
    per_page: int
    total: int


class BulkImportSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    inserted: int
    updated: int
    total: int
