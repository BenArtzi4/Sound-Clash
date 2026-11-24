"""Text rules for a host's pasted song list (app/services/setlist_text.py).

Pure functions, no database. Spec: docs/planning/2026-11-24-custom-setlist-design.md
section 7. The parity of artist_keys() with the database's song_artist_keys()
is proved in tests/db/test_artist_keys_parity.py.
"""

# ruff: noqa: RUF001  (Hebrew test strings)

from __future__ import annotations

import json

import pytest

from app.db.errors import DomainError, SetlistError
from app.middleware.error_handler import domain_error_handler
from app.services.setlist_text import (
    MAX_CHARS,
    MAX_LINES,
    ListLine,
    artist_keys,
    clean_title,
    is_hebrew,
    norm,
    parse_setlist_text,
    skeleton,
)


def _pairs(text: str) -> list[tuple[str, str | None]]:
    return [(line.left, line.right) for line in parse_setlist_text(text)]


# ----- the brief's cases ---------------------------------------------------


def test_norm() -> None:
    assert norm("  Beyoncé ") == "beyonce"
    assert norm("שָׁלוֹם") == "שלום"  # niqqud
    assert norm("\u200fנערי שובה אליי\u200e") == "נערי שובה אלי"  # Review Focus 2
    assert norm("שב\"ק ס'") == norm("שב\u05f4ק ס\u05f3") == "שב ק ס"


def test_clean_title() -> None:
    assert clean_title('Let It Go - From "Frozen"/Soundtrack Version') == "Let It Go"
    assert (
        clean_title("Everybody (Backstreet's Back) - Extended Version")
        == "Everybody (Backstreet's Back)"
    )
    assert clean_title("Be Without You (Intro Clean)") == "Be Without You"
    assert clean_title("לאן שלא תלכי - רמיקס") == "לאן שלא תלכי"
    assert clean_title("Wake Me Up Before You Go-Go") == "Wake Me Up Before You Go-Go"


def test_artist_keys() -> None:
    assert artist_keys("Macklemore & Ryan Lewis ft. Ray Dalton") == (
        "macklemore",
        "ryan lewis",
        "ray dalton",
    )
    assert artist_keys("סטטיק ובן אל תבורי") == ("סטטיק", "בן אל תבורי")


def test_skeleton_is_the_same_in_both_scripts() -> None:
    assert skeleton("Zohar Argov") == skeleton("זוהר ארגוב") == "zrgb"
    assert skeleton("Ha'perah Be'gani") == skeleton("הפרח בגני") == "prbgn"


def test_parse_lines() -> None:
    text = (
        "\ufeff1. Queen - Bohemian Rhapsody\r\n\n# my party - 2026\n"
        "02 - ABBA \u2013 Dancing Queen  3:51\nFrozen\n"
    )
    assert _pairs(text) == [
        ("Queen", "Bohemian Rhapsody"),
        ("ABBA", "Dancing Queen"),
        ("Frozen", None),
    ]
    assert _pairs("50 Cent - In Da Club\n1999 - Prince") == [
        ("50 Cent", "In Da Club"),
        ("1999", "Prince"),
    ]


def test_parse_csv_with_header() -> None:
    text = 'Track Name,Artist Name(s),Album\nLet It Go,"Idina Menzel, Disney",Frozen\n'
    assert _pairs(text) == [("Idina Menzel, Disney", "Let It Go")]


@pytest.mark.parametrize(
    ("text", "code"),
    [  # Review Focus 1
        (
            "https://open.spotify.com/track/abc\nhttps://open.spotify.com/track/def",
            "setlist_links_only",
        ),
        ("https://open.spotify.com/playlist/xyz", "setlist_links_only"),
        ("a - b\n" * 301, "setlist_too_long"),
        ("x" * 20_001, "setlist_too_long"),
        ("  \n\n# only a comment\n", "setlist_no_songs"),
    ],
)
def test_parse_refuses(text: str, code: str) -> None:
    with pytest.raises(SetlistError) as e:
        parse_setlist_text(text)
    assert e.value.code == code
    assert e.value.message


# ----- more of each rule (made-up names) -----------------------------------


def test_limits() -> None:
    assert (MAX_LINES, MAX_CHARS) == (300, 20_000)


def test_is_hebrew() -> None:
    assert is_hebrew("Moonfish שיר")
    assert not is_hebrew("Moonfish 2")


def test_skeleton_collapses_doubles_and_maps_digraphs() -> None:
    assert skeleton("Shimmer Ke$$a") == skeleton("שימר קסה") == "smrks"
    assert skeleton("Tzlil Chen") == "zlkn"


def test_clean_title_keeps_plain_brackets_and_drops_years() -> None:
    assert clean_title("Glass Harbor (Night Swim)") == "Glass Harbor (Night Swim)"
    assert clean_title("Glass Harbor [Official Video]") == "Glass Harbor"
    assert clean_title("Glass Harbor - 2011 Remaster") == "Glass Harbor"
    assert clean_title("Glass Harbor (Live) Reprise") == "Glass Harbor Reprise"


