"""Songs from multiple selected genres must be interleaved, not played in batches.

User requirement: when a manager selects two or more genres, the round-by-round
sequence should mix them throughout the game; not play "all rock, then all
pop." The picker (``app.services.song_picker``) draws a random *eligible* genre
first and then a random unplayed song within it — equal genre weighting, so a
large genre can't drown out a small one and the sequence interleaves. This test
guards against a future refactor that re-introduces per-genre batching (e.g.,
grouping by genre_id and walking groups round-robin or sequentially).

Statistical reasoning: with 50 rock + 50 pop songs and a 50/50 genre draw, the
sequence behaves like a uniform random shuffle (~50 expected genre transitions).
A perfectly batched sequence has exactly 1. Any reasonable threshold > a handful
catches batching with overwhelming probability while staying robust against
actual randomness.
"""

from __future__ import annotations

import pytest

from ._helpers import (
    fetch_genre_ids,
    insert_game,
    insert_song,
    manager_headers,
)

pytestmark = pytest.mark.needs_docker

SONGS_PER_GENRE = 50
TOTAL = SONGS_PER_GENRE * 2


async def test_two_genres_are_interleaved_across_picks(client, db) -> None:
    rock_id, pop_id = await fetch_genre_ids(db, slugs=["pop", "rock"])
    rock_song_ids: set[str] = set()
    pop_song_ids: set[str] = set()
    for i in range(SONGS_PER_GENRE):
        rock_song_ids.add(str(await insert_song(db, genre_slugs=["rock"], title=f"rock-{i}")))
        pop_song_ids.add(str(await insert_song(db, genre_slugs=["pop"], title=f"pop-{i}")))

    code, token = await insert_game(
        db,
        status="playing",
        selected_genres=[rock_id, pop_id],
    )
    headers = manager_headers(token)

    # Pick every available song. Each call increments round_number; after TOTAL
    # picks, the pool is exhausted and the next call returns 409.
    sequence: list[str] = []
    for _ in range(TOTAL):
        resp = await client.post(f"/games/{code}/select-song", json={}, headers=headers)
        assert resp.status_code == 200, resp.text
        song_id = resp.json()["song"]["id"]
        if song_id in rock_song_ids:
            sequence.append("rock")
        elif song_id in pop_song_ids:
            sequence.append("pop")
        else:  # pragma: no cover - sanity guard
            raise AssertionError(f"unknown song_id {song_id}")

    # Sanity: we played exactly the catalog size, and every song appeared once.
    assert len(sequence) == TOTAL
    assert sequence.count("rock") == SONGS_PER_GENRE
    assert sequence.count("pop") == SONGS_PER_GENRE

    # 1) Both genres must appear in the first quarter: the game shouldn't open
    #    with a single-genre run. With a 50/50 genre draw the first 25 picks
    #    are 25 fair coin flips, so P(monogenre) = 2 * 2^-25 ≈ 6e-8.
    first_quarter = set(sequence[: TOTAL // 4])
    assert first_quarter == {"rock", "pop"}, (
        f"first 25 picks were single-genre: {sequence[: TOTAL // 4]}"
    )

    # 2) Both genres must appear in the LAST HALF: guards against the inverse
    #    failure (a long tail block). A genuine monogenre tail only happens
    #    once one bucket is exhausted; with 50 songs each that can't happen
    #    before pick 51 unless the first 50 picks were all one genre
    #    (P ≈ 2^-49). We use the half rather than the quarter because, unlike a
    #    uniform shuffle of the whole catalog, an equal-genre draw legitimately
    #    leaves a short monogenre tail (~10-20 picks) when one genre runs out.
    last_half = set(sequence[TOTAL // 2 :])
    assert last_half == {"rock", "pop"}, (
        f"last {TOTAL - TOTAL // 2} picks were single-genre: {sequence[TOTAL // 2 :]}"
    )

    # 3) Genre transitions must exceed a low bound. A monotone batched sequence
    #    has exactly 1 transition; an equal-genre draw averages ~50 (one per
    #    fair coin flip). The bound here is loose enough that random sampling
    #    never trips it but any per-genre batching does.
    transitions = sum(1 for a, b in zip(sequence[:-1], sequence[1:], strict=True) if a != b)
    assert transitions >= 15, (
        f"only {transitions} genre transitions across {TOTAL} picks; "
        "looks like the picker is batching by genre"
    )
