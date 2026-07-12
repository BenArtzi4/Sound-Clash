import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredTeam,
  getStoredTeam,
  parseRejoinHash,
  rejoinHash,
  setStoredTeam,
  teamRejoinUrl,
} from "./teamStorage";

const UUID = "b3b8c9d0-1234-4abc-9def-0123456789ab";

afterEach(() => {
  window.localStorage.clear();
});

describe("stored team identity", () => {
  it("round-trips set -> get and clears", () => {
    setStoredTeam("ABCDEF", { id: "t1", name: "Alice" });
    expect(getStoredTeam("ABCDEF")).toEqual({ id: "t1", name: "Alice" });
    expect(getStoredTeam("OTHER1")).toBeNull();
    clearStoredTeam("ABCDEF");
    expect(getStoredTeam("ABCDEF")).toBeNull();
  });

  it("returns null for a corrupt or incomplete stored value", () => {
    window.localStorage.setItem("game:ABCDEF:team", "{not json");
    expect(getStoredTeam("ABCDEF")).toBeNull();
    window.localStorage.setItem("game:ABCDEF:team", JSON.stringify({ id: "t1" }));
    expect(getStoredTeam("ABCDEF")).toBeNull();
  });
});

describe("rejoin hash", () => {
  it("round-trips rejoinHash -> parseRejoinHash", () => {
    expect(parseRejoinHash(rejoinHash(UUID))).toBe(UUID);
  });

  it("accepts uppercase UUIDs (case-insensitive match)", () => {
    expect(parseRejoinHash(`#rt=${UUID.toUpperCase()}`)).toBe(UUID.toUpperCase());
  });

  it.each([
    ["", "empty"],
    ["#", "bare hash"],
    ["#rt=", "no token"],
    ["#rt=not-a-uuid", "non-UUID token"],
    [`#token=${UUID}`, "wrong param name"],
    [`#mt=${UUID}`, "manager-token param, not rejoin"],
    [`#rt=${UUID}&x=1`, "trailing junk"],
    [`#rt=${UUID.slice(0, -1)}`, "truncated UUID"],
    [`rt=${UUID}`, "missing # prefix"],
  ])("rejects %s (%s)", (hash) => {
    expect(parseRejoinHash(hash)).toBeNull();
  });

  it("builds the rejoin URL on the current origin", () => {
    expect(teamRejoinUrl("ABCDEF", UUID)).toBe(`${window.location.origin}/join/ABCDEF#rt=${UUID}`);
  });
});
