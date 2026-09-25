"""Probe YouTube video availability via the public oEmbed endpoint.

Backs the admin-only catalog health check (I-Liveness, issue #248). It is
deliberately **report-only**: it classifies each ``youtube_id`` as alive /
dead / unplayable / unknown and never writes (the route decides whether to
persist). See ``docs/api-contracts.md`` §2.10.

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

Availability = Literal["ok", "dead", "unplayable", "unknown"]

_OEMBED_URL = "https://www.youtube.com/oembed"

# oEmbed error statuses that definitively mean "this video will not play in our
# embedded player". 401 = the owner disabled embedding; 403 = the video is
# private (verified 2026-09-25 against two catalog videos whose watch pages say
# "Private video"). Everything else stays "unknown".
_HTTP_VERDICTS: dict[int, Availability] = {404: "dead", 401: "unplayable", 403: "unplayable"}

# A long-lived public, embeddable video. The scan re-probes it before trusting a
# page of "dead"/"unplayable" verdicts: if YouTube starts answering this
# server's IP with 403/401 across the board (a bot block), the canary fails too
# and the page is reported as "unknown" instead of taking the catalog offline.
CANARY_YOUTUBE_ID = "dQw4w9WgXcQ"

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
    - ``401`` / ``403`` → ``"unplayable"`` (embedding disabled / private: the
      IFrame player fails on it every time)
    - any other status → ``"unknown"``, specifically:
      - ``400`` — YouTube rejects the id as malformed (real oEmbed returns this
        for some ids; catalog ids are valid-format so this is anomalous, worth a
        human look but not a definite death)
      - ``429`` / ``5xx`` — rate limited or transient
    - timeout / network error → ``"unknown"``

    Only a definitive answer about the video itself is ``"dead"`` or
    ``"unplayable"``; anything ambiguous or transient is ``"unknown"``, so
    acting on the result never removes a video that is merely unreachable right
    now. The route additionally re-probes ``CANARY_YOUTUBE_ID`` before trusting
    a definitive verdict (see ``youtube_answers_normally``).
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
        return _HTTP_VERDICTS.get(exc.code, "unknown")
    except (urllib.error.URLError, TimeoutError, OSError):
        return "unknown"


async def youtube_answers_normally() -> bool:
    """True when the known-good canary video probes as ``"ok"`` right now.

    A ``False`` means YouTube's answers to this server can't be trusted at the
    moment (IP block, outage), so no definitive verdict should be persisted.
    """
    verdict = await anyio.to_thread.run_sync(check_oembed, CANARY_YOUTUBE_ID)
    return verdict == "ok"


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
