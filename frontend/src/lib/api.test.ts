import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  awardPoints,
  createGame,
  endGame,
  getHealth,
  joinTeam,
  kickTeam,
  listGenres,
  selectSong,
} from "./api";
import { setAdminPassword } from "../context/authStorage";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  setAdminPassword(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAdminPassword(null);
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api - public routes", () => {
  it("getHealth GETs /health without admin header", async () => {
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
});

describe("api - admin routes", () => {
  it("throws ApiError when admin password is unset before fetching", async () => {
    await expect(createGame({ total_rounds: 5, selected_genres: [] })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createGame sends X-Admin-Password header", async () => {
    setAdminPassword("secret");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        game_code: "ABCDEF",
        status: "waiting",
        total_rounds: 10,
        selected_genres: [],
        started_at: "2026-05-05T12:00:00Z",
        expires_at: "2026-05-05T16:00:00Z",
      }),
    );
    await createGame({ total_rounds: 10, selected_genres: ["g1"] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Admin-Password"]).toBe("secret");
  });

  it("selectSong posts empty body to right URL", async () => {
    setAdminPassword("secret");
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
    const res = await selectSong("ABCDEF");
    expect(res.round_id).toBe("r1");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/games/ABCDEF/select-song");
  });

  it("awardPoints sends booleans", async () => {
    setAdminPassword("secret");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        round_id: "r1",
        team_id: "t1",
        points_awarded: 15,
        team_total_score: 30,
      }),
    );
    const res = await awardPoints("ABCDEF", {
      round_id: "r1",
      title_correct: true,
      artist_correct: true,
      source_correct: false,
      timeout: false,
    });
    expect(res.points_awarded).toBe(15);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      title_correct: true,
      artist_correct: true,
      timeout: false,
    });
  });

  it("endGame returns parsed body", async () => {
    setAdminPassword("secret");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        game_code: "ABCDEF",
        status: "ended",
        ended_at: "2026-05-05T13:00:00Z",
      }),
    );
    const res = await endGame("ABCDEF");
    expect(res.status).toBe("ended");
  });

  it("kickTeam handles 204 No Content", async () => {
    setAdminPassword("secret");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(kickTeam("ABCDEF", "t1")).resolves.toBeUndefined();
  });

  it("maps non-2xx body to ApiError", async () => {
    setAdminPassword("wrong");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        error: "unauthorized",
        message: "admin authentication required",
      }),
    );
    await expect(createGame({ total_rounds: 5, selected_genres: ["g1"] })).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });

  it("falls back when error body is missing", async () => {
    setAdminPassword("x");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(endGame("ABCDEF")).rejects.toBeInstanceOf(ApiError);
  });
});
