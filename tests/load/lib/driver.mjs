// GameDriver: owns one simulated game end-to-end — create + joins (REST,
// paced under the per-IP rate limits), one Realtime device per participant,
// the seeded round loop, teardown, and final score verification.

import { performance } from "node:perf_hooks";
import { Device } from "./supa.mjs";
import { FLOWS, pickFlow } from "./flows.mjs";
import { fetchJson, LoadError, mulberry32, rngRange, rngInt, sleep, mapLimit } from "./util.mjs";

const RT_WINDOW_MS = 10000; // an event not seen within 10s counts as a miss

const PACES = {
  realistic: { listen: [3000, 8000], think: [900, 2600], between: [2000, 5000], short: [500, 1500] },
  fast: { listen: [300, 900], think: [120, 400], between: [250, 700], short: [80, 200] },
};

export class GameDriver {
  constructor({ index, cfg, env, pacers, metrics, log, registry, seed, rtPlan = null }) {
    this.index = index;
    this.cfg = cfg;
    // Realtime subscription plan for this game (null = subscribe everything):
    // { display: bool, manager: bool, teamSubs: number } — see planSubscriptions.
    this.rtPlan = rtPlan;
    this.env = env;
    this.pacers = pacers;
    this.metrics = metrics;
    this.log = log;
    this.registry = registry; // records {code, manager_token} for cleanup
    this.rng = mulberry32(seed);
    this.pace = PACES[cfg.pace];
    this.bonusEnabled = cfg.bonus;

    this.code = null;
    this.managerToken = null;
    this.roster = []; // [{id, name}]
    this.kicked = [];
    this.devices = new Map(); // teamId -> Device, plus "mgr" / "display"
    this.ledger = new Map(); // teamId -> expected score
    this.expectations = []; // open Realtime expectations

    this.roundNum = 0;
    this.roundId = null;
    this.lockHeld = null;
    this.freeGuess = false;
    this.roundsDone = 0;
    this.flowHistogram = {};
    this.completed = false;
    this.scoresVerified = false;
    this.failReason = null;
  }

  get mgr() {
    return this.devices.get("mgr");
  }
  deviceFor(team) {
    return this.devices.get(team.id);
  }
  tag() {
    return `G${String(this.index).padStart(2, "0")}`;
  }

  think(kind) {
    return sleep(Math.round(rngRange(this.rng, this.pace[kind])));
  }

  violation(message) {
    this.metrics.addViolation(this.tag(), message);
    this.log.error(`${this.tag()} INVARIANT: ${message}`);
  }
  error(message) {
    this.metrics.addError(this.tag(), message);
    this.log.error(`${this.tag()} ${message}`);
  }
  anomaly(message) {
    this.metrics.addAnomaly(`${this.tag()} ${message}`);
  }

  // ---- REST (FastAPI on Render; paced; 429 => wait out the minute window) --

  async rest(pacer, method, path, { body, token, okStatuses = [200, 201, 204], name } = {}) {
    for (let attempt = 1; ; attempt++) {
      if (pacer) await pacer.take();
      const t0 = performance.now();
      let res;
      try {
        res = await fetchJson(`${this.env.apiUrl}${path}`, {
          method,
          body,
          headers: token ? { "X-Manager-Token": token } : {},
        });
      } catch (err) {
        throw new LoadError(`${method} ${path} network failure: ${err.message}`, { game: this.code });
      }
      if (res.status !== 429) {
        // 429 attempts are counted separately; they must not pollute the
        // latency distribution or the error-rate denominator.
        this.metrics.addLatency(`rest:${name || path}`, performance.now() - t0);
        this.metrics.bump("actions");
      }
      if (res.status === 429) {
        // slowapi fixed one-minute windows, no Retry-After header: wait out
        // the window and retry. Counted separately — with correct pacing this
        // should be rare, and it is a one-IP artifact real users don't share.
        this.metrics.bump("rest:429");
        if (attempt > 4) throw new LoadError(`${method} ${path} still 429 after ${attempt} attempts`, {});
        this.log.warn(`${this.tag()} 429 on ${method} ${path} — backing off 61s (attempt ${attempt})`);
        await sleep(61000);
        continue;
      }
      if (!okStatuses.includes(res.status)) {
        throw new LoadError(
          `${method} ${path} -> HTTP ${res.status} ${res.json ? JSON.stringify(res.json) : res.text?.slice(0, 200)}`,
          { game: this.code },
        );
      }
      return res.json;
    }
  }

