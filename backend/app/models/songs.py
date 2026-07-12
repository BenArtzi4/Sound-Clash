"""Song models; admin CRUD payloads."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

YouTubeId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{11}$")]
SongTitle = Annotated[str, StringConstraints(min_length=1, max_length=200)]
SongArtist = Annotated[str, StringConstraints(min_length=1, max_length=200)]
# Original release year of the song (mig 031). Bounds mirror the DB CHECK.
ReleaseYear = Annotated[int, Field(ge=1900, le=2100)]


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
    release_year: int | None = None
    # When the availability scan last confirmed the video dead (mig 045);
    # NULL/None = playable. Flagged songs are skipped by the auto-pickers.
    unavailable_at: datetime | None = None
    is_soundtrack: bool = False
    genres: list[GenreRef] = Field(default_factory=list)


class SongCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: SongTitle
    artist: SongArtist
    youtube_id: YouTubeId
    start_time: int = Field(default=0, ge=0)
    release_year: ReleaseYear | None = None
    genre_ids: list[UUID] = Field(default_factory=list, min_length=1)


class SongUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: SongTitle
    artist: SongArtist
    youtube_id: YouTubeId
    start_time: int = Field(default=0, ge=0)
    release_year: ReleaseYear | None = None
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


class AvailabilityCheckRequest(BaseModel):
    """One page of the dead-video scan (I-Liveness). Probes ``limit`` songs
    starting at ``offset``, or the explicit ``song_ids`` if given."""

    model_config = ConfigDict(extra="forbid")

    # Cap the page so the worst-case probe time stays well under Render's ~100s
    # gateway timeout (see ``services.youtube_availability``). Page the whole
    # ~1025-song catalog in a handful of calls via ``next_offset``.
    limit: int = Field(default=200, ge=1, le=250)
    offset: int = Field(default=0, ge=0)
    song_ids: list[UUID] | None = None
    # Phase 2 (mig 045): persist the verdicts for the probed page. ``dead``
    # sets songs.unavailable_at (the auto-pickers then skip them); ``ok``
    # clears it (a restored video becomes eligible again); ``unknown`` never
    # writes. False keeps the exact Phase-1 report-only behavior.
    commit: bool = False


class AvailabilitySong(BaseModel):
    """A song flagged by the availability scan (enough to find/fix it in the UI)."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    youtube_id: str
    title: str


class AvailabilityReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    checked: int
    dead: list[AvailabilitySong]
    unknown: list[AvailabilitySong]
    # Rows whose ``unavailable_at`` actually changed on this page (newly
    # flagged dead / newly cleared back to playable). Always 0 unless the
    # request set ``commit=true``.
    flagged: int = 0
    cleared: int = 0
    # Offset for the next page, or null when this page reached the end of the
    # catalog (always null when explicit ``song_ids`` were probed).
    next_offset: int | None = None
