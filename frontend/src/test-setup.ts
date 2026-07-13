import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-test");
vi.stubEnv("VITE_API_URL", "http://localhost:8000");

// jsdom has no layout engine, so window.scrollTo is a not-implemented stub that
// logs noise whenever a route change fires <ScrollToTop>. Make it a silent
// no-op; tests that assert on it spy over this per-test.
window.scrollTo = vi.fn();
