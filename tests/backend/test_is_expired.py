"""Unit tests for the games-router expiry helper (no DB needed)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.routers.games import _is_expired


def test_missing_expires_at_is_not_expired() -> None:
    assert _is_expired({}) is False
    assert _is_expired({"expires_at": None}) is False


def test_past_datetime_is_expired() -> None:
    past = datetime.now(UTC) - timedelta(hours=1)
    assert _is_expired({"expires_at": past}) is True


def test_future_datetime_is_not_expired() -> None:
    future = datetime.now(UTC) + timedelta(hours=1)
    assert _is_expired({"expires_at": future}) is False


def test_iso_string_past_is_expired() -> None:
    past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    assert _is_expired({"expires_at": past}) is True


def test_iso_string_with_z_suffix_is_parsed() -> None:
    # PostgREST may emit a trailing Z; ensure it still parses.
    assert _is_expired({"expires_at": "2000-01-01T00:00:00Z"}) is True


def test_naive_datetime_is_treated_as_utc() -> None:
    naive_past = datetime(2000, 1, 1, 0, 0, 0)  # no tzinfo
    assert _is_expired({"expires_at": naive_past}) is True


def test_unparseable_string_is_not_expired() -> None:
    assert _is_expired({"expires_at": "not-a-timestamp"}) is False
