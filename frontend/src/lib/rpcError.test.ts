import { describe, expect, it } from "vitest";
import { RpcError, throwOnRpcError } from "./rpcError";

describe("RpcError", () => {
  it("is an Error subclass named RpcError carrying the sqlstate", () => {
    const err = new RpcError("manager_token_required", "28000");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RpcError");
    expect(err.message).toBe("manager_token_required");
    expect(err.sqlstate).toBe("28000");
  });

  it("leaves sqlstate undefined when omitted", () => {
    const err = new RpcError("select_next_song returned no row");
    expect(err.sqlstate).toBeUndefined();
  });
});

describe("throwOnRpcError", () => {
  it("does nothing when there is no error", () => {
    expect(() => throwOnRpcError(null)).not.toThrow();
    expect(() => throwOnRpcError(undefined)).not.toThrow();
  });

  it("throws an RpcError carrying the PostgREST message and code", () => {
    try {
      throwOnRpcError({ message: "no_more_songs", code: "22023" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).message).toBe("no_more_songs");
      expect((e as RpcError).sqlstate).toBe("22023");
    }
  });

  it("tolerates an error without a code (sqlstate stays undefined)", () => {
    try {
      throwOnRpcError({ message: "boom" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).sqlstate).toBeUndefined();
    }
  });
});
