"""Songs from multiple selected genres must be interleaved, not played in batches.

User requirement: when a manager selects two or more genres, the round-by-round
sequence should mix them throughout the game — not play "all rock, then all
pop." The picker uses ``secrets.randbelow`` over the union of candidate songs,
so genre-blind uniform sampling is the implementation. This test guards against
a future refactor that re-introduces per-genre batching (e.g., grouping by
genre_id and walking groups round-robin or sequentially).

Statistical reasoning: with 50 rock + 50 pop songs, a uniform random shuffle
produces ~50 expected genre transitions. A perfectly batched sequence has
exactly 1. Any reasonable threshold > a handful catches batching with
overwhelming probability while staying robust against actual randomness.
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
        total_rounds=TOTAL,
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

    # 1) Both genres must appear in the first quarter — the game shouldn't open
    #    with a single-genre run. Probability of all-one-genre across 25 picks
    #    from 50/50 pool is C(50,25)/C(100,25) ≈ 5e-15, effectively zero.
    first_quarter = set(sequence[: TOTAL // 4])
    assert first_quarter == {"rock", "pop"}, (
        f"first 25 picks were single-genre: {sequence[: TOTAL // 4]}"
    )

    # 2) Both genres must appear in the LAST quarter — guards against the
    #    inverse failure (last block monogenre).
    last_quarter = set(sequence[-(TOTAL // 4) :])
    assert last_quarter == {"rock", "pop"}, (
        f"last 25 picks were single-genre: {sequence[-(TOTAL // 4) :]}"
    )

    # 3) Genre transitions must exceed a low bound. A monotone batched sequence
    #    has exactly 1 transition; the expected value for a uniform random
    #    shuffle of 50/50 is ~50. The bound here is loose enough that random
    #    sampling never trips it but any per-genre batching does.
    # zip without strict — the two iterables differ in length by 1 by design.
    transitions = sum(1 for a, b in zip(sequence[:-1], sequence[1:], strict=True) if a != b)
    assert transitions >= 15, (
        f"only {transitions} genre transitions across {TOTAL} picks — "
        "looks like the picker is batching by genre"
    )
