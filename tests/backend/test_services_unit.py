"""Unit tests for pure service modules (no DB)."""

from __future__ import annotations

import io

import pytest

from app.db.errors import ConflictError, InternalError, ValidationError
from app.services import codes, csv_import, scoring

# ----- scoring -----------------------------------------------------------


def test_scoring_title_only() -> None:
    out = scoring.to_rpc_points(
        title_correct=True,
        artist_correct=False,
        wrong_buzz=False,
        timeout=False,
    )
    assert out == (10, 0, 0, 0)


def test_scoring_title_plus_artist() -> None:
    out = scoring.to_rpc_points(
        title_correct=True,
        artist_correct=True,
        wrong_buzz=False,
        timeout=False,
    )
    assert out == (10, 5, 0, 0)


def test_scoring_wrong_buzz() -> None:
    out = scoring.to_rpc_points(
        title_correct=False,
        artist_correct=False,
        wrong_buzz=True,
        timeout=False,
    )
    assert out == (0, 0, scoring.WRONG_BUZZ_PENALTY, 0)


def test_scoring_wrong_buzz_with_positive_raises() -> None:
    with pytest.raises(ValidationError):
        scoring.to_rpc_points(
            title_correct=True,
            artist_correct=False,
            wrong_buzz=True,
            timeout=False,
        )


def test_scoring_timeout_alone() -> None:
    out = scoring.to_rpc_points(
        title_correct=False,
        artist_correct=False,
        wrong_buzz=False,
        timeout=True,
    )
    assert out == (0, 0, 0, 1)


def test_scoring_timeout_with_other_flags_raises() -> None:
    with pytest.raises(ValidationError):
        scoring.to_rpc_points(
            title_correct=True,
            artist_correct=False,
            wrong_buzz=False,
            timeout=True,
        )


def test_scoring_constants_unchanged() -> None:
    assert scoring.TITLE_POINTS == 10
    assert scoring.ARTIST_POINTS == 5
    assert scoring.WRONG_BUZZ_PENALTY == 3
    assert scoring.BONUS_POINTS == 4


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


# ----- _award_blocking shape handling -----------------------------------


class _StubExecuteResponse:
    def __init__(self, data: object) -> None:
        self.data = data


class _StubRpc:
    def __init__(self, data: object) -> None:
        self._data = data

    def execute(self) -> _StubExecuteResponse:
        return _StubExecuteResponse(self._data)


class _StubSupabaseClient:
    def __init__(self, rpc_data: object) -> None:
        self._rpc_data = rpc_data

    def rpc(self, name: str, params: dict[str, object]) -> _StubRpc:
        del name, params
        return _StubRpc(self._rpc_data)


def _award_body() -> object:
    from uuid import UUID

    from app.models.games import AwardPointsRequest

    return AwardPointsRequest(
        round_id=UUID("00000000-0000-0000-0000-000000000001"),
        title_correct=True,
        artist_correct=False,
        wrong_buzz=False,
        timeout=False,
    )


def test_award_blocking_handles_postgrest_list_shape() -> None:
    """Real PostgREST returns TABLE-shaped functions as a list of row-dicts."""
    from app.routers.games import _award_blocking

    client = _StubSupabaseClient(
        rpc_data=[
            {
                "team_id": "11111111-1111-1111-1111-111111111111",
                "points_awarded": 10,
                "team_total_score": 10,
            }
        ],
    )
    out = _award_blocking(client, "ABCDEF", _award_body())
    assert out["points_awarded"] == 10
    assert out["team_total_score"] == 10


def test_award_blocking_accepts_legacy_dict_shape() -> None:
    """Older test mocks pass a bare dict — keep working with both shapes."""
    from app.routers.games import _award_blocking

    client = _StubSupabaseClient(
        rpc_data={
            "team_id": "11111111-1111-1111-1111-111111111111",
            "points_awarded": 5,
            "team_total_score": 5,
        },
    )
    out = _award_blocking(client, "ABCDEF", _award_body())
    assert out["points_awarded"] == 5


def test_award_blocking_empty_list_raises_not_found() -> None:
    """Defensive: an unexpected empty list response surfaces as 404, not 500."""
    from app.db.errors import NotFoundError
    from app.routers.games import _award_blocking

    client = _StubSupabaseClient(rpc_data=[])
    with pytest.raises(NotFoundError):
        _award_blocking(client, "ABCDEF", _award_body())
