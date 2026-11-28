import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { useSetlistProgress } from "./useSetlistProgress";
import { resetSupabaseMock, setRpcResponse, supabaseMock } from "../test/supabaseMock";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

const TOKEN = "22222222-2222-2222-2222-222222222222";

// Made-up counts for a game from the host's own song list.
function summaryRow(listLeft: number) {
  return { list_total: 40, list_songs: 35, list_left: listLeft, extra_songs: 20, extra_left: 20 };
}

function progress(listLeft: number) {
  return { listTotal: 40, listSongs: 35, listLeft, extraSongs: 20, extraLeft: 20 };
}

function summaryCalls() {
  return supabaseMock.rpc.mock.calls.filter(([fn]) => fn === "game_pool_summary");
}

function deferred() {
  let resolve: (result: RpcResult) => void = () => {};
  const promise = new Promise<RpcResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Props {
  gameCode: string;
  token: string | null;
  round: number;
}

// StrictMode runs every effect twice on mount, the way the app's dev build does.
function renderProgress(initial: Partial<Props> = {}) {
  return renderHook(
    ({ gameCode, token, round }: Props) => useSetlistProgress(gameCode, token, round),
    {
      initialProps: { gameCode: "ABCDEF", token: TOKEN, round: 0, ...initial },
      wrapper: StrictMode,
    },
  );
}

// A macrotask: every pending RPC promise and its handlers have run after it.
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  resetSupabaseMock();
});

