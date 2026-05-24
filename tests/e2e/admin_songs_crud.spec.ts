// Admin song catalog CRUD against the /admin/songs REST endpoints.
//
// This spec is API-driven (no /admin/songs UI exists yet; that page is
// a deferred Phase 5 carve-out). The contract under test is:
//   POST   /admin/songs              -> 201 SongPayload
//   GET    /admin/songs/{id}         -> 200 SongPayload | 404
//   PUT    /admin/songs/{id}         -> 200 SongPayload (full replace)
//   DELETE /admin/songs/{id}         -> 204
//   GET    /admin/songs?search=...   -> 200 SongList
//   POST   /admin/songs/bulk-import  -> 200 BulkImportSummary (idempotent on youtube_id)
//
// Spec ref: docs/testing-strategy.md §4.4 (admin_songs_crud row notes
// "via admin API"); contract in docs/api-contracts.md §3.

import { test, expect } from "@playwright/test";
import {
  bulkImportSongs,
  createSong,
  deleteSong,
  getSong,
  getSongStatus,
  listGenres,
  listSongs,
  updateSong,
} from "./fixtures/admin-api";

// All test rows use this prefix so the cleanup pass at the end can find
// and prune anything that survived a mid-test failure.
const TAG = "E2ETEMPCRUD";

// 11-char strings matching ^[A-Za-z0-9_-]{11}$; required by the
// SongCreate.youtube_id validator. E2ETEMP prefix mirrors the existing
// E2ETEST seed prefix in db/seed/songs.sql so the rows are easy to spot.
const Y1 = "E2ETEMPaa01";
const Y2 = "E2ETEMPbb02";
const Y3 = "E2ETEMPcc03";

test("admin songs: full CRUD round-trip + bulk-import idempotency", async () => {
  const genres = await listGenres();
  expect(genres.length).toBeGreaterThan(0);
  const first = genres[0]!;
  const second = genres[1] ?? first;

  // Track ids for cleanup; populated as we go.
  const created: string[] = [];

  try {
    // -- CREATE -----------------------------------------------------------
    const made = await createSong({
      title: `${TAG}-create`,
      artist: "tmp",
      youtube_id: Y1,
      start_time: 0,
      source: "manual",
      genre_ids: [first.id],
    });
    expect(made.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(made.title).toBe(`${TAG}-create`);
    created.push(made.id);

    // -- READ -------------------------------------------------------------
    const fetched = await getSong(made.id);
    expect(fetched).toMatchObject({
      id: made.id,
      title: `${TAG}-create`,
      artist: "tmp",
      youtube_id: Y1,
      start_time: 0,
    });

    // -- UPDATE (full replace) --------------------------------------------
    const updated = await updateSong(made.id, {
      title: `${TAG}-updated`,
      artist: "tmp2",
      youtube_id: Y1,
      start_time: 5,
      source: "manual",
      genre_ids: [second.id],
    });
    expect(updated.title).toBe(`${TAG}-updated`);
    expect(updated.source).toBe("manual");
    expect(updated.start_time).toBe(5);

    // -- LIST with search filter -----------------------------------------
    const listed = await listSongs({ search: `${TAG}-updated` });
    expect(listed.items.length).toBe(1);
    expect(listed.items[0]!.id).toBe(made.id);

    // -- BULK IMPORT (1 update of existing yt_id + 2 fresh inserts) ------
    const csv = [
      "title,artist,youtube_id,start_time,source,genres",
      `${TAG}-updated-via-bulk,tmp3,${Y1},0,manual,${first.slug}`,
      `${TAG}-bulk-1,tmp,${Y2},0,manual,${first.slug}`,
      `${TAG}-bulk-2,tmp,${Y3},0,manual,${first.slug}`,
    ].join("\n");
    const summary = await bulkImportSongs(csv);
    expect(summary).toEqual({ inserted: 2, updated: 1, total: 3 });

    // The original row should now reflect the bulk update.
    const afterBulk = await getSong(made.id);
    expect(afterBulk.title).toBe(`${TAG}-updated-via-bulk`);

    // The two bulk inserts should be discoverable; capture their ids for
    // cleanup. Search-by-title is case-insensitive ILIKE, so the prefix
    // match returns both rows.
    const bulkListed = await listSongs({ search: `${TAG}-bulk-` });
    expect(bulkListed.items.length).toBe(2);
    for (const item of bulkListed.items) created.push(item.id);

    // -- DELETE -----------------------------------------------------------
    for (const id of created) {
      await deleteSong(id);
    }
    created.length = 0;

    // -- 404 after delete -------------------------------------------------
    const status = await getSongStatus(made.id);
    expect(status).toBe(404);

    // -- final state: nothing tagged remains ------------------------------
    const final = await listSongs({ search: TAG });
    expect(final.items.length).toBe(0);
  } finally {
    // Best-effort cleanup if an earlier assertion threw.
    for (const id of created) {
      try {
        await deleteSong(id);
      } catch {
        /* already gone or fail-by-design */
      }
    }
  }
});
