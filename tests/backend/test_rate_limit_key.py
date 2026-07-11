"""F-P2-5: rate-limit key resolves the real client IP, spoof-resistant.

Pure unit tests over ``rate_limit.client_ip`` — no DB, no HTTP. A starlette
``Request`` is built directly from a header list.
"""

from __future__ import annotations

from starlette.requests import Request

from app.middleware.rate_limit import client_ip


def _req(headers: dict[str, str], client_host: str | None = "203.0.113.9") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope: dict = {
        "type": "http",
        "headers": raw,
        "client": (client_host, 12345) if client_host else None,
    }
    return Request(scope)


def test_prefers_cf_connecting_ip() -> None:
    # CF-Connecting-IP wins even when a (spoofable) X-Forwarded-For is present.
    r = _req({"cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 8.8.8.8"})
    assert client_ip(r) == "1.2.3.4"


def test_cf_connecting_ip_trimmed() -> None:
    assert client_ip(_req({"cf-connecting-ip": "  1.2.3.4  "})) == "1.2.3.4"


def test_falls_back_to_rightmost_xff_hop() -> None:
    # The rightmost entry is the one the nearest trusted proxy appended; the
    # leftmost is client-spoofable, so we must NOT use it.
    r = _req({"x-forwarded-for": "9.9.9.9, 8.8.8.8, 7.7.7.7"})
    assert client_ip(r) == "7.7.7.7"


def test_single_xff_value() -> None:
    assert client_ip(_req({"x-forwarded-for": "9.9.9.9"})) == "9.9.9.9"


def test_falls_back_to_socket_peer() -> None:
    assert client_ip(_req({}, client_host="203.0.113.9")) == "203.0.113.9"


def test_no_client_defaults_to_loopback() -> None:
    # get_remote_address returns 127.0.0.1 when the scope has no client.
    assert client_ip(_req({}, client_host=None)) == "127.0.0.1"