describe("useSetlistProgress", () => {
  it("returns null for a game with no list", async () => {
    setRpcResponse({ data: [], error: null });
    const { result } = renderProgress();
    await flush();
    expect(result.current).toBeNull();
    expect(summaryCalls()).toEqual([
      ["game_pool_summary", { p_game_code: "ABCDEF", p_manager_token: TOKEN }],
    ]);
  });

  it("returns the numbers and refetches when the round changes", async () => {
    setRpcResponse({ data: [summaryRow(12)], error: null });
    const { result, rerender } = renderProgress({ round: 1 });
    await waitFor(() => expect(result.current).toEqual(progress(12)));

    setRpcResponse({ data: [summaryRow(11)], error: null });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 2 });
    await waitFor(() => expect(result.current).toEqual(progress(11)));
    expect(summaryCalls()).toHaveLength(2);
  });

  it("fetches on mount, so a reload mid-game shows the right numbers", async () => {
    setRpcResponse({ data: [summaryRow(4)], error: null });
    const { result } = renderProgress({ round: 31 });
    await waitFor(() => expect(result.current).toEqual(progress(4)));
    expect(summaryCalls()).toHaveLength(1);
  });

  it("returns null when the function is missing", async () => {
    // PostgREST's answer on a database without migration 060.
    setRpcResponse({
      data: null,
      error: { message: "Could not find the function", code: "PGRST202" },
    });
    const { result, rerender } = renderProgress();
    await flush();
    expect(result.current).toBeNull();

    // An old database stays old: later rounds ask nothing.
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 1 });
    await flush();
    expect(summaryCalls()).toHaveLength(1);
  });

  it("asks once per mount, even when StrictMode runs the effect twice", async () => {
    setRpcResponse({ data: [summaryRow(12)], error: null });
    const { result } = renderProgress();
    await waitFor(() => expect(result.current).toEqual(progress(12)));
    expect(summaryCalls()).toHaveLength(1);
  });

  it("makes no further calls after a zero-row answer when the round changes", async () => {
    setRpcResponse({ data: [], error: null });
    const { result, rerender } = renderProgress();
    await flush();

    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 1 });
    await flush();
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 2 });
    await flush();

    expect(result.current).toBeNull();
    expect(summaryCalls()).toHaveLength(1);
  });

  it("tries again on the next round after another error", async () => {
    setRpcResponse({ data: null, error: { message: "boom" } });
    const { result, rerender } = renderProgress({ round: 3 });
    await flush();
    expect(result.current).toBeNull();

    setRpcResponse({ data: [summaryRow(9)], error: null });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 4 });
    await waitFor(() => expect(result.current).toEqual(progress(9)));
    expect(summaryCalls()).toHaveLength(2);
  });

  it("shows nothing after a failed refetch, until a later round answers", async () => {
    setRpcResponse({ data: [summaryRow(12)], error: null });
    const { result, rerender } = renderProgress({ round: 1 });
    await waitFor(() => expect(result.current).toEqual(progress(12)));

    setRpcResponse({ data: null, error: { message: "game_not_found", code: "P0002" } });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 2 });
    await waitFor(() => expect(result.current).toBeNull());

    setRpcResponse({ data: [summaryRow(10)], error: null });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 3 });
    await waitFor(() => expect(result.current).toEqual(progress(10)));
  });

  it("makes no call without a manager token", async () => {
    setRpcResponse({ data: [summaryRow(12)], error: null });
    const { result, rerender } = renderProgress({ token: null });
    await flush();
    rerender({ gameCode: "ABCDEF", token: null, round: 1 });
    await flush();
    expect(result.current).toBeNull();
    expect(summaryCalls()).toHaveLength(0);
  });

  it("starts over for a new game code", async () => {
    setRpcResponse({ data: [], error: null });
    const { result, rerender } = renderProgress();
    await flush();

    setRpcResponse({ data: [summaryRow(12)], error: null });
    rerender({ gameCode: "GHJKLM", token: TOKEN, round: 0 });
    await waitFor(() => expect(result.current).toEqual(progress(12)));
    expect(summaryCalls()).toEqual([
      ["game_pool_summary", { p_game_code: "ABCDEF", p_manager_token: TOKEN }],
      ["game_pool_summary", { p_game_code: "GHJKLM", p_manager_token: TOKEN }],
    ]);
  });

  it("never shows one game's numbers for another game", async () => {
    setRpcResponse({ data: [summaryRow(12)], error: null });
    const { result, rerender } = renderProgress();
    await waitFor(() => expect(result.current).toEqual(progress(12)));

    const next = deferred();
    supabaseMock.rpc.mockImplementationOnce(() => next.promise);
    rerender({ gameCode: "GHJKLM", token: TOKEN, round: 0 });
    expect(result.current).toBeNull();

    await act(async () => {
      next.resolve({ data: [summaryRow(30)], error: null });
    });
    await waitFor(() => expect(result.current).toEqual(progress(30)));
  });

  it("ignores an answer that arrives after a newer request", async () => {
    const older = deferred();
    const newer = deferred();
    supabaseMock.rpc
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result, rerender } = renderProgress({ round: 1 });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 2 });
    expect(summaryCalls()).toHaveLength(2);

    await act(async () => {
      newer.resolve({ data: [summaryRow(11)], error: null });
    });
    await waitFor(() => expect(result.current).toEqual(progress(11)));

    // The round-1 answer lands last; it must not replace the round-2 numbers.
    await act(async () => {
      older.resolve({ data: [summaryRow(12)], error: null });
    });
    await flush();
    expect(result.current).toEqual(progress(11));
  });

  it("does not stop asking because of a zero-row answer that came too late", async () => {
    const older = deferred();
    const newer = deferred();
    supabaseMock.rpc
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result, rerender } = renderProgress({ round: 1 });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 2 });

    await act(async () => {
      newer.resolve({ data: [summaryRow(11)], error: null });
      older.resolve({ data: [], error: null });
    });
    await flush();
    expect(result.current).toEqual(progress(11));

    setRpcResponse({ data: [summaryRow(10)], error: null });
    rerender({ gameCode: "ABCDEF", token: TOKEN, round: 3 });
    await waitFor(() => expect(result.current).toEqual(progress(10)));
    expect(summaryCalls()).toHaveLength(3);
  });
});
