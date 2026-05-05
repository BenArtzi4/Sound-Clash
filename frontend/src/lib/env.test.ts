import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-test");
  vi.stubEnv("VITE_API_URL", "http://localhost:8000");
});

describe("env", () => {
  it("loads required vars and exposes optional ones as undefined", async () => {
    vi.resetModules();
    const { env } = await import("./env");
    expect(env.VITE_SUPABASE_URL).toBe("http://localhost:54321");
    expect(env.VITE_SUPABASE_ANON_KEY).toBe("anon-test");
    expect(env.VITE_API_URL).toBe("http://localhost:8000");
    expect(env.VITE_SENTRY_DSN).toBeUndefined();
  });

  it("throws when a required env var is missing", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    await expect(import("./env")).rejects.toThrow(/VITE_SUPABASE_URL/);
  });

  it("returns Sentry DSN when set", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SENTRY_DSN", "https://example.ingest.sentry.io/1");
    const { env } = await import("./env");
    expect(env.VITE_SENTRY_DSN).toBe("https://example.ingest.sentry.io/1");
  });
});
