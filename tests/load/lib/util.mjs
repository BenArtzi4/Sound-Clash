// Shared plumbing for the load harness: seeded PRNG, pacing, HTTP, env resolution.
// No dependencies beyond Node builtins — supabase-js is borrowed from
// frontend/node_modules via createRequire (see supa.mjs).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tests/load/lib/ -> repo root is three levels up.
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic PRNG so a run is reproducible from its --seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
export const rngRange = (rng, [min, max]) => min + rng() * (max - min);
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function pickWeighted(rng, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= it.weight;
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeLatencies(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    max: Math.round(sorted[sorted.length - 1]),
  };
}

// Serializing interval pacer. The backend rate-limits per client IP with
// fixed per-minute windows and NO Retry-After header (slowapi), so the only
// safe strategy from a single test machine is a steady request gap below the
// limit. capacity is 1 by design: bursts can straddle a window boundary.
export class Pacer {
  constructor(perMinute, label) {
    this.intervalMs = Math.ceil(60000 / perMinute);
    this.label = label;
    this.nextAt = 0;
    this.queue = Promise.resolve();
  }
  take() {
    const prev = this.queue;
    let release;
    this.queue = new Promise((r) => (release = r));
    return prev.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, this.nextAt - now);
      this.nextAt = Math.max(now, this.nextAt) + this.intervalMs;
      if (waitMs > 0) await sleep(waitMs);
      release();
    });
  }
}

export class LoadError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = "LoadError";
    this.context = context;
  }
}

// fetch with timeout + JSON handling. Returns {status, json, text}.
export async function fetchJson(url, { method = "GET", headers = {}, body, timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json", ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON body (e.g. Cloudflare HTML error page); keep text for context
    }
  }
  return { status: res.status, json, text };
}

// Minimal .env parser (KEY=VALUE lines, # comments). Vite env files are not
// auto-loaded by Node, so the harness reads them itself.
export function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// Resolve the target endpoints. prod reads the committed frontend/.env.production
// (browser-public values by definition); local reads frontend/.env.local.
// LOADTEST_* env vars override everything for ad-hoc targets.
export function resolveEnv(target) {
  const file =
    target === "local"
      ? path.join(REPO_ROOT, "frontend", ".env.local")
      : path.join(REPO_ROOT, "frontend", ".env.production");
  const vals = parseEnvFile(file);
  const env = {
    target,
    supabaseUrl: process.env.LOADTEST_SUPABASE_URL || vals.VITE_SUPABASE_URL,
    anonKey: process.env.LOADTEST_SUPABASE_ANON_KEY || vals.VITE_SUPABASE_ANON_KEY,
    apiUrl: process.env.LOADTEST_API_URL || vals.VITE_API_URL,
  };
  if (!env.supabaseUrl || !env.anonKey || !env.apiUrl) {
    throw new LoadError(
      `missing endpoint config for target=${target}: expected VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_API_URL in ${file} (or LOADTEST_* env overrides)`,
    );
  }
  return env;
}

export class Logger {
  constructor() {
    this.startedAt = Date.now();
  }
  stamp() {
    const s = Math.floor((Date.now() - this.startedAt) / 1000);
    return `[+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}]`;
  }
  info(msg) {
    console.log(`${this.stamp()} ${msg}`);
  }
  warn(msg) {
    console.log(`${this.stamp()} WARN ${msg}`);
  }
  error(msg) {
    console.log(`${this.stamp()} ERROR ${msg}`);
  }
}

// Run up to `limit` async thunks concurrently (used to stagger Realtime
// channel joins instead of slamming 240 subscribes into one instant).
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
