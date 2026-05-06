import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  awardPoints,
  bulkImportSongs,
  createGame,
  createSong,
  deleteSong,
  endGame,
  getHealth,
  getSong,
  joinTeam,
  kickTeam,
  listGenres,
  listSongs,
  selectSong,
  updateSong,
} from "./api";
import type { SongWritePayload } from "./types";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api - public routes", () => {
  it("getHealth GETs /health without auth headers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { status: "ok", version: "1.0", supabase: "ok" }),
    );
    const res = await getHealth();
    expect(res.status).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/health");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBeUndefined();
    expect(headers["X-Manager-Token"]).toBeUndefined();
  });

  it("listGenres GETs /genres", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ id: "g1", name: "Rock", slug: "rock" }]));
    const res = await listGenres();
    expect(res).toHaveLength(1);
  });

  it("joinTeam POSTs name to the right URL", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        id: "t1",
        game_code: "ABCDEF",
        name: "Alice",
        score: 0,
        joined_at: "2026-05-05T12:00:00Z",
      }),
    );
    const team = await joinTeam("ABCDEF", "Alice");
    expect(team.id).toBe("t1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/games/ABCDEF/teams");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Alice" });
  });

  it("createGame is unauthenticated and returns the manager token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        game_code: "ABCDEF",
        status: "waiting",
        total_rounds: 10,
        selected_genres: [],
        started_at: "2026-05-05T12:00:00Z",
        expires_at: "2026-05-05T16:00:00Z",
        manager_token: "11111111-1111-1111-1111-111111111111",
      }),
    );
    const res = await createGame({ total_rounds: 10, selected_genres: ["g1"] });
    expect(res.manager_token).toBe("11111111-1111-1111-1111-111111111111");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBeUndefined();
    expect(headers["X-Manager-Token"]).toBeUndefined();
  });
});

describe("api - manager-token routes", () => {
  const TOKEN = "22222222-2222-2222-2222-222222222222";

  it("selectSong sends X-Manager-Token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        round_id: "r1",
        round_number: 1,
        song: {
          id: "s1",
          title: "T",
          artist: "A",
          youtube_id: "abcdefghijk",
          start_time: 0,
          is_soundtrack: false,
          source: null,
        },
      }),
    );
    const res = await selectSong("ABCDEF", TOKEN);
    expect(res.round_id).toBe("r1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/games/ABCDEF/select-song");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Manager-Token"]).toBe(TOKEN);
  });

  it("awardPoints sends booleans + token", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        round_id: "r1",
        team_id: "t1",
        points_awarded: 15,
        team_total_score: 30,
      }),
    );
    const res = await awardPoints("ABCDEF", TOKEN, {
      round_id: "r1",
      title_correct: true,
      artist_correct: true,
      source_correct: false,
      timeout: false,
    });
    expect(res.points_awarded).toBe(15);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Manager-Token"]).toBe(TOKEN);
    expect(JSON.parse(init.body as string)).toMatchObject({
      title_correct: true,
      artist_correct: true,
      timeout: false,
    });
  });

  it("endGame returns parsed body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        game_code: "ABCDEF",
        status: "ended",
        ended_at: "2026-05-05T13:00:00Z",
      }),
    );
    const res = await endGame("ABCDEF", TOKEN);
    expect(res.status).toBe("ended");
  });

  it("kickTeam handles 204 No Content with token header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(kickTeam("ABCDEF", TOKEN, "t1")).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Manager-Token"]).toBe(TOKEN);
  });

  it("maps non-2xx body to ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: "unauthorized",
        message: "manager token required",
      }),
    );
    await expect(endGame("ABCDEF", TOKEN)).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });

  it("falls back when error body is missing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(endGame("ABCDEF", TOKEN)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("api - admin-songs routes", () => {
  const PW = "letmein";
  const SONG = {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Song",
    artist: "Artist",
    youtube_id: "abcdefghijk",
    start_time: 0,
    is_soundtrack: false,
    source: null,
  };
  const PAYLOAD: SongWritePayload = {
    title: "Song",
    artist: "Artist",
    youtube_id: "abcdefghijk",
    start_time: 0,
    is_soundtrack: false,
    source: null,
    genre_ids: ["g1"],
  };

  it("listSongs sends the password header and serializes query params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { items: [SONG], page: 2, per_page: 25, total: 1 }),
    );
    const res = await listSongs({ page: 2, per_page: 25, search: "foo", genre: "rock" }, PW);
    expect(res.total).toBe(1);
    expect(res.items[0]!.id).toBe(SONG.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/admin/songs?page=2&per_page=25&search=foo&genre=rock");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe(PW);
  });

  it("listSongs omits empty params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { items: [], page: 1, per_page: 50, total: 0 }),
    );
    await listSongs({}, PW);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/admin/songs");
  });

  it("getSong sends the password header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, SONG));
    const res = await getSong(SONG.id, PW);
    expect(res.title).toBe("Song");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:8000/admin/songs/${SONG.id}`);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe(PW);
  });

  it("createSong POSTs JSON with the password header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, SONG));
    await createSong(PAYLOAD, PW);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/admin/songs");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe(PW);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(PAYLOAD);
  });

  it("updateSong PUTs JSON with the password header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, SONG));
    await updateSong(SONG.id, PAYLOAD, PW);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:8000/admin/songs/${SONG.id}`);
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe(PW);
  });

  it("deleteSong handles 204 with the password header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteSong(SONG.id, PW)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:8000/admin/songs/${SONG.id}`);
    expect(init.method).toBe("DELETE");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe(PW);
  });

  it("bulkImportSongs posts FormData and does not set Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { inserted: 2, updated: 1, total: 3 }));
    const file = new File(["title,artist,youtube_id\n"], "songs.csv", { type: "text/csv" });
    const summary = await bulkImportSongs(file, PW);
    expect(summary).toEqual({ inserted: 2, updated: 1, total: 3 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/admin/songs/bulk-import");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe(PW);
    expect(headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("admin endpoints surface 401 as ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: "unauthorized", message: "admin authentication required" }),
    );
    await expect(listSongs({}, PW)).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });
});
