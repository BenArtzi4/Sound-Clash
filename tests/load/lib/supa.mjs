// Simulated device layer. Each Device mirrors what one real browser does:
// its own supabase-js client (own Realtime WebSocket), the exact channel the
// app subscribes (`game:<code>`, three postgres_changes bindings filtered by
// game_code), the same hydrate-on-SUBSCRIBED REST reads, and the same 60s
// backstop resync cadence. supabase-js is borrowed from frontend/node_modules
// via createRequire — no new dependency (Node >= 22 provides the native
// WebSocket realtime-js needs).

import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { REPO_ROOT, LoadError, rngInt } from "./util.mjs";

const frontendRequire = createRequire(path.join(REPO_ROOT, "frontend", "package.json"));
const { createClient } = frontendRequire("@supabase/supabase-js");

const RPC_TIMEOUT_MS = 20000;
const SUBSCRIBE_TIMEOUT_MS = 15000;

// Mirrors frontend/src/hooks/useGameChannel.ts ACTIVE_GAME_COLUMNS.
const ACTIVE_GAME_COLUMNS =
  "game_code,status,selected_genres,selected_decades,round_number,current_song_id,current_round_id,buzzed_team_id,locked_at,started_at,ended_at,expires_at";

export class Device {
  /**
   * @param {object} opts
   * @param {string} opts.id       e.g. "G03/T07", "G03/mgr", "G03/display"
   * @param {string} opts.role     "team" | "manager" | "display"
   * @param {string} opts.gameCode 6-char game code
   * @param {object} opts.env      resolved endpoints
   * @param {object} opts.metrics  Metrics collector
   * @param {(device: Device, table: string, payload: object) => void} opts.onEvent
   */
  constructor({ id, role, gameCode, env, metrics, onEvent }) {
    this.id = id;
    this.role = role;
    this.gameCode = gameCode;
    this.env = env;
    this.metrics = metrics;
    this.onEvent = onEvent;
    this.subState = "idle"; // idle | subscribed | error | timeout | closed
    this.subscribedCount = 0;
    this.channel = null;
    this.resyncTimer = null;
    this.closed = false;
    // Same client options as frontend/src/lib/supabase.ts.
    this.client = createClient(env.supabaseUrl, env.anonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // Subscribe exactly like useGameChannel: one channel, three bindings, all
  // filtered by game_code. Resolves with the first terminal status; later
  // transitions keep updating subState (reconnects are counted).
  subscribe() {
    return new Promise((resolve) => {
      const filter = `game_code=eq.${this.gameCode}`;
      const ch = this.client.channel(`game:${this.gameCode}`);
      for (const table of ["active_games", "game_teams", "game_rounds"]) {
        ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, (payload) => {
          try {
            this.onEvent(this, table, payload);
          } catch {
            // measurement must never crash the drive loop
          }
        });
      }
      let settled = false;
      const settle = (state) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(state);
        }
      };
      const timer = setTimeout(() => {
        this.subState = "timeout";
        settle("timeout");
      }, SUBSCRIBE_TIMEOUT_MS);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.subscribedCount += 1;
          this.subState = "subscribed";
          // The real app re-hydrates over REST on every (re)subscribe.
          this.hydrate().catch(() => {});
          settle("subscribed");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (this.subState !== "subscribed") this.subState = "error";
          settle("error");
        } else if (status === "CLOSED") {
          if (!this.closed) this.subState = "closed";
        }
      });
      this.channel = ch;
    });
  }

  get reconnects() {
    return Math.max(0, this.subscribedCount - 1);
  }

  // The app's three authoritative hydrate reads (Promise.all in useGameChannel).
  async hydrate() {
    const t0 = performance.now();
    const [g, t, r] = await Promise.all([
      this.client
        .from("active_games")
        .select(ACTIVE_GAME_COLUMNS)
        .eq("game_code", this.gameCode)
        .maybeSingle(),
      this.client.from("game_teams").select("*").eq("game_code", this.gameCode),
      this.client.from("game_rounds").select("*").eq("game_code", this.gameCode),
    ]);
    this.metrics.addLatency("rest:hydrate", performance.now() - t0);
    if (g.error || t.error || r.error) {
      this.metrics.addAnomaly(`hydrate error on ${this.id}: ${(g.error || t.error || r.error).message}`);
    }
    return g.data;
  }

  // Background resync like the app's quiet backstop (60s cadence; the app
  // tightens to 15s while a lock is held — simplified to a flat cadence here).
  startResync(rng, everyMs = 60000) {
    const tick = async () => {
      if (this.closed) return;
      await this.hydrate().catch(() => {});
      if (!this.closed) this.resyncTimer = setTimeout(tick, everyMs + rngInt(rng, 0, 10000));
    };
    this.resyncTimer = setTimeout(tick, everyMs + rngInt(rng, 0, 10000));
  }

  /**
   * Measured RPC call. PostgREST TABLE returns arrive as arrays — callers get
   * the raw data and unwrap. Named errors listed in expectedErrors return
   * {expectedError} instead of throwing.
   */
  async rpc(name, params, { expectedErrors = [] } = {}) {
    const t0 = performance.now();
    const { data, error } = await this.client
      .rpc(name, params)
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    const ms = performance.now() - t0;
    this.metrics.addLatency(`rpc:${name}`, ms);
    this.metrics.bump("actions"); // wire-call count: the error-rate denominator
    if (error) {
      const known = expectedErrors.find((e) => (error.message || "").includes(e));
      if (known) return { expectedError: known, ms };
      throw new LoadError(`rpc ${name} failed: ${error.message} (code=${error.code})`, {
        device: this.id,
        game: this.gameCode,
        rpc: name,
      });
    }
    return { data, ms };
  }

  async close() {
    this.closed = true;
    if (this.resyncTimer) clearTimeout(this.resyncTimer);
    try {
      if (this.channel) await this.client.removeChannel(this.channel);
      this.client.realtime.disconnect();
    } catch {
      // closing is best-effort
    }
  }
}
