"""The setlist matcher (app/services/setlist_matcher.py).

Pure functions over an in-memory catalog, no database. Spec:
docs/planning/2026-11-24-custom-setlist-design.md section 7. The catalog rows
are made up; CatalogSong.artist_keys is built main artist first with
setlist_text.artist_keys(), as the catalog loader does.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence

import pytest

from app.services.setlist_matcher import (
    CatalogIndex,
    CatalogSong,
    LineResult,
    match_line,
    match_setlist,
)
from app.services.setlist_text import ListLine, artist_keys, parse_setlist_text

Row = tuple[str, str, str, bool]  # id, title, artist, soundtrack

CATALOG: list[Row] = [  # id, title, artist, soundtrack
    ("q1", "Bohemian Rhapsody", "Queen", False), ("q2", "Don't Stop Me Now", "Queen", False),
    ("o1", "תל אביב", "עומר אדם ft. אריסה", False), ("o2", "שני משוגעים", "עומר אדם", False),
    ("z1", "הפרח בגני", "זוהר ארגוב", False),
    ("f1", "Let It Go", "Frozen", True), ("f2", "Love Is an Open Door", "Frozen", True),
    ("m1", "Beyond", "Moana 2", True), ("s1", "All Star", "Shrek", True),
    ("b1", "Sunny", "Boney M.", False), ("b2", "Sunny", "Other Band", False),
    ("p1", "Where Is the Love?", "The Black Eyed Peas", False), ("a1", "Dancing Queen", "ABBA", False),
]  # fmt: skip
ALIASES = {"omer adam": "עומר אדם", "zohar argov": "זוהר ארגוב"}


def _index(rows: Sequence[Row], aliases: Mapping[str, str]) -> CatalogIndex:
    return CatalogIndex(
        [
            CatalogSong(id_, title, artist, artist_keys(artist), st)
            for id_, title, artist, st in rows
        ],
        aliases,
    )


INDEX = _index(CATALOG, ALIASES)


def _match(text: str, index: CatalogIndex = INDEX) -> LineResult:
    (line,) = parse_setlist_text(text)
    return match_line(index, line)


def _ids(result: LineResult) -> tuple[str, ...]:
    return tuple(song.id for song in result.songs)


# ----- the brief's cases ---------------------------------------------------


@pytest.mark.parametrize(
    ("line", "ids", "rule"),
    [
        ("Queen - Bohemian Rhapsody", ("q1",), "same_song"),
        ("Bohemian Rhapsody - Queen", ("q1",), "same_song"),  # both orders
        ("Queen - Bohemian Rhapsody - Remastered 2011", ("q1",), "same_song"),
        ("Omer Adam - תל אביב", ("o1",), "alias"),
        ("Zohar Argov - Ha'perah Be'gani", ("z1",), "other_script_title"),
        (
            'Idina Menzel, Disney - Let It Go - From "Frozen"/Soundtrack Version',
            ("f1",),
            "soundtrack",
        ),
        ("Smash Mouth - All Star", ("s1",), "soundtrack"),
        ("Black Eyed Peas - Where Is The Love?", ("p1",), "near_spelling"),
        ("Frozen", ("f1", "f2"), "artist_or_film"),
        ("omer adam", ("o1", "o2"), "artist_or_film"),
        ("Dancing Queen", ("a1",), "title_alone"),
    ],
)
def test_matches(line: str, ids: tuple[str, ...], rule: str) -> None:
    result = _match(line)
    assert (_ids(result), result.rule, result.reason) == (ids, rule, None)


@pytest.mark.parametrize(
    ("line", "reason"),
    [
        ("Leon Bridges - Beyond", "not_in_catalog"),  # one-word soundtrack title, another artist
        ("Bobby Hebb - Sunny", "not_in_catalog"),  # a cover: title alone never matches
        ("Sunny", "several_songs_share_this_name"),
        ("Nobody - Not A Real Song", "not_in_catalog"),
    ],
)
def test_refuses(line: str, reason: str) -> None:
    result = _match(line)
    assert (result.songs, result.rule, result.reason) == ((), None, reason)


def test_tiers() -> None:
    m = match_setlist(
        INDEX,
        parse_setlist_text(
            "Queen - Bohemian Rhapsody\nBohemian Rhapsody - Queen\nOmer Adam - Not In Catalog\nFrozen"
        ),
    )
    assert m.list_song_ids == ("q1", "f1", "f2")  # the duplicate line counts once
    assert set(m.fill_song_ids) == {
        "q2",
        "o1",
        "o2",
    }  # same artists, also for the line that was not found


def test_300_lines_against_2000_songs_is_fast() -> None:
    # synthetic catalog "Artist {i}" / "Song {i}", 300 lines of which half match
    big_index = _index([(f"id{i}", f"Song {i}", f"Artist {i}", False) for i in range(2000)], {})
    lines = parse_setlist_text(
        "\n".join(
            f"Artist {i} - Song {i}" if i % 2 == 0 else f"Artist {i} - Unknown Title {i}"
            for i in range(300)
        )
    )
    start = time.perf_counter()
    m = match_setlist(big_index, lines)
    assert time.perf_counter() - start < 2.0
    assert m.list_song_ids == tuple(f"id{i}" for i in range(0, 300, 2))
    assert m.fill_song_ids == tuple(f"id{i}" for i in range(1, 300, 2))


# ----- more of each rule (made-up names) -----------------------------------

EXTRA: list[Row] = [
    ("x1", "Glass Harbor", "Velvet Tide", False),
    ("x2", "Velvet Tide", "Glass Harbour", True),
    ("x3", "Paper Lanterns", "Moonfish", False),
    ("x4", "Neon Rivers", "Moonfish ft. Kai Rivers", False),
    ("n1", "Rivière Lente", "Élan Vital", False),
    ("n2", "Glow Up", "Ke$ha Moon", False),
    ("h1", "כוכב נופל", "להקת הירח הכחול", False),
    ("h2", "אי", "להקת הירח הכחול", False),
    ("e1", "Quiet Song", "!!!", False),
    ("x5", "Don't", "Moon Film", True),
    ("x6", "צ'יפס", "סרט הירח", True),
    ("x7", "Copper Sky", "Jinx", False),
    ("e2", "???", "Quiet Band", False),
    ("t1", "Dallas", "Dallas", True),  # a one-word theme named after its show
    ("x10", "Glass Bells", "Live", False),  # a band whose name is a recording note
    ("x11", "Radio", "Signal Tower", False),  # a title that is a recording note
    ("x12", "Night Bells", "Iron Choir", False),
    ("x13", "Dust Road", "Iron Choir", False),
]
EXTRA_ALIASES = {
    "kesha moon": "ke$ha moon",  # alias rows are lower + trim only
    "elan vital band": "élan vital",
    "blue moon band": "להקת הירח הכחול",
    "ghost band": "nobody in the catalog",
    "...": "moonfish",
    "empty target": "???",
}
EXTRA_INDEX = _index(EXTRA, EXTRA_ALIASES)


def test_the_first_rule_wins_in_either_order() -> None:
    # As "Glass Harbor (artist) - Velvet Tide (title)" the line is the
    # soundtrack x2 (rule 4); as "Velvet Tide (title) - Glass Harbor (artist)"
    # it is x1 by the same artist (rule 1). Rule 1 in both orders comes first.
    result = _match("Glass Harbor - Velvet Tide", EXTRA_INDEX)
    assert (_ids(result), result.rule) == (("x1",), "same_song")


@pytest.mark.parametrize(
    ("line", "ids", "rule"),
    [
        ("Elan Vital - Riviere Lente", ("n1",), "same_song"),  # accents on the catalog side
        ("ÉLAN VITAL - RIVIÈRE LENTE", ("n1",), "same_song"),
        ("Kesha Moon - Glow Up", ("n2",), "alias"),  # the alias target keeps its "$"
        ("Ke$ha Moon - Glow Up", ("n2",), "same_song"),
        ("Elan Vital Band", ("n1",), "artist_or_film"),  # alias to an accented key
        ("Kai Rivers", ("x4",), "artist_or_film"),  # a guest artist is credited too
    ],
)
def test_names_compare_after_norm(line: str, ids: tuple[str, ...], rule: str) -> None:
    result = _match(line, EXTRA_INDEX)
    assert (_ids(result), result.rule) == (ids, rule)


@pytest.mark.parametrize(
    ("line", "ids"),
    [
        ("Blue Moon Band - Kochav Nofel", ("h1",)),  # artist by alias
        ("להקת הירח הכחול - Kochav Nofel", ("h1",)),  # artist as written in the catalog
        ("Kochav Nofel - Blue Moon Band", ("h1",)),  # title first
    ],
)
def test_other_script_title(line: str, ids: tuple[str, ...]) -> None:
    result = _match(line, EXTRA_INDEX)
    assert (_ids(result), result.rule) == (ids, "other_script_title")


@pytest.mark.parametrize(
    "line",
    [
        "Blue Moon Band - Ee",  # under 3 consonants ("אי" has none)
        "Blue Moon Band - Totally Different",  # under 80% alike
        "Moonfish - Kochav Nofel",  # another artist's song
    ],
)
def test_other_script_title_refuses(line: str) -> None:
    assert _match(line, EXTRA_INDEX).reason == "not_in_catalog"


def test_near_spelling_of_the_title() -> None:
    result = _match("Moonfish - Paper Lantern", EXTRA_INDEX)
    assert (_ids(result), result.rule) == (("x3",), "near_spelling")
    assert _match("Moonfish - Silver Planes", EXTRA_INDEX).reason == "not_in_catalog"


def test_near_spelling_of_the_artist() -> None:
    result = _match("Moon Fish - Paper Lanterns", EXTRA_INDEX)  # equal without spaces
    assert (_ids(result), result.rule) == (("x3",), "near_spelling")
    # "jin" and "jinx" are 86% alike, but names under 4 letters must be equal.
    assert _match("Jin - Copper Sky", EXTRA_INDEX).reason == "not_in_catalog"


def test_soundtrack_with_the_film_in_the_line() -> None:
    # A one-word soundtrack title matches when the film's name is in the line.
    result = _match('Kai Rivers - Beyond (From "Moana 2")')
    assert (_ids(result), result.rule) == (("m1",), "soundtrack")


@pytest.mark.parametrize(
    ("line", "ids"),
    [
        # An apostrophe or a geresh does not make two words of one.
        ("Sol Rivera - Don't", ()),
        ("Sol Rivera - צ'יפס", ()),
        ("Sol Rivera - Don't (From Moon Film)", ("x5",)),
    ],
)
def test_soundtrack_counts_words_by_spaces(line: str, ids: tuple[str, ...]) -> None:
    assert _ids(_match(line, EXTRA_INDEX)) == ids


def test_names_that_norm_to_nothing_are_not_indexed() -> None:
    assert EXTRA_INDEX.artist_key("!!!") is None
    # The empty "???" never equals e1's empty "!!!" (that would be same_song);
    # a side that cleans to nothing leaves the title alone (ruling R-m6).
    assert _match("??? - Quiet Song", EXTRA_INDEX).rule == "title_alone"
    assert _ids(_match("Quiet Song", EXTRA_INDEX)) == ("e1",)
    # e2's title "???" is in no title entry; its artist still lists it.
    assert _ids(_match("Quiet Band", EXTRA_INDEX)) == ("e2",)
    line = ListLine("Quiet Band | ???", "Quiet Band", "???")
    result = match_line(EXTRA_INDEX, line)
    assert (result.rule, result.reason) == (None, "not_in_catalog")  # not same_song
    assert match_setlist(EXTRA_INDEX, [line]).fill_song_ids == ("e2",)
    assert "" not in EXTRA_INDEX.aliases
    assert "empty target" not in EXTRA_INDEX.aliases


# ----- fix round 1: film names, recording notes ----------------------------


@pytest.mark.parametrize(
    ("line", "ids", "rule"),
    [
        ('Some Rapper - Dallas (From "Dallas")', ("t1",), "soundtrack"),  # the film in a note
        ("Dallas - Dallas", ("t1",), "same_song"),
        ("Moana 2 Cast - Beyond", ("m1",), "soundtrack"),  # the film in the artist side
    ],
)
def test_film_named_outside_the_title(line: str, ids: tuple[str, ...], rule: str) -> None:
    index = INDEX if "Moana" in line else EXTRA_INDEX
    result = _match(line, index)
    assert (_ids(result), result.rule) == (ids, rule)


def test_film_named_only_by_the_title_is_refused() -> None:
    # "Dallas" is both the title and the show: the line names no film.
    assert _match("Some Rapper - Dallas", EXTRA_INDEX).reason == "not_in_catalog"


SECOND_BEYOND = _index([*CATALOG, ("x9", "Beyond", "Sol Rivera", False)], ALIASES)


def test_name_alone_with_a_film_note() -> None:  # ruling R-m3
    result = _match('Beyond (From "Moana 2")', SECOND_BEYOND)
    assert (_ids(result), result.rule) == (("m1",), "soundtrack")
    assert _match("Beyond", SECOND_BEYOND).reason == "several_songs_share_this_name"
    assert _match("Beyond (From Nowhere)", SECOND_BEYOND).reason == (
        "several_songs_share_this_name"
    )


@pytest.mark.parametrize(
    ("line", "ids", "rule"),
    [  # ruling R-m4: the artist side is cleaned like a title when its exact name fails
        ("Frozen (Original Motion Picture Soundtrack)", ("f1", "f2"), "artist_or_film"),
        ("Queen (Live) - Bohemian Rhapsody", ("q1",), "same_song"),
        ("Bohemian Rhapsody - Queen (Live)", ("q1",), "same_song"),
    ],
)
def test_notes_on_the_artist_side(line: str, ids: tuple[str, ...], rule: str) -> None:
    result = _match(line)
    assert (_ids(result), result.rule) == (ids, rule)


@pytest.mark.parametrize(
    ("text", "fill"),
    [
        ("Frozen (Original Motion Picture Soundtrack) - Not In Catalog", ("f1", "f2")),
        ("Queen (Live) - Not In Catalog", ("q1", "q2")),
    ],
)
def test_notes_on_the_artist_side_fill(text: str, fill: tuple[str, ...]) -> None:
    assert match_setlist(INDEX, parse_setlist_text(text)).fill_song_ids == fill


def test_film_with_notes_fills_like_the_film() -> None:
    with_notes = match_setlist(
        INDEX, parse_setlist_text("Frozen (Original Motion Picture Soundtrack)")
    )
    plain = match_setlist(INDEX, parse_setlist_text("Frozen"))
    assert (with_notes.list_song_ids, with_notes.fill_song_ids) == (
        plain.list_song_ids,
        plain.fill_song_ids,
    )


@pytest.mark.parametrize(
    ("line", "ids", "rule", "reason"),
    [  # ruling R-m6: a side that is only recording notes
        ("Bohemian Rhapsody - Remastered 2011", ("q1",), "title_alone", None),
        ("Remastered 2011 - Bohemian Rhapsody", ("q1",), "title_alone", None),
        ("Queen - Bohemian Rhapsody - Remastered 2011", ("q1",), "same_song", None),
        ("Sunny - Remastered", (), None, "several_songs_share_this_name"),
    ],
)
def test_side_that_is_only_notes(
    line: str, ids: tuple[str, ...], rule: str | None, reason: str | None
) -> None:
    result = _match(line)
    assert (_ids(result), result.rule, result.reason) == (ids, rule, reason)


@pytest.mark.parametrize(
    ("index", "text", "fill"),
    [  # ruling m6b: the side beside the notes is a song name, never an artist
        (EXTRA_INDEX, "Iron Choir - Acoustic", ("x12", "x13")),
        (INDEX, "Queen - Live", ("q1", "q2")),
    ],
)
def test_notes_beside_an_artist_fill_tier_2_only(
    index: CatalogIndex, text: str, fill: tuple[str, ...]
) -> None:
    m = match_setlist(index, parse_setlist_text(text))
    assert (m.results[0].rule, m.results[0].reason) == (None, "not_in_catalog")
    assert (m.list_song_ids, m.fill_song_ids) == ((), fill)


@pytest.mark.parametrize(
    "line",
    [
        "1999 - Moonfish",  # a year alone can be the title ("1999"), not a note
        "1999 - Paper Lanterns",  # so "Paper Lanterns" is not a title alone either
        "Live - Paper Lanterns",  # "Live" is a catalog band here, so it names an artist
        "Remix - Radio",  # both sides are notes: which one is the title is a guess
    ],
)
def test_side_that_is_only_notes_guards(line: str) -> None:
    assert _match(line, EXTRA_INDEX).reason == "not_in_catalog"


def test_alias_to_a_name_outside_the_catalog_matches_nothing() -> None:
    assert EXTRA_INDEX.artist_key("Ghost Band") is None
    assert _match("Ghost Band", EXTRA_INDEX).reason == "not_in_catalog"


def test_index_reports_songs_and_aliases() -> None:
    assert len(INDEX.songs) == len(CATALOG)
    assert INDEX.aliases["omer adam"] == "עומר אדם"
    assert INDEX.artist_key("Omer Adam") == "עומר אדם"
    assert INDEX.artist_key("FROZEN") == "frozen"
    assert INDEX.artist_key("Nobody") is None


def test_match_line_takes_a_line_built_by_hand() -> None:
    result = match_line(INDEX, ListLine("Queen | Bohemian Rhapsody", "Queen", "Bohemian Rhapsody"))
    assert (_ids(result), result.rule) == (("q1",), "same_song")


# ----- the same-artist fill ------------------------------------------------


@pytest.mark.parametrize(
    ("text", "fill"),
    [
        ("Not In Catalog - Omer Adam", {"o1", "o2"}),  # "Title - Artist", not found
        ("Don't Stop Me Now", {"q1"}),  # a song name alone adds its artist
        ("Kai Rivers - Let It Go", {"f2"}),  # a soundtrack adds the rest of the film
        ("Queen & Moonfish - Not In Catalog", {"q1", "q2"}),
        ("Moonfish & Queen - Not In Catalog", set()),  # only the main artist counts
        ("Sunny", set()),  # an ambiguous name adds nothing
    ],
)
def test_fill(text: str, fill: set[str]) -> None:
    assert set(match_setlist(INDEX, parse_setlist_text(text)).fill_song_ids) == fill


@pytest.mark.parametrize("text", ["Kai Rivers - Neon Rivers", "Kai Rivers"])
def test_fill_uses_the_main_artist_of_the_matched_song(text: str) -> None:
    # The line names the guest; the song's main artist (Moonfish) fills.
    m = match_setlist(EXTRA_INDEX, parse_setlist_text(text))
    assert (m.list_song_ids, m.fill_song_ids) == (("x4",), ("x3",))


def test_fill_is_in_list_order_without_list_songs() -> None:
    m = match_setlist(INDEX, parse_setlist_text("Frozen - Let It Go\nQueen\nABBA - Not Here"))
    assert m.list_song_ids == ("f1", "q1", "q2")
    assert m.fill_song_ids == ("f2", "a1")
    assert [r.rule for r in m.results] == ["same_song", "artist_or_film", None]
    assert m.results[2].reason == "not_in_catalog"
