"""Tests for whole_names.py: made-up credits only, no database and no network.

Run from the repository root::

    PYTHONUTF8=1 <backend venv python> -m pytest tools/song-curation/aliases/test_whole_names.py -p no:cov -q
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

import pytest
import whole_names  # puts this checkout's backend first on sys.path
from common import artist_keys

FILM = "The Lamp, the Owl and the Kettle"
HEBREW = "זוטי ורמבל"  # made up; the database cuts it at the word that starts with vav
DASH = "\N{EM DASH}"
CANDIDATE_HEADER = ["credit", "name", "pieces", "songs", "kind", "solo"]


def song(
    sid: str,
    artist: str,
    genres: str = "pop",
    *,
    unavailable: bool = False,
    keys: list[str] | None = None,
) -> dict[str, Any]:
    """One row of a catalog dump; artist_keys as the database stores them (distinct, sorted)."""
    return {
        "id": sid,
        "title": f"Made-up song {sid}",
        "artist": artist,
        "unavailable_at": "2026-11-01 00:00:00+00" if unavailable else None,
        "artist_keys": sorted(set(artist_keys(artist))) if keys is None else keys,
        "genres": genres,
    }


def base_rows() -> list[dict[str, Any]]:
    return [
        # A duet: both artists also have songs of their own. Two of the three playable songs
        # spell it "Zed Band & Ann Lee"; the byte-smaller all-capitals spelling has one.
        song("a01", "Zed Band & Ann Lee"),
        song("a02", "ZED BAND & ANN LEE"),
        song("a03", "Zed Band & Ann Lee"),
        song("a04", "Zed Band & Ann Lee", unavailable=True),
        song("a05", "Zed Band"),
        song("a06", "Ann Lee"),
        # One band with "&"; once trimmed, two spellings with one song each (a tie). One of
        # the songs has no soundtrack genre, so it is not a film.
        song("b01", "Salt & pepper co"),
        song("b02", " Salt & Pepper Co ", "pop;soundtracks"),
        # A film whose title holds a comma: every song has a soundtrack genre.
        song("c01", FILM, "soundtracks"),
        song("c02", FILM, "israeli-soundtracks;pop"),
        # Hebrew, cut at a mid-name word that starts with vav.
        song("d01", HEBREW, "mizrahit"),
        # Only unavailable songs: not listed.
        song("e01", "Gone & Away", unavailable=True),
        # The database cuts it, the Python split does not: listed, and reported.
        song("f01", "Kettle Duo", keys=["duo", "kettle"]),
    ]


def extra_rows() -> list[dict[str, Any]]:
    """Rows the sql tests add: a quote, two credits that hold a whole name, a near miss."""
    return [
        song("g01", "Jo's Kettle & Co"),
        song("h01", "Salt & Pepper Co feat. Ann Lee"),
        song("h02", "Pim Tobble, the Lamp, the Owl and the Kettle"),
        song("h03", "Salt & Pepper Cola & Ann Lee"),  # "salt & pepper co" then "la": not held
    ]


def write_dump(path: Path, rows: list[dict[str, Any]]) -> Path:
    body = json.dumps({"boundary": "made-up", "rows": rows}, ensure_ascii=False, indent=1)
    path.write_text("Initialising login role...\n" + body + "\n", encoding="utf-8", newline="\n")
    return path


def run_candidates(tmp_path: Path, rows: list[dict[str, Any]]) -> Path:
    dump = write_dump(tmp_path / "catalog_raw.json", rows)
    out = tmp_path / "batch" / "candidates.tsv"
    assert whole_names.main(["candidates", str(dump), str(out)]) == 0
    return out


def read_tsv(path: Path) -> list[list[str]]:
    return [line.split("\t") for line in path.read_text(encoding="utf-8").split("\n") if line]


@pytest.fixture
def listed(tmp_path: Path) -> dict[str, dict[str, str]]:
    """The candidate rows of base_rows(), by name."""
    header, *rows = read_tsv(run_candidates(tmp_path, base_rows()))
    assert header == CANDIDATE_HEADER
    return {row[1]: dict(zip(header, row, strict=True)) for row in rows}


# ----- candidates ---------------------------------------------------------------------------


def test_candidates_file_rows_and_order(tmp_path: Path) -> None:
    out = run_candidates(tmp_path, base_rows())
    assert read_tsv(out) == [
        CANDIDATE_HEADER,
        ["Zed Band & Ann Lee", "zed band & ann lee", "Zed Band | Ann Lee", "3", "en", "yes | yes"],
        ["Salt & Pepper Co", "salt & pepper co", "Salt | Pepper Co", "2", "en", "no | no"],
        [FILM, FILM.lower(), "The Lamp | the Owl and the Kettle", "2", "film", "no | no"],
        ["Kettle Duo", "kettle duo", "Kettle Duo", "1", "en", "no"],
        [HEBREW, HEBREW, "זוטי | רמבל", "1", "he", "no | no"],
    ]
    raw = out.read_bytes()
    assert b"\r" not in raw
    assert raw.endswith(b"\n")


def test_duet_whose_artists_have_songs_of_their_own(listed: dict[str, dict[str, str]]) -> None:
    row = listed["zed band & ann lee"]
    assert row["pieces"] == "Zed Band | Ann Lee"
    assert row["solo"] == "yes | yes"
    assert row["kind"] == "en"


def test_band_with_ampersand(listed: dict[str, dict[str, str]]) -> None:
    row = listed["salt & pepper co"]
    assert row["pieces"] == "Salt | Pepper Co"
    assert row["solo"] == "no | no"
    assert row["kind"] == "en"  # one of its songs has no soundtrack genre


def test_film_title_with_a_comma(listed: dict[str, dict[str, str]]) -> None:
    row = listed[FILM.lower()]
    assert row["credit"] == FILM
    assert row["pieces"] == "The Lamp | the Owl and the Kettle"
    assert row["kind"] == "film"


def test_hebrew_credit_cut_at_a_word_that_starts_with_vav(
    listed: dict[str, dict[str, str]],
) -> None:
    row = listed[HEBREW]
    assert row["pieces"] == "זוטי | רמבל"
    assert row["kind"] == "he"
    assert row["solo"] == "no | no"


def test_credit_with_one_key_is_not_listed(listed: dict[str, dict[str, str]]) -> None:
    assert "zed band" not in listed
    assert "ann lee" not in listed


def test_unavailable_songs_do_not_count(listed: dict[str, dict[str, str]]) -> None:
    assert listed["zed band & ann lee"]["songs"] == "3"
    assert "gone & away" not in listed


def test_most_common_spelling_then_byte_order(listed: dict[str, dict[str, str]]) -> None:
    # 2 to 1 beats the byte-smaller "ZED BAND & ANN LEE".
    assert listed["zed band & ann lee"]["credit"] == "Zed Band & Ann Lee"
    # Trimmed, "Salt & Pepper Co" and "Salt & pepper co" tie 1 to 1: "P" sorts before "p".
    assert listed["salt & pepper co"]["credit"] == "Salt & Pepper Co"


def test_split_disagreement_is_listed_and_reported(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = run_candidates(tmp_path, base_rows())
    names = [row[1] for row in read_tsv(out)[1:]]
    assert "kettle duo" in names  # the database's keys decide
    mismatch = out.with_name("candidates.mismatch.tsv")
    header, *rows = read_tsv(mismatch)
    assert header == ["credit", "name", "pieces", "artist_keys", "listed"]
    assert rows == [["Kettle Duo", "kettle duo", "Kettle Duo", "duo | kettle", "yes"]]
    stdout = capsys.readouterr().out
    assert re.search(r"disagree\D*1\b", stdout)
    assert re.search(r"\b5 credits\b", stdout)


def test_candidates_stdout_names_no_artist(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run_candidates(tmp_path, base_rows() + extra_rows())
    stdout = capsys.readouterr().out.lower()
    for word in ("zed", "ann lee", "salt", "lamp", "kettle", "tobble", "זוטי"):
        assert word not in stdout


@pytest.mark.parametrize(
    "artist",
    [
        "Tab\tBand & Co",
        "Line\nBand & Co",
        "Return\rBand & Co",
        "Para\N{PARAGRAPH SEPARATOR}Band & Co",
    ],
)
def test_tab_or_line_break_is_refused(tmp_path: Path, artist: str) -> None:
    dump = write_dump(tmp_path / "catalog_raw.json", [*base_rows(), song("z01", artist)])
    out = tmp_path / "batch" / "candidates.tsv"
    with pytest.raises(SystemExit) as refused:
        whole_names.main(["candidates", str(dump), str(out)])
    assert refused.value.code not in (0, None)
    assert not out.exists()


@pytest.mark.parametrize(
    "credit",
    [
        "Zed Band & Ann Lee",
        FILM,
        HEBREW,
        "Salt & Pepper Co feat. Ann Lee",
        "A x B ft. C, D vs. E",
        "Zed & zed & Ann",
        "  Padded & Name  ",
    ],
)
def test_pieces_follow_the_product_split(credit: str) -> None:
    assert [p.lower() for p in whole_names.pieces_of(credit)] == list(artist_keys(credit))


# ----- sql -------------------------------------------------------------------------------------

DEFAULT_MARKS = ("several", "", "several", "")
MARKS = {
    "salt & pepper co": ("one", "A made-up band page", "one", "same band"),
    FILM.lower(): ("one", "A made-up film page", "one", ""),
    "jo's kettle & co": ("one", "", "one", ""),
    HEBREW: ("one", "A made-up label page", "several", "two made-up singers"),
    "kettle duo": ("several", "a made-up shop page", "one", ""),
}
UPLOADED = sorted(["salt & pepper co", FILM.lower(), "jo's kettle & co"])


def reviewed_file(
    tmp_path: Path, marks: dict[str, tuple[str, str, str, str]] | None = None
) -> Path:
    """The candidates of base_rows() + extra_rows() with the four review columns appended."""
    marks = MARKS if marks is None else marks
    lines = run_candidates(tmp_path, base_rows() + extra_rows()).read_text(encoding="utf-8")
    header, *rows = lines.splitlines()
    out = [header + "\tresearch\tsource\tcheck\tcheck_note"]
    for row in rows:
        out.append(row + "\t" + "\t".join(marks.get(row.split("\t")[1], DEFAULT_MARKS)))
    path = tmp_path / "batch" / "reviewed.tsv"
    path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    return path


def run_sql(tmp_path: Path, reviewed: Path) -> tuple[int, Path]:
    out = tmp_path / "upload" / "whole_names.sql"
    return whole_names.main(["sql", str(reviewed), str(out)]), out.parent


@pytest.fixture
def sql_files(tmp_path: Path) -> Path:
    code, folder = run_sql(tmp_path, reviewed_file(tmp_path))
    assert code == 0
    return folder


def read(folder: Path, name: str) -> str:
    return (folder / name).read_text(encoding="utf-8")


def literals(sql: str) -> list[str]:
    """The string literals of a SQL file (comment lines left out), unquoted."""
    body = "\n".join(line for line in sql.splitlines() if not line.startswith("--"))
    return [m.replace("''", "'") for m in re.findall(r"'((?:[^']|'')*)'", body)]


def table() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE artist_whole_names (name text PRIMARY KEY)")
    return conn


def names_in(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute("SELECT name FROM artist_whole_names ORDER BY name")]


def test_sql_uploads_only_rows_both_agents_marked_one(sql_files: Path) -> None:
    upload = read(sql_files, "whole_names.sql")
    assert sorted(literals(upload)) == UPLOADED
    assert "INSERT INTO artist_whole_names (name) VALUES" in upload
    assert upload.rstrip().endswith("ON CONFLICT DO NOTHING;")


def test_sql_values_are_lower_case_and_quotes_doubled(sql_files: Path) -> None:
    for name in ("whole_names.sql", "undo_whole_names.sql", "verify_whole_names.sql"):
        sql = read(sql_files, name)
        assert all(v == v.strip(" ").lower() for v in literals(sql))
        assert "'jo''s kettle & co'" in sql
        assert "Salt" not in sql
        assert "\r" not in sql


def test_upload_runs_twice_and_undo_empties_the_table(sql_files: Path) -> None:
    conn = table()
    upload = read(sql_files, "whole_names.sql")
    conn.execute(upload)  # execute() takes one statement only
    conn.execute(upload)
    assert names_in(conn) == UPLOADED
    conn.execute(read(sql_files, "undo_whole_names.sql"))
    assert names_in(conn) == []


def test_undo_deletes_exactly_the_uploaded_names(sql_files: Path) -> None:
    conn = table()
    conn.execute("INSERT INTO artist_whole_names VALUES ('an older made-up name')")
    conn.execute(read(sql_files, "whole_names.sql"))
    assert sorted(literals(read(sql_files, "undo_whole_names.sql"))) == UPLOADED
    conn.execute(read(sql_files, "undo_whole_names.sql"))
    assert names_in(conn) == ["an older made-up name"]


def test_verify_is_one_select_over_the_uploaded_names(sql_files: Path) -> None:
    verify = read(sql_files, "verify_whole_names.sql")
    statement = "\n".join(line for line in verify.splitlines() if not line.startswith("--"))
    assert statement.lstrip().upper().startswith(("WITH", "SELECT"))
    assert statement.count(";") == 1
    for word in ("INSERT", "DELETE", "UPDATE"):
        assert word not in statement.upper()
    conn = table()
    assert conn.execute(verify).fetchall() == [(n, 0) for n in UPLOADED]
    conn.execute(read(sql_files, "whole_names.sql"))
    assert conn.execute(verify).fetchall() == [(n, 1) for n in UPLOADED]
    conn.execute(read(sql_files, "undo_whole_names.sql"))
    assert conn.execute(verify).fetchall() == [(n, 0) for n in UPLOADED]


def test_review_txt(sql_files: Path) -> None:
    assert read(sql_files, "review.txt") == "\n".join(
        [
            "One artist (will be uploaded): 3",
            f"Salt & Pepper Co instead of Salt, Pepper Co {DASH} A made-up band page",
            f"{FILM} instead of The Lamp, the Owl and the Kettle {DASH} A made-up film page",
            f"Jo's Kettle & Co instead of Jo's Kettle, Co {DASH} (no source)",
            "",
            "The agents did not agree (not uploaded): 2",
            f"Kettle Duo {DASH} first: several, second: one {DASH} a made-up shop page",
            f"{HEBREW} {DASH} first: one, second: several {DASH} two made-up singers",
            "",
        ]
    )


def test_contained_txt_finds_a_longer_credit_that_holds_an_uploaded_name(
    sql_files: Path,
) -> None:
    assert read(sql_files, "contained.txt") == "\n".join(
        [
            "Credits that hold a whole name inside (they stay cut): 2",
            f"Pim Tobble, the Lamp, the Owl and the Kettle {DASH} holds {FILM.lower()}",
            f"Salt & Pepper Co feat. Ann Lee {DASH} holds salt & pepper co",
            "",
        ]
    )


def test_holds_needs_a_separator_on_each_side() -> None:
    assert whole_names.holds("zed & co feat. ann lee", "zed & co")
    assert whole_names.holds("ann lee & zed & co", "zed & co")
    assert whole_names.holds("ann lee, zed & co, max", "zed & co")
    assert not whole_names.holds("zed & cola & ann lee", "zed & co")
    assert not whole_names.holds("razed & co & ann lee", "zed & co")
    assert not whole_names.holds("zed & co", "zed & co")


@pytest.mark.parametrize(
    ("column", "value"),
    [("research", "maybe"), ("check", ""), ("check", "One"), ("research", "yes")],
)
def test_a_bad_mark_is_refused(tmp_path: Path, column: str, value: str) -> None:
    research, source, check, note = MARKS["salt & pepper co"]
    if column == "research":
        research = value
    else:
        check = value
    marks = {**MARKS, "salt & pepper co": (research, source, check, note)}
    reviewed = reviewed_file(tmp_path, marks)
    with pytest.raises(SystemExit) as refused:
        run_sql(tmp_path, reviewed)
    assert refused.value.code not in (0, None)
    assert not (tmp_path / "upload").exists()


@pytest.mark.parametrize(
    "name",
    [
        "",
        "Salt & pepper co",
        " salt & pepper co",
        "salt & pepper co ",
        "salt" + chr(0) + "co",
        "salt" + chr(7) + "co",
        "salt" + chr(0x9F) + "co",
    ],
)
def test_a_bad_name_is_refused(name: str) -> None:
    with pytest.raises(SystemExit) as refused:
        whole_names.name_literal(name, "row 2")
    assert refused.value.code not in (0, None)


def test_name_literal_doubles_a_quote() -> None:
    assert whole_names.name_literal("jo's kettle & co", "row 2") == "'jo''s kettle & co'"


def test_a_reviewed_file_without_the_four_columns_is_refused(tmp_path: Path) -> None:
    candidates = run_candidates(tmp_path, base_rows())
    with pytest.raises(SystemExit) as refused:
        run_sql(tmp_path, candidates)
    assert refused.value.code not in (0, None)


def test_with_no_row_to_upload_no_sql_is_written(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    marks = {HEBREW: MARKS[HEBREW]}
    code, folder = run_sql(tmp_path, reviewed_file(tmp_path, marks))
    assert code == 1
    assert not list(folder.glob("*.sql"))
    assert read(folder, "review.txt").startswith("One artist (will be uploaded): 0\n")
    assert "no row to upload" in capsys.readouterr().out


def test_sql_stdout_names_no_artist(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    capsys.readouterr()
    run_sql(tmp_path, reviewed_file(tmp_path))
    stdout = capsys.readouterr().out.lower()
    assert "uploaded" in stdout
    for word in ("zed", "ann lee", "salt", "lamp", "kettle", "tobble", "זוטי"):
        assert word not in stdout