def test_artist_keys_keeps_credit_order_and_drops_repeats() -> None:
    assert artist_keys("Moonfish feat. Velvet Otters & moonfish") == ("moonfish", "velvet otters")
    assert artist_keys("Moonfish x Otters") == ("moonfish", "otters")
    assert artist_keys("Lil Moon X & Otters") == ("lil moon x", "otters")
    assert artist_keys(" , ") == ()


def test_parse_keeps_raw_line() -> None:
    assert parse_setlist_text("  3) Moonfish - Glass Harbor  ") == [
        ListLine(raw="3) Moonfish - Glass Harbor", left="Moonfish", right="Glass Harbor")
    ]


def test_parse_drops_marks_bullets_and_durations() -> None:
    text = (
        "\u202b\u2022 Velvet Otters - Neon Tide\u202c\n"
        "* Moonfish \u2014 Glass Harbor\n"
        "- Paper Lanterns - Slow Rain (4:02)\n"
        "\u2066להקת הדגים - שיר הים\u2069\n"
        "\u200f\u200e\n"
    )
    assert _pairs(text) == [
        ("Velvet Otters", "Neon Tide"),
        ("Moonfish", "Glass Harbor"),
        ("Paper Lanterns", "Slow Rain"),
        ("להקת הדגים", "שיר הים"),
    ]


def test_parse_keeps_numbers_that_are_names() -> None:
    assert _pairs("The Moonfish - 12:51\n10.000 Lanterns - Moonfish\n*Otters - Tide") == [
        ("The Moonfish", "12:51"),
        ("10.000 Lanterns", "Moonfish"),
        ("*Otters", "Tide"),
    ]


def test_parse_keeps_song_lines_that_start_with_a_hashtag() -> None:
    text = "#1 Moonfish - Glass Harbor\n#NEONTIDE - Velvet Otters\n"
    assert _pairs(text) == [("#1 Moonfish", "Glass Harbor"), ("#NEONTIDE", "Velvet Otters")]


@pytest.mark.parametrize("comment", ["# my party - 2026", "## Side B", "#", "  #\tnote"])
def test_parse_drops_comment_lines(comment: str) -> None:
    assert _pairs(f"{comment}\nMoonfish - Glass Harbor\n") == [("Moonfish", "Glass Harbor")]


def test_parse_drops_link_and_symbol_lines_among_songs() -> None:
    text = "Moonfish - Glass Harbor\nhttps://youtu.be/abc\n2. www.example.com/x\n***\n- - -\n"
    assert _pairs(text) == [("Moonfish", "Glass Harbor")]


def test_parse_line_cap_counts_song_lines_only() -> None:
    text = "Moonfish - Glass Harbor\n\n# note\nhttps://x.example/a\n" * MAX_LINES
    assert len(text) <= MAX_CHARS
    assert len(parse_setlist_text(text)) == MAX_LINES


def test_parse_checks_length_before_anything_else() -> None:
    with pytest.raises(SetlistError) as e:
        parse_setlist_text("# " + "x" * (MAX_CHARS - 1))
    assert e.value.code == "setlist_too_long"


def test_parse_tsv_header_and_short_rows() -> None:
    text = (
        "Title\tArtist\tAlbum\n"
        "Glass Harbor\tMoonfish\tTides\n"
        "Neon Tide\t\tNight\n"
        "\tOtters\tDusk\n"
        "Velvet Otters - Slow Rain\n"
    )
    assert _pairs(text) == [
        ("Moonfish", "Glass Harbor"),
        ("Neon Tide", None),
        ("Otters", None),
        ("Velvet Otters", "Slow Rain"),
    ]


def test_parse_csv_header_skips_uri_columns() -> None:
    text = (
        "Track URI,Track Name,Artist URI(s),Artist Name(s)\n"
        "spotify:track:1,Glass Harbor,spotify:artist:2,Moonfish\n"
    )
    assert _pairs(text) == [("Moonfish", "Glass Harbor")]


def test_parse_first_line_without_header_names_is_a_song() -> None:
    assert _pairs("Glass Harbor, Moonfish\nSong\n") == [
        ("Glass Harbor, Moonfish", None),
        ("Song", None),
    ]


# ----- SetlistError ----------------------------------------------------------


def test_setlist_error_is_a_400_domain_error() -> None:
    err = SetlistError("artists_not_enough", "Pick more artists.")
    assert isinstance(err, DomainError)
    assert (err.status, err.code, err.message) == (400, "artists_not_enough", "Pick more artists.")
    assert str(err) == "Pick more artists."


async def test_setlist_error_envelope_carries_its_code() -> None:
    exc = SetlistError("setlist_no_songs", "No song names found.")
    resp = await domain_error_handler(None, exc)  # request arg is unused
    assert resp.status_code == 400
    assert json.loads(resp.body.decode()) == {
        "error": "setlist_no_songs",
        "message": "No song names found.",
    }
