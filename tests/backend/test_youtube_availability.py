"""Unit tests for the YouTube availability probe service (no DB, no network).

The oEmbed HTTP call is stubbed by monkeypatching ``urllib.request.urlopen``;
``check_many``'s batching is exercised with a stubbed ``check_oembed``.
"""

from __future__ import annotations

import urllib.error
import urllib.request

from app.services import youtube_availability


class _FakeResponse:
    def __init__(self, status: int) -> None:
        self.status = status

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


def _urlopen_returning(status: int):
    def _fake(request: object, timeout: float) -> _FakeResponse:
        return _FakeResponse(status)

    return _fake


def _urlopen_raising(exc: BaseException):
    def _fake(request: object, timeout: float) -> _FakeResponse:
        raise exc

    return _fake


def _http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="https://www.youtube.com/oembed", code=code, msg="err", hdrs=None, fp=None
    )


# ----- check_oembed classification --------------------------------------


def test_status_200_is_ok(monkeypatch) -> None:
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen_returning(200))
    assert youtube_availability.check_oembed("abcDEF12345") == "ok"


def test_non_200_success_is_unknown(monkeypatch) -> None:
    # A 2xx that isn't 200 (e.g. 204/206) is treated as unknown, never dead.
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen_returning(206))
    assert youtube_availability.check_oembed("abcDEF12345") == "unknown"


def test_404_is_dead(monkeypatch) -> None:
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen_raising(_http_error(404)))
    assert youtube_availability.check_oembed("abcDEF12345") == "dead"


def test_401_is_unknown_not_dead(monkeypatch) -> None:
    # Embed-disabled / region-blocked: the IFrame may still play it.
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen_raising(_http_error(401)))
    assert youtube_availability.check_oembed("abcDEF12345") == "unknown"


def test_5xx_is_unknown_not_dead(monkeypatch) -> None:
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen_raising(_http_error(503)))
    assert youtube_availability.check_oembed("abcDEF12345") == "unknown"


def test_url_error_is_unknown(monkeypatch) -> None:
    monkeypatch.setattr(
        urllib.request, "urlopen", _urlopen_raising(urllib.error.URLError("boom"))
    )
    assert youtube_availability.check_oembed("abcDEF12345") == "unknown"


def test_timeout_is_unknown_not_dead(monkeypatch) -> None:
    # The core guarantee: a slow/unreachable network never reports "dead".
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen_raising(TimeoutError("slow")))
    assert youtube_availability.check_oembed("abcDEF12345") == "unknown"


# ----- check_many batching ----------------------------------------------


async def test_check_many_maps_each_id(monkeypatch) -> None:
    mapping = {"aliveVIDEO1": "ok", "deadVIDEO01": "dead", "unknownVID1": "unknown"}

    def fake(youtube_id: str, *, timeout: float = 3.0) -> str:
        return mapping[youtube_id]

    monkeypatch.setattr(youtube_availability, "check_oembed", fake)
    result = await youtube_availability.check_many(list(mapping))
    assert result == mapping


async def test_check_many_dedupes_ids(monkeypatch) -> None:
    calls: list[str] = []

    def fake(youtube_id: str, *, timeout: float = 3.0) -> str:
        calls.append(youtube_id)
        return "ok"

    monkeypatch.setattr(youtube_availability, "check_oembed", fake)
    result = await youtube_availability.check_many(["dupVIDEO001", "dupVIDEO001", "otherVID01"])
    assert result == {"dupVIDEO001": "ok", "otherVID01": "ok"}
    assert sorted(calls) == ["dupVIDEO001", "otherVID01"]


async def test_check_many_empty_list(monkeypatch) -> None:
    def fake(youtube_id: str, *, timeout: float = 3.0) -> str:  # pragma: no cover - never called
        raise AssertionError("should not probe for an empty list")

    monkeypatch.setattr(youtube_availability, "check_oembed", fake)
    assert await youtube_availability.check_many([]) == {}