  // ---- Realtime expectations ------------------------------------------------

  expectRt(family, matchFn) {
    const audience = [...this.devices.values()].filter((dv) => dv.subState === "subscribed").map((dv) => dv.id);
    if (audience.length === 0) return;
    this.expectations.push({
      family,
      matchFn,
      t0: performance.now(),
      audience: new Set(audience),
      matched: new Set(),
    });
  }

  onEvent = (device, table, payload) => {
    for (const exp of this.expectations) {
      if (!exp.audience.has(device.id) || exp.matched.has(device.id)) continue;
      if (exp.matchFn(table, payload)) {
        exp.matched.add(device.id);
        this.metrics.addRtDelivery(exp.family, performance.now() - exp.t0);
        break; // FIFO: an event settles at most one expectation per device
      }
    }
  };

  // Called by the orchestrator's sweeper and once at teardown (force=true).
  sweepExpectations(force = false) {
    const now = performance.now();
    this.expectations = this.expectations.filter((exp) => {
      const expired = force || now - exp.t0 > RT_WINDOW_MS;
      const complete = exp.matched.size >= exp.audience.size;
      if (complete) return false;
      if (expired) {
        for (const id of exp.audience) {
          if (!exp.matched.has(id)) this.metrics.addRtMiss(exp.family);
        }
        return false;
      }
      return true;
    });
  }

  // ---- lifecycle -------------------------------------------------------------

  async setup() {
    const created = await this.rest(this.pacers.create, "POST", "/games", {
      body: { selected_genres: this.cfg.genreIds },
      okStatuses: [201],
      name: "create_game",
    });
    this.code = created.game_code;
    this.managerToken = created.manager_token;
    this.registry.add({ code: this.code, manager_token: this.managerToken });
    this.log.info(`${this.tag()} created game ${this.code}`);

    for (let i = 1; i <= this.cfg.teams; i++) {
      const name = `LT-${this.tag()}-T${String(i).padStart(2, "0")}`;
      const joined = await this.rest(this.pacers.join, "POST", `/games/${this.code}/teams`, {
        body: { name },
        okStatuses: [201],
        name: "join_team",
      });
      this.roster.push({ id: joined.id, name });
      this.ledger.set(joined.id, 0);
    }
    this.log.info(`${this.tag()} joined ${this.roster.length} teams`);

    // One Realtime device per participant, exactly like real phones/screens.
    const specs = [
      { id: `${this.tag()}/mgr`, key: "mgr", role: "manager" },
      { id: `${this.tag()}/display`, key: "display", role: "display" },
      ...this.roster.map((t, i) => ({ id: `${this.tag()}/T${String(i + 1).padStart(2, "0")}`, key: t.id, role: "team" })),
    ];
    for (const s of specs) {
      this.devices.set(
        s.key,
        new Device({ id: s.id, role: s.role, gameCode: this.code, env: this.env, metrics: this.metrics, onEvent: this.onEvent }),
      );
    }
    // Apply the Realtime budget plan: unsubscribed devices still play via
    // RPC/REST, they just don't count in delivery-measurement audiences.
    const plan = this.rtPlan || { display: true, manager: true, teamSubs: Infinity };
    const toSubscribe = [];
    let teamSlots = plan.teamSubs;
    for (const dv of this.devices.values()) {
      if (dv.role === "team") {
        if (teamSlots > 0) {
          toSubscribe.push(dv);
          teamSlots--;
        }
      } else if ((dv.role === "manager" && plan.manager) || (dv.role === "display" && plan.display)) {
        toSubscribe.push(dv);
      }
    }
    const skipped = this.devices.size - toSubscribe.length;
    if (skipped > 0) this.metrics.bump("subscribe:skipped_budget", skipped);

    // Stagger channel joins a little (a 240-subscribe stampede is not what a
    // real party does; phones trickle in over the lobby minute).
    const outcomes = await mapLimit(toSubscribe, 6, async (dv) => {
      await sleep(rngInt(this.rng, 0, 400));
      return dv.subscribe();
    });
    for (const o of outcomes) this.metrics.bump(o === "subscribed" ? "subscribe:ok" : "subscribe:failed");
    const failed = outcomes.filter((o) => o !== "subscribed").length;
    if (failed > 0) this.log.warn(`${this.tag()} ${failed}/${outcomes.length} realtime subscriptions failed`);
    if (skipped > 0) this.log.info(`${this.tag()} ${skipped} device(s) not subscribed (rt-budget)`);
    if (this.cfg.resync) {
      // Each resync timer gets its OWN PRNG stream: sharing this.rng would let
      // wall-clock-timed ticks interleave with the play loop's draws and break
      // --seed reproducibility of the flow sequence.
      let dvIdx = 0;
      for (const dv of this.devices.values()) dv.startResync(mulberry32(this.cfg.seed + this.index * 100003 + ++dvIdx));
    }
  }

