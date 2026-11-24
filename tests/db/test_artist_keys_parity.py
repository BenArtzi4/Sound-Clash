"""artist_keys() in Python splits a credit exactly as song_artist_keys() in SQL.

The setlist matcher (backend/app/services/setlist_text.py) splits the artist a
host pasted with artist_keys(); the catalog's songs.artist_keys column comes
from song_artist_keys() (migration 049). A key one side makes and the other
does not would silently miss a match, so this test runs both on the same
tricky credits. If they ever disagree, fix the Python side: the SQL function
feeds a STORED column, and changing it means rewriting every song.

The production database (PostgreSQL 17) uses the ICU locale provider, locale
en-US. The test database's default locale is libc, where the regex \\s does
not match no-break spaces and lower() differs on some letters, so the SQL
function runs here under the ICU collation "en-US-x-icu", as on production.
(All of these credits were also checked against production on 2026-11-24.)

The database returns its keys sorted and the Python side keeps credit order,
so the comparison is on sets.
"""

# ruff: noqa: RUF001  (Hebrew test strings)

from __future__ import annotations

import asyncpg
import pytest

from app.services.setlist_text import artist_keys

pytestmark = pytest.mark.needs_docker


@pytest.mark.parametrize(
    "credit",
    [
        "A & B",
        "A ft. B",
        "A Ft B",
        "A feat. B",
        "A FEAT B",
        "A featuring B",
        "A vs. B",
        "A vs B",
        "A x B",
        "Lil Nas X & Billy Ray Cyrus",
        "X Ambassadors",
        "Max",
        "A, B",
        "A,B",
        "Earth, Wind & Fire",
        "A  &  B",
        "A & & B",
        "  Padded  ",
        "Macklemore & Ryan Lewis ft. Ray Dalton",
        "סטטיק ובן אל תבורי",
        "עומר אדם ft. אריסה",
        "דודו אהרון",
        "A ו B",
        "Beyoncé",
        "Sigur Rós",
        "Ke$ha",
        "AC/DC",
        # Whitespace: ICU's \s is Python's \s, no-break spaces included.
        "A\u00a0& B",
        "A\t&\tB",
        "A\u2003&\u2003B",
        "A\u202f& B",
        "A\u2007& B",
        "A\u0085& B",
        "A\u001c& B",
        "A\u3000x\u3000B",
        "A\u00a0ft.\u00a0B",
        "A x\u00a0& B",
        "שיר\u00a0ושלום",
        "A ו\u00a0B",
        "A\u200b& B",  # zero-width space: not whitespace on either side
        # Case: the separators match ASCII letters only; lower() is full Unicode.
        "A v\u017f B",  # long s
        "A featur\u0131ng B",  # dotless i
        "A \u212a B",  # Kelvin sign
        "BEYONC\u00c9 & SIGUR R\u00d3S",
        "\u03a3\u0391\u03a3 & \u039a\u0391\u03a3",  # final sigma
        "\u0130PEK ft. \u00c9DITH",  # capital I with dot
        "",
        " , ",
    ],
)
async def test_artist_keys_match_song_artist_keys(db: asyncpg.Connection, credit: str) -> None:
    sql_keys = await db.fetchval('SELECT song_artist_keys($1::text COLLATE "en-US-x-icu")', credit)
    keys = artist_keys(credit)
    assert set(keys) == set(sql_keys)
    assert len(keys) == len(set(keys))
