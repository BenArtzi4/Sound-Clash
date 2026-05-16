"""Unit tests for pure service modules (no DB)."""

from __future__ import annotations

import io

import pytest

from app.db.errors import ConflictError, InternalError, ValidationError
from app.services import codes, csv_import

# ----- game-code generation ---------------------------------------------


def test_generate_code_length_and_alphabet() -> None:
    for _ in range(50):
        code = codes.generate_code()
        assert len(code) == codes.CODE_LENGTH
        assert all(ch in codes.ALPHABET for ch in code)


async def test_generate_unique_code_retries_on_conflict() -> None:
    attempts: list[str] = []

    async def insert(code: str) -> None:
        attempts.append(code)
        if len(attempts) < 3:
            raise ConflictError("dup")

    code = await codes.generate_unique_code(insert)
    assert len(attempts) == 3
    assert code == attempts[-1]


async def test_generate_unique_code_exhausts_after_retries() -> None:
    async def always_dup(_code: str) -> None:
        raise ConflictError("dup")

    with pytest.raises(InternalError):
        await codes.generate_unique_code(always_dup, max_retries=3)


# ----- csv_import.parse_csv ---------------------------------------------


HEADER = "title,artist,youtube_id,start_time,is_soundtrack,source,genres"


def _bytes(rows: list[str]) -> bytes:
    return ("\n".join([HEADER, *rows]) + "\n").encode("utf-8")


def test_parse_csv_happy_path() -> None:
    rows = csv_import.parse_csv(_bytes(["Hello,Adele,YQHsXMglC9A,0,false,,rock"]))
    assert len(rows) == 1
    assert rows[0].title == "Hello"
    assert rows[0].is_soundtrack is False
    assert rows[0].genre_slugs == ["rock"]


def test_parse_csv_missing_header_columns() -> None:
    bad = b"title,artist\nHello,Adele\n"
    with pytest.raises(ValidationError) as exc_info:
        csv_import.parse_csv(bad)
    assert exc_info.value.details is not None
    assert exc_info.value.details["issue"] == "missing_columns"


def test_parse_csv_empty_body_rejected() -> None:
    with pytest.raises(ValidationError):
        csv_import.parse_csv((HEADER + "\n").encode("utf-8"))


def test_parse_csv_invalid_youtube_id() -> None:
    with pytest.raises(ValidationError) as exc_info:
        csv_import.parse_csv(_bytes(["Hi,There,short,0,false,,rock"]))
    assert exc_info.value.details["field"] == "youtube_id"


def test_parse_csv_missing_title() -> None:
    with pytest.raises(ValidationError) as exc_info:
        csv_import.parse_csv(_bytes([",Adele,YQHsXMglC9A,0,false,,rock"]))
    assert exc_info.value.details["field"] == "title"


def test_parse_csv_missing_artist() -> None:
    with pytest.raises(ValidationError) as exc_info:
        csv_import.parse_csv(_bytes(["Hello,,YQHsXMglC9A,0,false,,rock"]))
    assert exc_info.value.details["field"] == "artist"


def test_parse_csv_negative_start_time() -> None:
    with pytest.raises(ValidationError):
        csv_import.parse_csv(_bytes(["Hello,Adele,YQHsXMglC9A,-1,false,,rock"]))


def test_parse_csv_bad_int_start_time() -> None:
    with pytest.raises(ValidationError):
        csv_import.parse_csv(_bytes(["Hello,Adele,YQHsXMglC9A,abc,false,,rock"]))


def test_parse_csv_bad_boolean() -> None:
    with pytest.raises(ValidationError):
        csv_import.parse_csv(_bytes(["Hello,Adele,YQHsXMglC9A,0,maybe,,rock"]))


def test_parse_csv_no_genre_slugs() -> None:
    with pytest.raises(ValidationError):
        csv_import.parse_csv(_bytes(["Hello,Adele,YQHsXMglC9A,0,false,,"]))


def test_parse_csv_accepts_stream() -> None:
    rows = csv_import.parse_csv(
        io.BytesIO(_bytes(["Hello,Adele,YQHsXMglC9A,0,true,Movie,rock;pop"]))
    )
    assert rows[0].is_soundtrack is True
    assert rows[0].source == "Movie"
    assert rows[0].genre_slugs == ["rock", "pop"]


def test_parse_csv_strips_bom() -> None:
    raw = b"\xef\xbb\xbf" + _bytes(["Hi,Adele,YQHsXMglC9A,0,false,,rock"])
    rows = csv_import.parse_csv(raw)
    assert rows[0].title == "Hi"


