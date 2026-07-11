"""Probe YouTube video availability via the public oEmbed endpoint.

Backs the admin-only catalog health check (I-Liveness, issue #248). It is
deliberately **report-only**: it classifies each ``youtube_id`` as alive /
dead / unknown and never writes. See ``docs/api-contracts.md`` §2.10.

The probe uses the Python **stdlib** (``urllib``) with a short timeout so the
check stays a dependency-free admin utility — ``httpx`` is not a prod
dependency. Blocking calls run in worker threads via ``anyio`` with a bounded
capacity limiter so a page of a few hundred ids never opens a socket per song
(and stays polite to YouTube).
"""

from __future__ import annotations

import urllib.error
import urllib.parse
import urllib.request
from typing import Literal

import anyio

Availability = Literal["ok", "dead", "unknown"]

_OEMBED_URL = "https://www.youtube.com/oembed"

# A live oEmbed responds in tens of milliseconds; a short timeout keeps the
# worst case bounded without ever mislabelling a slow-but-live video as dead.
_PROBE_TIMEOUT_SECONDS = 3.0

# Bound concurrent probes. Worst-case wall time for a page is
# ``ceil(len(ids) / concurrency) * timeout`` — with the route's 250-id cap that
# is ``ceil(250/16) * 3s = 48s``, comfortably under Render's ~100s gateway
# timeout even if every probe times out.
_MAX_CONCURRENCY = 16


def check_oembed(youtube_id: str, *, timeout: float = _PROBE_TIMEOUT_SECONDS) -> Availability:
    """Classify one video by its YouTube oEmbed HTTP status.

    - ``200`` → ``"ok"`` (embeddable / alive)
    - ``404`` → ``"dead"`` (a valid-format id that points to no video — the
      shape a deleted catalog video returns; verified against real oEmbed)
    - any other status → ``"unknown"``, specifically:
      - ``401`` — embed disabled / region-blocked (may still play in the IFrame)
      - ``400`` — YouTube rejects the id as malformed (real oEmbed returns this
        for some ids; catalog ids are valid-format so this is anomalous, worth a
        human look but not a definite death)
      - ``5xx`` / timeout / network error — transient
    - timeout / network error → ``"unknown"``

    The one hard guarantee: only a definitive ``404`` is ``"dead"``; anything
    ambiguous or transient is ``"unknown"``, so acting on the result can never
    remove a video that is merely unreachable or embed-restricted right now.
    """
    query = urllib.parse.urlencode(
        {"url": f"https://www.youtube.com/watch?v={youtube_id}", "format": "json"}
    )
    # S310: the URL is a fixed ``https://`` constant with a model-validated
    # 11-char id interpolated — never a caller-controlled scheme — so there is
    # no file:/custom-scheme risk that the audit warns about.
    request = urllib.request.Request(f"{_OEMBED_URL}?{query}", method="GET")  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return "ok" if response.status == 200 else "unknown"
    except urllib.error.HTTPError as exc:
        # 404 is the only status that definitively means the video is gone.
        return "dead" if exc.code == 404 else "unknown"
    except (urllib.error.URLError, TimeoutError, OSError):
        return "unknown"


async def check_many(
    youtube_ids: list[str], *, concurrency: int = _MAX_CONCURRENCY
) -> dict[str, Availability]:
    """Probe many ids concurrently → ``{youtube_id: availability}``.

    Each blocking ``check_oembed`` runs in a worker thread; a shared capacity
    limiter caps how many run at once. Duplicate ids are probed once (the
    catalog enforces ``UNIQUE(youtube_id)``, mig 042, so this is a no-op there).
    """
    results: dict[str, Availability] = {}
    limiter = anyio.CapacityLimiter(concurrency)

    async def _probe(youtube_id: str) -> None:
        results[youtube_id] = await anyio.to_thread.run_sync(
            check_oembed, youtube_id, limiter=limiter
        )

    async with anyio.create_task_group() as task_group:
        for youtube_id in dict.fromkeys(youtube_ids):
            task_group.start_soon(_probe, youtube_id)
    return results
