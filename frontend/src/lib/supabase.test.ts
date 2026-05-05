import { describe, expect, it } from "vitest";
import { supabase } from "./supabase";

describe("supabase singleton", () => {
  it("constructs a client", () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.channel).toBe("function");
    expect(typeof supabase.from).toBe("function");
    expect(typeof supabase.rpc).toBe("function");
  });

  it("returns the same instance across imports", async () => {
    const reimport = await import("./supabase");
    expect(reimport.supabase).toBe(supabase);
  });
});
