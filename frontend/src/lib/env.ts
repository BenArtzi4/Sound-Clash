// Fail-fast env reader. Throws at module load if anything required is missing,
// which surfaces misconfiguration as a clear error instead of a runtime null.

interface Env {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_API_URL: string;
  VITE_SENTRY_DSN: string | undefined;
  // Grafana Faro collector URL. When unset, all latency telemetry is a no-op
  // (local dev, tests, and any prod build before the collector is provisioned).
  VITE_FARO_URL: string | undefined;
}

function read(name: keyof Env, required: boolean): string | undefined {
  const value = import.meta.env[name];
  if (required && (typeof value !== "string" || value.length === 0)) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const env: Env = {
  VITE_SUPABASE_URL: read("VITE_SUPABASE_URL", true) as string,
  VITE_SUPABASE_ANON_KEY: read("VITE_SUPABASE_ANON_KEY", true) as string,
  VITE_API_URL: read("VITE_API_URL", true) as string,
  VITE_SENTRY_DSN: read("VITE_SENTRY_DSN", false),
  VITE_FARO_URL: read("VITE_FARO_URL", false),
};
