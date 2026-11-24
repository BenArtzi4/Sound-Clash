"""Setlist request and response shapes, per ``docs/api-contracts.md §2.2a``
and ``§2.2``.

``SetlistInput`` is the host's pasted list. ``POST /setlists/check`` takes it
as its body, and ``POST /games`` takes it as its ``setlist`` field. The text
has no length limit here: ``parse_setlist_text`` checks it first and refuses a
long one as ``setlist_too_long``, the code the create page shows a message for.
``SetlistSummary`` is the ``setlist`` field of the ``POST /games`` answer.

Catalogue protection: an answer names a catalog song by title and artist only,
never by a song id, a YouTube id or a start time. These models hold no such
field and forbid extra ones.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.services.setlist_matcher import Reason


class SetlistInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str


class SetlistSummary(BaseModel):
    """How many songs a game created from a list holds, as the matcher counted
    them (``SetlistCheckResponse`` counts the same way)."""

    model_config = ConfigDict(extra="forbid")

    list_songs: int  # the songs the list names, each once (tier 1)
    same_artist_songs: int  # more songs by the same main artists (tier 2)


class SetlistReadyLine(BaseModel):
    """A line that matched: the catalog's spelling of what it names.

    For a line that names an artist or a film, ``title`` is None and
    ``artist`` is that artist's or film's catalog spelling.
    """

    model_config = ConfigDict(extra="forbid")

    line: str
    title: str | None
    artist: str
    songs: int  # catalog songs the line matched


class SetlistMissLine(BaseModel):
    """A line that cannot play, and why."""

    model_config = ConfigDict(extra="forbid")

    line: str
    reason: Reason


class SetlistCheckResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines_total: int  # song lines read from the text
    ready: list[SetlistReadyLine]  # in list order
    not_found: list[SetlistMissLine]  # in list order
    list_songs: int  # the songs the list names, each once (tier 1)
    same_artist_songs: int  # more songs by the same main artists (tier 2)
    pool_size: int  # list_songs + same_artist_songs
