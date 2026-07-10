import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useToast } from "../context/useToast";
import {
  ApiError,
  bulkImportSongs,
  createSong,
  deleteSong,
  listGenres,
  listSongs,
  updateSong,
} from "../lib/api";
import type { Genre, Song, SongWritePayload } from "../lib/types";

// Extracted from AdminSongsPage's SongsConsole during the T7.2 decomposition.
// Owns the catalog data + filter/pagination state, the load/refetch effects,
// and the create/edit/delete/import handlers. Behaviour is a pure move from the
// component, plus one bug fix: the page index is now clamped into range so a
// delete or filter that shrinks the result set can't strand the operator on a
// page past the last one (see the clamp effect below).

const PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 250;

export type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; song: Song };

export interface AdminSongs {
  songs: Song[];
  total: number;
  totalPages: number;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  searchInput: string;
  setSearchInput: (value: string) => void;
  genreFilter: string;
  setGenreFilter: (value: string) => void;
  genres: Genre[];
  mode: Mode;
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  deleteId: string | null;
  setDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
  loading: boolean;
  busy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  startEdit: (song: Song) => void;
  handleSubmitForm: (payload: SongWritePayload) => Promise<void>;
  handleConfirmDelete: () => Promise<void>;
  handleFile: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
}

interface UseAdminSongsOptions {
  pw: string;
  onAuthFail: () => void;
}

export function useAdminSongs({ pw, onAuthFail }: UseAdminSongsOptions): AdminSongs {
  const { toast } = useToast();
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilterState] = useState("");
  const [genres, setGenres] = useState<Genre[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const deleteInFlightRef = useRef(false);

  const reportError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) {
        onAuthFail();
        return;
      }
      toast(err instanceof Error ? err.message : fallback, { variant: "error" });
    },
    [onAuthFail, toast],
  );

  // Load genres once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listGenres();
        if (!cancelled) setGenres(list);
      } catch (err) {
        if (!cancelled) reportError(err, "Failed to load genres");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  // Debounce search input → search.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Refetch when filter inputs change.
  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSongs(
        {
          page,
          per_page: PER_PAGE,
          search: search || undefined,
          genre: genreFilter || undefined,
        },
        pw,
      );
      setSongs(res.items);
      setTotal(res.total);
    } catch (err) {
      reportError(err, "Failed to load songs");
    } finally {
      setLoading(false);
    }
  }, [genreFilter, page, pw, reportError, search]);

  useEffect(() => {
    void fetchSongs();
  }, [fetchSongs]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Clamp the page index into range. A delete or a filter that shrinks the
  // result set can leave `page` pointing past the last page (e.g. deleting the
  // only row on page 3 of 3 → totalPages drops to 2 but page stays 3), which
  // strands the operator on an empty "Page 3 of 2". Snapping back to the last
  // real page triggers a refetch on a page that actually has rows. Guard on
  // total > 0 so an empty result (totalPages floored at 1) doesn't fight a
  // pending page-1 reset.
  useEffect(() => {
    if (total > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, total, totalPages]);

  // Changing the genre filter resets to page 1 (same as the debounced search),
  // so the operator never lands on a page index that the new filter's smaller
  // result set doesn't have.
  const setGenreFilter = useCallback((value: string) => {
    setGenreFilterState(value);
    setPage(1);
  }, []);

  const startEdit = useCallback((song: Song) => {
    setMode({ kind: "edit", song });
  }, []);

  async function handleSubmitForm(payload: SongWritePayload) {
    setBusy(true);
    try {
      if (mode.kind === "create") {
        await createSong(payload, pw);
        toast("Song created", { variant: "success" });
      } else if (mode.kind === "edit") {
        await updateSong(mode.song.id, payload, pw);
        toast("Song updated", { variant: "success" });
      }
      setMode({ kind: "list" });
      await fetchSongs();
    } catch (err) {
      reportError(err, "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (deleteId === null || deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    setBusy(true);
    try {
      await deleteSong(deleteId, pw);
      toast("Song deleted", { variant: "success" });
      setDeleteId(null);
      await fetchSongs();
    } catch (err) {
      reportError(err, "Delete failed");
    } finally {
      setBusy(false);
      deleteInFlightRef.current = false;
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const summary = await bulkImportSongs(file, pw);
      toast(
        `Imported ${summary.inserted} new + ${summary.updated} updated (${summary.total} total)`,
        { variant: "success" },
      );
      await fetchSongs();
    } catch (err) {
      reportError(err, "Import failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return {
    songs,
    total,
    totalPages,
    page,
    setPage,
    searchInput,
    setSearchInput,
    genreFilter,
    setGenreFilter,
    genres,
    mode,
    setMode,
    deleteId,
    setDeleteId,
    loading,
    busy,
    fileInputRef,
    startEdit,
    handleSubmitForm,
    handleConfirmDelete,
    handleFile,
  };
}
