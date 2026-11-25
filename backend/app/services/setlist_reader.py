"""Read a host's pasted song list and match it against the catalog.

``read_and_match`` is the one place both list endpoints get their match from:
``POST /setlists/check`` answers with it, and ``POST /games`` with a list saves
it as the game's song pool. The order matters:

1. ``parse_setlist_text``. It needs no database, so a refused text
   (``setlist_too_long``, ``setlist_links_only``, ``setlist_no_songs``) answers
   its 400 without a catalog load, even when Supabase is slow or down.
2. ``get_catalog_index()``, the catalog snapshot cached for 10 minutes.
3. ``match_setlist``.

Parsing and matching are CPU work, so both run in a worker thread
(``anyio.to_thread``), off the event loop.
"""

from __future__ import annotations

from dataclasses import dataclass

import anyio

from app.services.setlist_catalog import get_catalog_index
from app.services.setlist_matcher import CatalogIndex, SetlistMatch, match_setlist
from app.services.setlist_text import ListLine, parse_setlist_text


@dataclass(frozen=True)
class MatchedList:
    """A pasted list, read and matched."""

    index: CatalogIndex  # the catalog snapshot it was matched against
    lines: tuple[ListLine, ...]  # the song lines read from the text, in order
    match: SetlistMatch


async def read_and_match(text: str) -> MatchedList:
    """Parse ``text``, then load the catalog, then match. Raises the parser's
    ``SetlistError`` before any database read."""
    lines = await anyio.to_thread.run_sync(parse_setlist_text, text)
    index = await get_catalog_index()
    match = await anyio.to_thread.run_sync(match_setlist, index, lines)
    return MatchedList(index=index, lines=tuple(lines), match=match)
