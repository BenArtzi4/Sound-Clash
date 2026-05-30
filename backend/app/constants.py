"""Shared constants.

Soundtrack rounds (single "Correct +15" scoring) are identified purely by genre
membership — there is no per-song is_soundtrack column (dropped in migration
028). The genres table is the source of truth; this set names the soundtrack
genres by slug for the layers that can't perform the SQL join themselves: the
admin list view (reads slugs from the PostgREST embed) and the CSV importer
(slugs come straight from the upload's genres column). select_next_song hardcodes
the same slugs in SQL.
"""

from __future__ import annotations

# Slugs of the genres whose songs play as soundtrack rounds.
SOUNDTRACK_GENRE_SLUGS = frozenset({"soundtracks", "israeli-soundtracks"})