  async advance() {
    const nextN = this.roundNum + 1;
    this.expectRt("round_insert", (table, p) => table === "game_rounds" && p.eventType === "INSERT" && p.new?.round_number === nextN);
    const { data } = await this.mgr.rpc("select_next_song", {
      p_game_code: this.code,
      p_manager_token: this.managerToken,
      p_song_id: null, // explicit null — PostgREST drops undefined keys
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new LoadError(`select_next_song returned no row for round ${nextN} — song pool exhausted mid-run?`, {
        game: this.code,
      });
    }
    if (row.round_number !== nextN) {
      this.violation(`select_next_song returned round ${row.round_number}, expected ${nextN}`);
    }
    this.roundNum = row.round_number;
    this.roundId = row.round_id;
    this.freeGuess = false;
    this.lockHeld = null;
  }

  async peek() {
    const { data } = await this.mgr.rpc("peek_next_song", {
      p_game_code: this.code,
      p_manager_token: this.managerToken,
    });
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length > 1) this.anomaly(`peek_next_song returned ${rows.length} rows`);
  }

  async extendOnce() {
    const { data } = await this.mgr.rpc("extend_game", {
      p_game_code: this.code,
      p_manager_token: this.managerToken,
    });
    if (typeof data !== "string" || Number.isNaN(Date.parse(data))) {
      this.violation(`extend_game returned unparsable expires_at: ${JSON.stringify(data)}`);
    }
  }

  async bonusTo(team, points) {
    // Acquire the pacer BEFORE registering the expectation: queueing time in
    // the shared manager-REST pacer must not be charged to Realtime delivery.
    await this.pacers.mgrRest.take();
    const expectedTotal = this.ledger.get(team.id) + points;
    this.expectRt(
      "score_update",
      (table, p) => table === "game_teams" && p.eventType === "UPDATE" && p.new?.id === team.id && p.new?.score === expectedTotal,
    );
    const res = await this.rest(null, "POST", `/games/${this.code}/bonus`, {
      body: { team_id: team.id, points },
      token: this.managerToken,
      okStatuses: [200],
      name: "bonus",
    });
    if (res.team_total_score !== expectedTotal) {
      this.violation(`bonus total ${res.team_total_score} != ledger ${expectedTotal} (team ${team.name})`);
    }
    this.ledger.set(team.id, res.team_total_score);
  }

