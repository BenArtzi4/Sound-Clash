import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    details: unknown;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
      this.details = undefined;
    }
  },
  listGenres: vi.fn(),
  listSongs: vi.fn(),
  createSong: vi.fn(),
  updateSong: vi.fn(),
  deleteSong: vi.fn(),
  bulkImportSongs: vi.fn(),
}));

import {
  ApiError,
  bulkImportSongs,
  createSong,
  deleteSong,
  listGenres,
  listSongs,
  updateSong,
} from "../lib/api";
import { ToastProvider } from "../context/ToastContext";
import { clearAdminPassword, getAdminPassword } from "../lib/adminPassword";
import type { Song } from "../lib/types";
import { AdminSongsPage } from "./AdminSongsPage";

const GENRES = [
  { id: "g1", name: "Rock", slug: "rock" },
  { id: "g2", name: "Pop", slug: "pop" },
  { id: "g3", name: "Soundtrack", slug: "soundtrack" },
];

const SONG_A: Song = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Alpha",
  artist: "Artist A",
  youtube_id: "aaaaaaaaaaa",
  start_time: 0,
  source: null,
  genres: [{ id: "g1", name: "Rock", slug: "rock" }],
};

const SONG_B: Song = {
  id: "22222222-2222-2222-2222-222222222222",
  title: "Bravo",
  artist: "Artist B",
  youtube_id: "bbbbbbbbbbb",
  start_time: 12,
  source: "Some film",
  genres: [
    { id: "g2", name: "Pop", slug: "pop" },
    { id: "g3", name: "Soundtrack", slug: "soundtrack" },
  ],
};

beforeEach(() => {
  clearAdminPassword();
  vi.mocked(listGenres).mockReset();
  vi.mocked(listSongs).mockReset();
  vi.mocked(createSong).mockReset();
  vi.mocked(updateSong).mockReset();
  vi.mocked(deleteSong).mockReset();
  vi.mocked(bulkImportSongs).mockReset();
  vi.mocked(listGenres).mockResolvedValue(GENRES);
  vi.mocked(listSongs).mockResolvedValue({
    items: [SONG_A, SONG_B],
    page: 1,
    per_page: 50,
    total: 2,
  });
});

