"""Find Latin spellings of the catalog's Hebrew-script and symbol artist keys on Wikidata.

Step 1 of the alias run (README.md in this folder). An ``artist_aliases`` row
maps a spelling a host may type to one catalog artist key, a value of
``songs.artist_keys``. Two kinds of key need one:

- a Hebrew key: holds a character in U+0590-U+05FF;
- a symbol key: no Hebrew, and a character that is not a letter, a digit or
  a space (made-up examples: ``bl!nk``, ``ca$h``), so a host who types the
  plain letters misses it.

The keys are the snapshot's ``artist_keys`` values of playable songs
(``unavailable_at`` null), exactly as the database stores them. A key whose
every playable song is a soundtrack song is a film or show: its English
title is a translation, never an alias, so it is skipped (``film_or_show``).
With ``--existing`` (a dump of ``select alias, artist_key from
artist_aliases``) a key that already has a row is skipped too (``existing``).

For each other key: ``wbsearchentities`` (Hebrew for a Hebrew key, English
for a symbol key), then ``wbgetentities`` for the hits. An entity qualifies
when one of its labels or aliases in the search language equals the key
under ``norm()`` and it is a music act (a music word in its English or Hebrew
description, or P31 = Q215380 "musical group"). Every check reads the
``wbgetentities`` answer, never the search snippet. Two or more qualifying
entities with different English labels make the key ``ambiguous``. The
chosen entity's English label and aliases are the candidates, once cleaned
(``common.clean_alias``), when they hold a Latin letter, no Hebrew, and do
not norm to the key itself.

"English" includes Wikidata's ``mul`` language: since 2024 a name that is
the same in every Latin-script language is often stored once as a ``mul``
label, and Wikidata shows it as the English label.

Network: at least ``MIN_GAP_SECONDS`` between two requests, every answer
cached under ``<out>/_cache/wikidata/`` (one file per URL), so a rerun
resumes from the cache. On HTTP 429 or 5xx it honours ``Retry-After`` (or
waits ``RETRY_SECONDS``), at most ``TRIES`` tries, then records the key as
``error``.

Writes, in ``--out``: ``candidates.json`` (``artist_key``, ``alias``,
``source_url``: what the checking agent sees), ``no_candidate.json`` (the
research agent's input) and ``skipped.json``. stdout gets counts only; the
files hold real names, so ``--out`` is a git-ignored batch folder.

How to run, from the repository root (network: outside the sandbox)::

    PYTHONUTF8=1 <backend venv python> tools/song-curation/aliases/build_candidates.py [--catalog FILE] [--existing FILE] [--out DIR] [--limit N]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import common  # puts the backend first on sys.path, so it stays above the app imports

# isort: split
from app.services.setlist_catalog import SOUNDTRACK_GENRE_SLUGS
from app.services.setlist_text import norm

HERE = Path(__file__).resolve().parent
DEFAULT_CATALOG = HERE.parent / "batches" / "2026-11-25-aliases" / "_dumps" / "catalog_raw.json"

API = "https://www.wikidata.org/w/api.php"
ENTITY_PAGE = "https://www.wikidata.org/wiki/"
USER_AGENT = "artist-alias-builder/1.0 (offline research script)"
SEARCH_LIMIT = 7
ENTITY_LANGUAGES = "en|he|mul"
LATIN_LANGUAGES = ("en", "mul")  # "English" labels and aliases, in the order they are read
MIN_GAP_SECONDS = 1.0
TRIES = 3
RETRY_SECONDS = 30.0
MAX_RETRY_AFTER_SECONDS = 300.0
TIMEOUT_SECONDS = 60
PROGRESS_EVERY = 25  # keys between two progress lines on stderr

MUSICAL_GROUP = "Q215380"
QID = re.compile(r"Q[1-9][0-9]*")
# A music word as a whole word, plural allowed ("singer-songwriter" holds "singer").
MUSIC_EN = re.compile(
    r"\b(?:singer|musician|rapper|band|group|duo|composer|songwriter|dj|producer|vocalist|music)s?\b",
    re.IGNORECASE,
)
# Hebrew music words, inside a word too (a prefix letter, a feminine or plural ending).
MUSIC_HE = (
    "זמר", "זמרת", "להקה", "להקת", "צמד", "מוזיקאי", "ראפר", "מלחין", "יוצר", "הרכב", "תקליטן",
)  # fmt: skip

NO_CANDIDATE_REASONS = ("no_match", "ambiguous", "no_latin_alias", "error")
SKIP_REASONS = ("film_or_show", "existing")


# ----- keys ------------------------------------------------------------------------------


def has_hebrew(s: str) -> bool:
    return any(0x0590 <= ord(ch) <= 0x05FF for ch in s)


def is_symbol_key(s: str) -> bool:
    return not has_hebrew(s) and any(not (ch.isalnum() or ch.isspace()) for ch in s)


def has_latin(s: str) -> bool:
    return any(ch.isalpha() and unicodedata.name(ch, "").startswith("LATIN") for ch in s)


def playable_rows_by_key(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[Mapping[str, Any]]]:
    """Each DB ``artist_keys`` value of a playable song -> the playable rows that hold it."""
    by_key: dict[str, list[Mapping[str, Any]]] = {}
    for row in rows:
        if row.get("unavailable_at") is not None:
            continue
        keys = row.get("artist_keys") or []
        if not isinstance(keys, list):
            raise ValueError(f"song {row.get('id')}: artist_keys is not a JSON list")
        for key in dict.fromkeys(keys):
            by_key.setdefault(key, []).append(row)
    return by_key


def is_soundtrack(row: Mapping[str, Any]) -> bool:
    return any(slug in SOUNDTRACK_GENRE_SLUGS for slug in common._genre_slugs(row))


def existing_keys(path: Path) -> set[str]:
    """The artist keys (norm form) that already have an alias row, from a CLI dump."""
    return {norm(row["artist_key"]) for row in common.supabase_rows(path)}


# ----- Wikidata ----------------------------------------------------------------------------


class LookupFailed(Exception):
    """A request that failed for good (after its retries, or at once for a 4xx)."""


def retry_after(value: str | None) -> float:
    """Seconds to wait from a ``Retry-After`` header (seconds or an HTTP date)."""
    if not value:
        return RETRY_SECONDS
    try:
        seconds = float(value)
    except ValueError:
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except (TypeError, ValueError):
            return RETRY_SECONDS
    return min(max(seconds, MIN_GAP_SECONDS), MAX_RETRY_AFTER_SECONDS)


class Wikidata:
    """GET requests to the Wikidata API, each answer cached on disk by a hash of its URL."""

    def __init__(self, cache: Path) -> None:
        self.cache = cache
        self.network = 0  # requests sent, retries included
        self.from_cache = 0  # answers read from the cache
        self._last_end: float | None = None

    def get(self, url: str) -> dict[str, Any]:
        path = self.cache / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()}.json"
        if path.is_file():
            try:
                stored = common.read_json(path)
            except ValueError:  # a file cut short by a stopped run: fetch it again
                stored = None
            if isinstance(stored, dict) and stored.get("url") == url:
                self.from_cache += 1
                return dict(stored["answer"])
        answer = self._fetch(url)
        self.cache.mkdir(parents=True, exist_ok=True)
        part = path.with_suffix(".part")
        common.write_json(part, {"url": url, "answer": answer}, indent=None)
        part.replace(path)
        return answer

    def _pause(self) -> None:
        if self._last_end is not None:
            gap = time.monotonic() - self._last_end
            if gap < MIN_GAP_SECONDS:
                time.sleep(MIN_GAP_SECONDS - gap)

    def _fetch(self, url: str) -> dict[str, Any]:
        problem = ""
        for attempt in range(1, TRIES + 1):
            self._pause()
            self.network += 1
            wait = RETRY_SECONDS
            request = urllib.request.Request(  # noqa: S310 (a fixed https:// API address)
                url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
            )
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
                    body = response.read()
            except urllib.error.HTTPError as err:
                if err.code != 429 and err.code < 500:
                    raise LookupFailed(f"HTTP {err.code}") from err
                problem, wait = f"HTTP {err.code}", retry_after(err.headers.get("Retry-After"))
            except OSError as err:  # a timeout, a reset or a name lookup failure
                problem = type(err).__name__
            else:
                return parse_answer(body)
            finally:
                self._last_end = time.monotonic()
            if attempt < TRIES:
                time.sleep(wait)
        raise LookupFailed(f"{problem} after {TRIES} tries")


def parse_answer(body: bytes) -> dict[str, Any]:
    """The JSON object of an API answer; an ``error`` answer is a failure (and is not cached)."""
    try:
        answer = json.loads(body.decode("utf-8"))
    except ValueError as err:
        raise LookupFailed("the answer is not JSON") from err
    if not isinstance(answer, dict):
        raise LookupFailed("the answer is not a JSON object")
    if "error" in answer:
        code = answer["error"].get("code") if isinstance(answer["error"], dict) else None
        raise LookupFailed(f"API error {code}")
    return answer


def search_url(key: str, language: str) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "wbsearchentities",
            "search": key,
            "language": language,
            "uselang": language,
            "type": "item",
            "limit": SEARCH_LIMIT,
            "format": "json",
        }
    )
    return f"{API}?{query}"


def entities_url(qids: Sequence[str]) -> str:
    query = urllib.parse.urlencode(
        {
            "action": "wbgetentities",
            "ids": "|".join(qids),
            "props": "labels|aliases|descriptions|claims",
            "languages": ENTITY_LANGUAGES,
            "format": "json",
        },
        safe="|",
    )
    return f"{API}?{query}"


# ----- reading an entity ---------------------------------------------------------------------


def labels(entity: Mapping[str, Any], languages: Sequence[str]) -> list[str]:
    found = entity.get("labels") or {}
    return [v for lang in languages if (v := (found.get(lang) or {}).get("value"))]


def aliases(entity: Mapping[str, Any], languages: Sequence[str]) -> list[str]:
    found = entity.get("aliases") or {}
    return [v for lang in languages for a in found.get(lang) or [] if (v := a.get("value"))]


def names(entity: Mapping[str, Any], languages: Sequence[str]) -> list[str]:
    """Labels first, then aliases, in ``languages`` order."""
    return labels(entity, languages) + aliases(entity, languages)


def english_label(entity: Mapping[str, Any]) -> str:
    """The cleaned English label (``mul`` when there is no ``en`` one); "" when it has none."""
    found = labels(entity, LATIN_LANGUAGES)
    return common.clean_alias(found[0]) if found else ""


def is_music_act(entity: Mapping[str, Any]) -> bool:
    descriptions = entity.get("descriptions") or {}
    texts = [(descriptions.get(lang) or {}).get("value") or "" for lang in ("en", "he")]
    if any(MUSIC_EN.search(text) or any(w in text for w in MUSIC_HE) for text in texts):
        return True
    for claim in (entity.get("claims") or {}).get("P31") or []:
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, dict) and value.get("id") == MUSICAL_GROUP:
            return True
    return False


def resolve(entities: Mapping[str, Any], qid: str) -> Mapping[str, Any] | None:
    """The entity a search hit names, in the ``wbgetentities`` answer (a redirect followed)."""
    entity = entities.get(qid)
    if entity is None:
        entity = next(
            (e for e in entities.values() if (e.get("redirects") or {}).get("from") == qid), None
        )
    if not isinstance(entity, Mapping) or "missing" in entity:
        return None
    return entity if QID.fullmatch(str(entity.get("id", ""))) else None


@dataclass(frozen=True)
class Outcome:
    aliases: tuple[str, ...] = ()
    qid: str = ""
    reason: str = ""  # one of NO_CANDIDATE_REASONS when there are no aliases


def lookup(wikidata: Wikidata, key: str) -> Outcome:
    """The candidate aliases of one key, or the reason there are none."""
    hebrew = has_hebrew(key)
    search = wikidata.get(search_url(key, "he" if hebrew else "en"))
    hits = search.get("search") or []
    qids = list(dict.fromkeys(h["id"] for h in hits if QID.fullmatch(str(h.get("id", "")))))
    if not qids:
        return Outcome(reason="no_match")
    entities = wikidata.get(entities_url(qids)).get("entities") or {}
    target = norm(key)
    search_languages = ("he",) if hebrew else LATIN_LANGUAGES
    qualifying: dict[str, Mapping[str, Any]] = {}  # entity id -> entity, in search order
    for qid in qids:
        entity = resolve(entities, qid)
        if entity is None or not is_music_act(entity):
            continue
        if any(norm(name) == target for name in names(entity, search_languages)):
            qualifying.setdefault(str(entity["id"]), entity)
    if not qualifying:
        return Outcome(reason="no_match")
    if len({english_label(e) for e in qualifying.values()}) > 1:
        return Outcome(reason="ambiguous")
    qid, entity = next(iter(qualifying.items()))
    found: list[str] = []
    for name in names(entity, LATIN_LANGUAGES):
        alias = common.clean_alias(name)
        if has_latin(alias) and not has_hebrew(alias) and norm(alias) != target:
            found.append(alias)
    found = list(dict.fromkeys(found))
    return Outcome(tuple(found), qid) if found else Outcome(qid=qid, reason="no_latin_alias")


# ----- the run ---------------------------------------------------------------------------------


def by_reason(rows: Sequence[Mapping[str, str]], reasons: Sequence[str]) -> str:
    counts = Counter(row["reason"] for row in rows)
    return ", ".join(f"{reason} {counts[reason]}" for reason in reasons)


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--catalog", type=Path, default=DEFAULT_CATALOG, help="the catalog snapshot (CLI dump)"
    )
    parser.add_argument(
        "--existing", type=Path, help="a CLI dump of: select alias, artist_key from artist_aliases"
    )
    parser.add_argument("--out", type=Path, help="output folder (default: the snapshot's batch)")
    parser.add_argument("--limit", type=int, help="look at the first N keys only (a trial)")
    args = parser.parse_args(argv)
    if args.out is None:
        dumps = args.catalog.resolve().parent
        args.out = dumps.parent if dumps.name == "_dumps" else dumps
    if args.limit is not None and args.limit < 1:
        parser.error("--limit needs a number of 1 or more")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    by_key = playable_rows_by_key(common.supabase_rows(args.catalog))
    keys = sorted(k for k in by_key if has_hebrew(k) or is_symbol_key(k))
    if args.limit is not None:
        keys = keys[: args.limit]
    existing = existing_keys(args.existing) if args.existing else set()
    args.out.mkdir(parents=True, exist_ok=True)
    wikidata = Wikidata(args.out / "_cache" / "wikidata")

    candidates: list[dict[str, str]] = []
    no_candidate: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    with_candidate = 0
    for n, key in enumerate(keys, 1):
        if n % PROGRESS_EVERY == 0:
            print(f"  {n}/{len(keys)} keys, {wikidata.network} requests", file=sys.stderr)
        if all(is_soundtrack(row) for row in by_key[key]):
            skipped.append({"artist_key": key, "reason": "film_or_show"})
            continue
        if norm(key) in existing:
            skipped.append({"artist_key": key, "reason": "existing"})
            continue
        try:
            outcome = lookup(wikidata, key)
        except LookupFailed:
            outcome = Outcome(reason="error")
        if outcome.reason:
            no_candidate.append({"artist_key": key, "reason": outcome.reason})
            continue
        with_candidate += 1
        source = ENTITY_PAGE + outcome.qid
        candidates += [
            {"artist_key": key, "alias": a, "source_url": source} for a in outcome.aliases
        ]

    candidates.sort(key=lambda row: (row["artist_key"], row["alias"]))
    common.write_json(args.out / "candidates.json", candidates)
    common.write_json(args.out / "no_candidate.json", no_candidate)
    common.write_json(args.out / "skipped.json", skipped)

    hebrew = sum(has_hebrew(k) for k in keys)
    limited = f" (the first {args.limit} only)" if args.limit is not None else ""
    print(
        "\n".join(
            [
                f"keys considered: {len(keys)}{limited} ({hebrew} Hebrew, {len(keys) - hebrew} symbol)",
                f"skipped: {len(skipped)} ({by_reason(skipped, SKIP_REASONS)})",
                f"with a candidate: {with_candidate}",
                f"without one: {len(no_candidate)} ({by_reason(no_candidate, NO_CANDIDATE_REASONS)})",
                f"candidate rows: {len(candidates)}",
                f"requests: {wikidata.network} to the network, {wikidata.from_cache} from the cache",
                f"wrote candidates.json, no_candidate.json, skipped.json in {args.out}",
            ]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