  async kickOne() {
    if (this.roster.length < 3) return;
    // Kick the current last-place team (a realistic host action).
    const target = [...this.roster].sort((a, b) => this.ledger.get(a.id) - this.ledger.get(b.id))[0];
    await this.rest(this.pacers.mgrRest, "DELETE", `/games/${this.code}/teams/${target.id}`, {
      token: this.managerToken,
      okStatuses: [204],
      name: "kick_team",
    });
    this.roster = this.roster.filter((t) => t.id !== target.id);
    this.kicked.push(target);
    this.ledger.delete(target.id);
    const dv = this.devices.get(target.id);
    if (dv) {
      // A closed device can no longer deliver events; drop it from open
      // expectations so the kick doesn't register as false Realtime misses.
      for (const exp of this.expectations) exp.audience.delete(dv.id);
      await dv.close();
      this.devices.delete(target.id);
    }
    this.log.info(`${this.tag()} kicked ${target.name}`);
  }

  async play(forcedFlows = null, onRoundDone = () => {}) {
    for (let r = 1; r <= this.cfg.rounds; r++) {
      const flow = forcedFlows
        ? FLOWS.find((f) => f.name === forcedFlows[(r - 1) % forcedFlows.length])
        : pickFlow(this);
      if (this.roster.length < flow.minTeams) {
        // roster shrank below the forced flow's needs (kick) — fall back
        const fallback = FLOWS.find((f) => f.name === "single_title");
        await this.runRound(fallback);
      } else {
        await this.runRound(flow);
      }
      this.roundsDone = r;
      onRoundDone();
      if (this.cfg.kick && r === Math.max(2, this.cfg.rounds - 2)) await this.kickOne();
      if (r === Math.ceil(this.cfg.rounds * 0.66)) await this.extendOnce();
    }
    this.completed = true;
  }

  async runRound(flow) {
    this.flowHistogram[flow.name] = (this.flowHistogram[flow.name] || 0) + 1;
    await this.advance();
    if (this.rng() < 0.4) {
      await this.think("short");
      await this.peek(); // manager console prebuffers the next video
    }
    await this.think("listen"); // the song is "playing"
    await flow.run(this);
    await this.think("between");
  }

  // Fetch authoritative final scores over anon PostgREST and compare with the
  // local ledger. Runs BEFORE end so state is still live.
  async verifyFinalScores() {
    const url =
      `${this.env.supabaseUrl}/rest/v1/game_teams?select=id,name,score&game_code=eq.${this.code}`;
    const res = await fetchJson(url, {
      headers: { apikey: this.env.anonKey, Authorization: `Bearer ${this.env.anonKey}` },
    });
    if (res.status !== 200 || !Array.isArray(res.json)) {
      this.error(`final score fetch failed: HTTP ${res.status}`);
      return;
    }
    const byId = new Map(res.json.map((t) => [t.id, t]));
    let ok = true;
    for (const team of this.roster) {
      const dbRow = byId.get(team.id);
      if (!dbRow) {
        this.violation(`team ${team.name} missing from final DB state`);
        ok = false;
      } else if (dbRow.score !== this.ledger.get(team.id)) {
        this.violation(`final score for ${team.name}: db=${dbRow.score} expected=${this.ledger.get(team.id)}`);
        ok = false;
      }
    }
    for (const k of this.kicked) {
      if (byId.has(k.id)) {
        this.violation(`kicked team ${k.name} still present in final DB state`);
        ok = false;
      }
    }
    this.scoresVerified = ok;
    if (ok) this.log.info(`${this.tag()} final scores verified (${this.roster.length} teams)`);
  }

  async end() {
    if (!this.code) return;
    try {
      await this.rest(this.pacers.mgrRest, "POST", `/games/${this.code}/end`, {
        token: this.managerToken,
        okStatuses: [200, 404, 410], // 404/410 = already gone; aligned with cleanup
        name: "end_game",
      });
      this.registry.markEnded(this.code);
    } catch (err) {
      this.error(`end_game failed: ${err.message}`);
    }
  }

  async closeDevices() {
    await Promise.all([...this.devices.values()].map((dv) => dv.close().catch(() => {})));
  }

  snapshot() {
    return {
      index: this.index,
      code: this.code,
      teams: this.roster.length + this.kicked.length,
      roundsPlanned: this.cfg.rounds,
      roundsDone: this.roundsDone,
      completed: this.completed,
      scoresVerified: this.scoresVerified,
      failReason: this.failReason,
      flowHistogram: this.flowHistogram,
    };
  }
}