afterEach(() => {
  clearAdminPassword();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AdminSongsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function signIn() {
  fireEvent.change(screen.getByLabelText(/admin password/i), { target: { value: "letmein" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await waitFor(() => expect(screen.getByText(/song catalog/i)).toBeInTheDocument());
  await waitFor(() => screen.getByText("Alpha"));
}

describe("AdminSongsPage: gate", () => {
  it("renders the password gate when no password is set", () => {
    renderPage();
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
  });

  it("submitting the gate stores the password and loads the console", async () => {
    renderPage();
    await signIn();
    expect(getAdminPassword()).toBe("letmein");
    expect(listSongs).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, per_page: 50 }),
      "letmein",
    );
  });

  it("a 401 from listSongs returns the user to the gate", async () => {
    vi.mocked(listSongs).mockRejectedValueOnce(
      new ApiError("unauthorized", "admin authentication required", 401),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText(/admin password/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/admin password rejected/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
    expect(getAdminPassword()).toBeNull();
  });

  it("Sign out clears the password and returns to the gate", async () => {
    renderPage();
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
    expect(getAdminPassword()).toBeNull();
  });
});

describe("AdminSongsPage: list", () => {
  it("renders songs returned by listSongs", async () => {
    renderPage();
    await signIn();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("aaaaaaaaaaa")).toBeInTheDocument();
  });

  it("renders start_time and the song's explicit genre tags", async () => {
    renderPage();
    await signIn();
    // Alpha: start_time=0 renders as em-dash; one genre tag (Rock).
    const alphaRow = screen.getByText("Alpha").closest("tr") as HTMLElement;
    expect(within(alphaRow).getByText("—")).toBeInTheDocument();
    expect(within(alphaRow).getByText("Rock")).toBeInTheDocument();
    expect(within(alphaRow).queryByText("Soundtrack")).not.toBeInTheDocument();
    // Bravo: start_time=12 renders as "12s"; the row reflects only the
    // genre tags actually stored on the song (Pop + Soundtrack).
    const bravoRow = screen.getByText("Bravo").closest("tr") as HTMLElement;
    expect(within(bravoRow).getByText("12s")).toBeInTheDocument();
    expect(within(bravoRow).getByText("Pop")).toBeInTheDocument();
    expect(within(bravoRow).getByText("Soundtrack")).toBeInTheDocument();
  });

  it("shows the empty state when there are no songs", async () => {
    vi.mocked(listSongs).mockResolvedValue({ items: [], page: 1, per_page: 50, total: 0 });
    renderPage();
    fireEvent.change(screen.getByLabelText(/admin password/i), { target: { value: "letmein" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/no songs found/i)).toBeInTheDocument());
  });

  it("debounced search triggers listSongs with the search term", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      // Sign in synchronously (fake timers, but shouldAdvanceTime keeps RTL working).
      fireEvent.change(screen.getByLabelText(/admin password/i), { target: { value: "letmein" } });
      fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
      await waitFor(() => screen.getByText("Alpha"));
      vi.mocked(listSongs).mockClear();

      fireEvent.change(screen.getByLabelText(/search songs/i), {
        target: { value: "alp" },
      });
      // Debounce is 250ms.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      await waitFor(() => {
        expect(listSongs).toHaveBeenCalledWith(
          expect.objectContaining({ search: "alp", page: 1 }),
          "letmein",
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("changing the genre filter refetches with that slug", async () => {
    renderPage();
    await signIn();
    vi.mocked(listSongs).mockClear();
    fireEvent.change(screen.getByLabelText(/filter by genre/i), { target: { value: "rock" } });
    await waitFor(() => {
      expect(listSongs).toHaveBeenCalledWith(
        expect.objectContaining({ genre: "rock", page: 1 }),
        "letmein",
      );
    });
  });

  it("paginates when total exceeds one page", async () => {
    vi.mocked(listSongs).mockResolvedValue({
      items: [SONG_A],
      page: 1,
      per_page: 50,
      total: 75,
    });
    renderPage();
    await signIn();
    expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    vi.mocked(listSongs).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => {
      expect(listSongs).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }), "letmein");
    });
  });
});

describe("AdminSongsPage: create + edit + delete", () => {
  it("creates a song with the form values", async () => {
    vi.mocked(createSong).mockResolvedValue(SONG_A);
    renderPage();
    await signIn();

    fireEvent.click(screen.getByRole("button", { name: /\+ new song/i }));
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "Made up" } });
    fireEvent.change(screen.getByLabelText(/^artist$/i), { target: { value: "Some artist" } });
    fireEvent.change(screen.getByLabelText(/^youtube id$/i), {
      target: { value: "abcdefghijk" },
    });
    fireEvent.click(screen.getByLabelText(/^rock$/i));

    fireEvent.click(screen.getByRole("button", { name: /create song/i }));

    await waitFor(() => expect(createSong).toHaveBeenCalled());
    expect(createSong).toHaveBeenCalledWith(
      {
        title: "Made up",
        artist: "Some artist",
        youtube_id: "abcdefghijk",
        start_time: 0,
        source: null,
        genre_ids: ["g1"],
      },
      "letmein",
    );
    await waitFor(() => expect(screen.getByText(/song created/i)).toBeInTheDocument());
  });

  it("auto-tags the Soundtrack genre when source is set on save", async () => {
    vi.mocked(createSong).mockResolvedValue(SONG_A);
    renderPage();
    await signIn();

    fireEvent.click(screen.getByRole("button", { name: /\+ new song/i }));
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "Imperial March" } });
    fireEvent.change(screen.getByLabelText(/^artist$/i), { target: { value: "Star Wars" } });
    fireEvent.change(screen.getByLabelText(/^youtube id$/i), {
      target: { value: "abcdefghijk" },
    });
    fireEvent.change(screen.getByLabelText(/^source$/i), { target: { value: "Star Wars" } });
    fireEvent.click(screen.getByLabelText(/^rock$/i));

    fireEvent.click(screen.getByRole("button", { name: /create song/i }));

    await waitFor(() => expect(createSong).toHaveBeenCalled());
    const [payload] = vi.mocked(createSong).mock.calls[0]!;
    expect(payload.source).toBe("Star Wars");
    expect([...payload.genre_ids].sort()).toEqual(["g1", "g3"]);
  });

  it("disables submit while the form is invalid", async () => {
    renderPage();
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /\+ new song/i }));
    const submit = screen.getByRole("button", { name: /create song/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText(/^artist$/i), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText(/^youtube id$/i), {
      target: { value: "tooshort" },
    });
    fireEvent.click(screen.getByLabelText(/^rock$/i));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^youtube id$/i), {
      target: { value: "abcdefghijk" },
    });
    expect(submit).toBeEnabled();
  });

  it("edits an existing song and PUTs full payload", async () => {
    vi.mocked(updateSong).mockResolvedValue(SONG_A);
    renderPage();
    await signIn();

    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    fireEvent.click(editButtons[0]!);

    expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "Alpha v2" } });
    // Rock is already pre-checked (from SONG_A.genres); clicking Pop adds it.
    fireEvent.click(screen.getByLabelText(/^pop$/i));

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateSong).toHaveBeenCalled());
    const [id, payload, pw] = vi.mocked(updateSong).mock.calls[0]!;
    expect(id).toBe(SONG_A.id);
    expect(payload.title).toBe("Alpha v2");
    expect(payload.youtube_id).toBe(SONG_A.youtube_id);
    expect([...payload.genre_ids].sort()).toEqual(["g1", "g2"]);
    expect(pw).toBe("letmein");
  });

  it("deletes after confirm", async () => {
    vi.mocked(deleteSong).mockResolvedValue();
    renderPage();
    await signIn();

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(deleteButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteSong).toHaveBeenCalledWith(SONG_A.id, "letmein"));
    await waitFor(() => expect(screen.getByText(/song deleted/i)).toBeInTheDocument());
  });

  it("cancel on the form returns to the list without calling the API", async () => {
    renderPage();
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /\+ new song/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("button", { name: /create song/i })).not.toBeInTheDocument();
    expect(createSong).not.toHaveBeenCalled();
  });
});

describe("AdminSongsPage: bulk import", () => {
  it("uploads a CSV file and toasts the summary", async () => {
    vi.mocked(bulkImportSongs).mockResolvedValue({ inserted: 2, updated: 1, total: 3 });
    renderPage();
    await signIn();
    const file = new File(["title,artist,youtube_id\n"], "songs.csv", { type: "text/csv" });
    const input = screen.getByLabelText(/bulk import csv/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(bulkImportSongs).toHaveBeenCalled());
    const [uploadedFile, pw] = vi.mocked(bulkImportSongs).mock.calls[0]!;
    expect(uploadedFile.name).toBe("songs.csv");
    expect(pw).toBe("letmein");
    await waitFor(() =>
      expect(screen.getByText(/imported 2 new \+ 1 updated \(3 total\)/i)).toBeInTheDocument(),
    );
  });

  it("surfaces a non-401 import error via toast", async () => {
    vi.mocked(bulkImportSongs).mockRejectedValue(new Error("malformed CSV"));
    renderPage();
    await signIn();
    const file = new File(["bad"], "songs.csv", { type: "text/csv" });
    const input = screen.getByLabelText(/bulk import csv/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/malformed csv/i)).toBeInTheDocument());
  });
});
