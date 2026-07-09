import { afterEach, describe, expect, it } from "vitest";
import {
  clearManagerToken,
  getManagerToken,
  managerRecoveryUrl,
  parseRecoveryHash,
  recoveryHash,
  setManagerToken,
} from "./managerToken";

const UUID = "b3b8c9d0-1234-4abc-9def-0123456789ab";

afterEach(() => {
  window.localStorage.clear();
});

describe("manager token storage", () => {
  it("round-trips set -> get and clears", () => {
    setManagerToken("ABCDEF", UUID);
    expect(getManagerToken("ABCDEF")).toBe(UUID);
    expect(getManagerToken("OTHER1")).toBeNull();
    clearManagerToken("ABCDEF");
    expect(getManagerToken("ABCDEF")).toBeNull();
  });
});

describe("recovery hash", () => {
  it("round-trips recoveryHash -> parseRecoveryHash", () => {
    expect(parseRecoveryHash(recoveryHash(UUID))).toBe(UUID);
  });

  it("accepts uppercase UUIDs (case-insensitive match)", () => {
    expect(parseRecoveryHash(`#mt=${UUID.toUpperCase()}`)).toBe(UUID.toUpperCase());
  });

  it.each([
    ["", "empty"],
    ["#", "bare hash"],
    ["#mt=", "no token"],
    ["#mt=not-a-uuid", "non-UUID token"],
    [`#token=${UUID}`, "wrong param name"],
    [`#mt=${UUID}&x=1`, "trailing junk"],
    [`#mt=${UUID.slice(0, -1)}`, "truncated UUID"],
    [`mt=${UUID}`, "missing # prefix"],
  ])("rejects %s (%s)", (hash) => {
    expect(parseRecoveryHash(hash)).toBeNull();
  });

  it("builds the recovery URL on the current origin", () => {
    expect(managerRecoveryUrl("ABCDEF", UUID)).toBe(
      `${window.location.origin}/manager/game/ABCDEF#mt=${UUID}`,
    );
  });
});
