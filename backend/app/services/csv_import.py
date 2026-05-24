"""Parse and apply the bulk-song-import CSV.

Reject the entire upload on the first invalid row (per the user's Phase-4
decision and ``docs/testing-strategy.md §4.2``: "malformed CSV rejected
with row numbers"). A row's line number is 1-based, counting the header.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from typing import IO

import anyio

from app.db.errors import ValidationError
from app.db.supabase_client import SupabaseClientLike

REQUIRED_COLUMNS = (
    "title",
    "artist",
    "youtube_id",
    "start_time",
    "is_soundtrack",
    "genres",
)

_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_TRUE_VALUES = frozenset({"true", "1", "yes", "y", "t"})
_FALSE_VALUES = frozenset({"false", "0", "no", "n", "f", ""})


@dataclass(frozen=True)
class SongImportRow:
    line: int
    title: str
    artist: str
    youtube_id: str
    start_time: int
    is_soundtrack: bool
    genre_slugs: list[str]


@dataclass(frozen=True)
class ImportSummary:
    inserted: int
    updated: int
    total: int


def _parse_int(value: str, *, line: int, field: str) -> int:
    stripped = value.strip()
    if not stripped:
        return 0
    try:
        return int(stripped)
    except ValueError as exc:
        raise ValidationError(
            f"row {line}: {field} must be an integer",
            details={"line": line, "field": field, "issue": "not_an_integer"},
        ) from exc


def _parse_bool(value: str, *, line: int, field: str) -> bool:
    stripped = value.strip().lower()
    if stripped in _TRUE_VALUES:
        return True
    if stripped in _FALSE_VALUES:
        return False
    raise ValidationError(
        f"row {line}: {field} must be true/false",
        details={"line": line, "field": field, "issue": "not_a_boolean"},
    )


def parse_csv(stream: IO[bytes] | bytes) -> list[SongImportRow]:
    if isinstance(stream, (bytes, bytearray)):
        text = stream.decode("utf-8-sig")
    else:
        raw = stream.read()
        text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValidationError(
            "csv has no header row",
            details={"line": 1, "issue": "missing_header"},
        )

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ValidationError(
            f"missing required column(s): {', '.join(missing)}",
            details={"line": 1, "issue": "missing_columns", "missing": missing},
        )

    rows: list[SongImportRow] = []
    for index, raw_row in enumerate(reader, start=2):
        title = (raw_row.get("title") or "").strip()
        artist = (raw_row.get("artist") or "").strip()
        youtube_id = (raw_row.get("youtube_id") or "").strip()
        is_soundtrack = _parse_bool(
            raw_row.get("is_soundtrack") or "", line=index, field="is_soundtrack"
        )
        if not title:
            raise ValidationError(
                f"row {index}: title is required",
                details={"line": index, "field": "title", "issue": "empty"},
            )
        if is_soundtrack:
            # Soundtrack rule: title holds the show name; artist mirrors it.
            # Blank artist is auto-filled; non-blank artist must match title
            # so a typo doesn't slip in and split the soundtrack invariant.
            if not artist:
                artist = title
            elif artist != title:
                raise ValidationError(
                    f"row {index}: for soundtracks, artist must be blank or equal to title",
                    details={
                        "line": index,
                        "field": "artist",
                        "issue": "soundtrack_artist_mismatch",
                    },
                )
        elif not artist:
            raise ValidationError(
                f"row {index}: artist is required",
                details={"line": index, "field": "artist", "issue": "empty"},
            )
        if not _YOUTUBE_ID.match(youtube_id):
            raise ValidationError(
                f"row {index}: youtube_id must match ^[A-Za-z0-9_-]{{11}}$",
                details={
                    "line": index,
                    "field": "youtube_id",
                    "issue": "invalid_format",
                },
            )

        start_time = _parse_int(raw_row.get("start_time") or "0", line=index, field="start_time")
        if start_time < 0:
            raise ValidationError(
                f"row {index}: start_time must be non-negative",
                details={"line": index, "field": "start_time", "issue": "negative"},
            )

        genres_raw = (raw_row.get("genres") or "").strip()
        genre_slugs = [s.strip() for s in genres_raw.split(";") if s.strip()]
        if not genre_slugs:
            raise ValidationError(
                f"row {index}: genres must list at least one slug",
                details={"line": index, "field": "genres", "issue": "empty"},
            )

        rows.append(
            SongImportRow(
                line=index,
                title=title,
                artist=artist,
                youtube_id=youtube_id,
                start_time=start_time,
                is_soundtrack=is_soundtrack,
                genre_slugs=genre_slugs,
            )
        )

    if not rows:
        raise ValidationError(
            "csv contains no data rows",
            details={"line": 2, "issue": "empty_body"},
        )
    return rows


def _apply_blocking(client: SupabaseClientLike, rows: list[SongImportRow]) -> ImportSummary:
    all_slugs: set[str] = set()
    for row in rows:
        all_slugs.update(row.genre_slugs)

    genre_lookup_resp = (
        client.table("genres").select("id,slug").in_("slug", list(all_slugs)).execute()
    )
    slug_to_id: dict[str, str] = {g["slug"]: g["id"] for g in (genre_lookup_resp.data or [])}
    missing_slugs = sorted(all_slugs - slug_to_id.keys())
    if missing_slugs:
        raise ValidationError(
            f"unknown genre slug(s): {', '.join(missing_slugs)}",
            details={
                "line": next(
                    r.line for r in rows if any(s in missing_slugs for s in r.genre_slugs)
                ),
                "field": "genres",
                "issue": "unknown_slug",
                "missing": missing_slugs,
            },
        )

    yt_ids = [row.youtube_id for row in rows]
    existing_resp = (
        client.table("songs").select("id,youtube_id").in_("youtube_id", yt_ids).execute()
    )
    existing: dict[str, str] = {row["youtube_id"]: row["id"] for row in (existing_resp.data or [])}

    inserted = 0
    updated = 0
    for row in rows:
        payload = {
            "title": row.title,
            "artist": row.artist,
            "youtube_id": row.youtube_id,
            "start_time": row.start_time,
            "is_soundtrack": row.is_soundtrack,
        }
        if row.youtube_id in existing:
            song_id = existing[row.youtube_id]
            client.table("songs").update(payload).eq("id", song_id).execute()
            updated += 1
        else:
            insert_resp = client.table("songs").insert(payload).execute()
            data_rows = insert_resp.data or []
            song_id = data_rows[0]["id"] if data_rows else ""
            if not song_id:
                raise ValidationError(
                    f"row {row.line}: insert returned no id",
                    details={"line": row.line, "issue": "insert_failed"},
                )
            inserted += 1

        client.table("song_genres").delete().eq("song_id", song_id).execute()
        joins = [{"song_id": song_id, "genre_id": slug_to_id[slug]} for slug in row.genre_slugs]
        if joins:
            client.table("song_genres").insert(joins).execute()

    return ImportSummary(inserted=inserted, updated=updated, total=len(rows))


async def apply_import(client: SupabaseClientLike, rows: list[SongImportRow]) -> ImportSummary:
    return await anyio.to_thread.run_sync(_apply_blocking, client, rows)
