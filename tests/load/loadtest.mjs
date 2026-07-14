#!/usr/bin/env node
// Sound Clash load-test harness (protocol-level, zero new dependencies).
//
// Simulates whole games against the real stack the way real devices do it:
// REST for create/join/bonus/end/kick (FastAPI on Render), direct PostgREST
// RPCs for the hot path (buzz_in / award_attempt / release_buzz_lock /
// select_next_song / peek_next_song / extend_game), and one Supabase Realtime
// WebSocket per simulated device. No browsers, no YouTube — those are
// client-local and don't load the backend.
//
//   node tests/load/loadtest.mjs run --label check1-5x10 --games 5 --teams 10 --rounds 15 --seed 101
//   node tests/load/loadtest.mjs smoke
//   node tests/load/loadtest.mjs cleanup --dir tests/load/results/<label>
//
// See tests/load/README.md for scenarios, thresholds and caveats.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { GameDriver } from "./lib/driver.mjs";
import { SMOKE_FLOW_SEQUENCE } from "./lib/flows.mjs";
import { Metrics, renderReportMd } from "./lib/metrics.mjs";
import { fetchJson, Logger, LoadError, Pacer, REPO_ROOT, resolveEnv, sleep } from "./lib/util.mjs";

const log = new Logger();

// ---------------------------------------------------------------------------
// CLI

function parseCli() {
  const [, , command = "run", ...rest] = process.argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      label: { type: "string" },
      games: { type: "string", default: "1" },
      teams: { type: "string", default: "10" },
      rounds: { type: "string", default: "15" },
      seed: { type: "string" }, // no default here so smoke can detect "not given"
      pace: { type: "string", default: "realistic" }, // realistic | fast
      target: { type: "string", default: "prod" }, // prod | local
      genres: { type: "string", default: "rock,pop" },
      kick: { type: "boolean", default: false },
      "skip-bonus": { type: "boolean", default: false },
      "skip-resync": { type: "boolean", default: false },
      outdir: { type: "string" },
      dir: { type: "string" }, // cleanup target
      "create-rate": { type: "string", default: "9" }, // per minute (< backend's 10)
      "join-rate": { type: "string", default: "27" }, // per minute (< backend's 30)
      "mgr-rate": { type: "string", default: "80" }, // per minute (< backend's 100)
    },
    allowPositionals: false,
  });
  return { command, values };
}

// ---------------------------------------------------------------------------
// Run registry (game codes + manager tokens, so leftover games can always be
// ended). Lives in the gitignored results dir; tokens are per-game secrets
// for 4h synthetic games we created ourselves.

class Registry {
  constructor(file) {
    this.file = file;
    this.games = [];
  }
  add(g) {
    this.games.push({ ...g, ended: false });
    this.flush();
  }
  markEnded(code) {
    const g = this.games.find((x) => x.code === code);
    if (g) g.ended = true;
    this.flush();
  }
  flush() {
    fs.writeFileSync(this.file, JSON.stringify({ games: this.games }, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Preflight helpers

async function waitForBackend(env) {
  const t0 = Date.now();
  for (let i = 0; i < 18; i++) {
    try {
      const res = await fetchJson(`${env.apiUrl}/health`, { timeoutMs: 10000 });
      if (res.status === 200 && res.json?.status === "ok") {
        return { warmupMs: Date.now() - t0, supabase: res.json.supabase };
      }
    } catch {
      // Render free-tier cold start: keep knocking
    }
    await sleep(5000);
  }
  throw new LoadError("backend /health never became ok (waited ~4.5 minutes)");
}

async function pgrest(env, pathAndQuery) {
  const res = await fetchJson(`${env.supabaseUrl}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
  });
  if (res.status !== 200) throw new LoadError(`PostgREST ${pathAndQuery} -> HTTP ${res.status}`);
  return res.json;
}

async function resolveGenres(env, slugsCsv) {
  const slugs = slugsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const all = await pgrest(env, "genres?select=id,slug");
  const ids = slugs.map((slug) => {
    const hit = all.find((g) => g.slug === slug);
    if (!hit) throw new LoadError(`genre slug not found: ${slug} (have: ${all.map((g) => g.slug).join(", ")})`);
    return hit.id;
  });
  return { slugs, ids };
}

async function countSongPool(env, genreIds) {
  // Mirror the picker's eligibility (mig 045 skips songs flagged unavailable),
  // otherwise the guard can pass while the real playable pool is smaller.
  const [rows, dead] = await Promise.all([
    pgrest(env, `song_genres?select=song_id&genre_id=in.(${genreIds.join(",")})&limit=10000`),
    pgrest(env, "songs?select=id&unavailable_at=not.is.null&limit=10000"),
  ]);
  const unavailable = new Set(dead.map((s) => s.id));
  return new Set(rows.map((r) => r.song_id).filter((id) => !unavailable.has(id))).size;
}

async function warnIfLiveGames(env) {
  try {
    const rows = await pgrest(env, "active_games?select=game_code&status=eq.playing&ended_at=is.null&limit=10");
    if (rows.length > 0) {
      log.warn(`preflight: ${rows.length} game(s) currently in status=playing on this target — a real party may be live. The load run proceeds but consider re-running off-hours.`);
      return rows.length;
    }
  } catch (err) {
    log.warn(`preflight live-games check failed: ${err.message}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// The run

async function runLoadTest(values, { forcedFlows = null } = {}) {
  const cfg = {
    label: values.label,
    games: Number(values.games),
    teams: Number(values.teams),
    rounds: Number(values.rounds),
    seed: Number(values.seed ?? "1"),
    pace: values.pace === "fast" ? "fast" : "realistic",
    target: values.target,
    genres: values.genres,
    kick: values.kick,
    bonus: !values["skip-bonus"],
    resync: !values["skip-resync"],
    createRate: Number(values["create-rate"]),
    joinRate: Number(values["join-rate"]),
    mgrRate: Number(values["mgr-rate"]),
  };
  if (!cfg.label) throw new LoadError("--label is required for run");
  const env = resolveEnv(cfg.target);

  // Results dir: fixed path per label (Monitor-friendly); archive a previous run.
  const outBase = values.outdir || path.join(REPO_ROOT, "tests", "load", "results");
  const runDir = path.join(outBase, cfg.label);
  if (fs.existsSync(runDir)) fs.renameSync(runDir, `${runDir}-prev-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });

  const metrics = new Metrics();
  const registry = new Registry(path.join(runDir, "games.json"));
  const phases = [];
  const phaseStart = { t: Date.now(), name: "preflight" };
  const nextPhase = (name) => {
    phases.push({ name: phaseStart.name, ms: Date.now() - phaseStart.t });
    phaseStart.t = Date.now();
    phaseStart.name = name;
    log.info(`=== phase: ${name} ===`);
  };

  // Status heartbeat for detached monitoring.
  const status = {
    label: cfg.label,
    phase: "preflight",
    startedAt: new Date().toISOString(),
    gamesTotal: cfg.games,
    gamesCreated: 0,
    teamsJoined: 0,
    teamsTotal: cfg.games * cfg.teams,
    roundsDone: 0,
    roundsTotal: cfg.games * cfg.rounds,
    errorCount: 0,
    violationCount: 0,
    done: false,
    verdict: null,
  };
  const statusFile = path.join(runDir, "status.json");
  const writeStatus = () => {
    status.phase = phaseStart.name;
    status.errorCount = metrics.errors.length;
    status.violationCount = metrics.violations.length;
    status.now = new Date().toISOString();
    try {
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    } catch {
      // never let status writing kill the run
    }
  };
  const statusTimer = setInterval(writeStatus, 2000);
  const progressTimer = setInterval(() => {
    log.info(`progress: phase=${phaseStart.name} rounds=${status.roundsDone}/${status.roundsTotal} errors=${status.errorCount} violations=${status.violationCount}`);
  }, 15000);
  writeStatus();

  log.info(`load test '${cfg.label}': ${cfg.games} game(s) x ${cfg.teams} teams x ${cfg.rounds} rounds, pace=${cfg.pace}, seed=${cfg.seed}, target=${cfg.target}`);
  const devicesTotal = cfg.games * (cfg.teams + 2);
  log.info(`simulated devices: ${devicesTotal} (${cfg.teams} teams + manager + display per game), one Realtime socket each`);
  const setupEtaS = Math.round((cfg.games * 60) / cfg.createRate + (cfg.games * cfg.teams * 60) / cfg.joinRate);
  log.info(`setup ETA ~${setupEtaS}s (REST create/join paced under the backend's per-IP rate limits: ${cfg.createRate}/min create, ${cfg.joinRate}/min join)`);

  // Preflight.
  const health = await waitForBackend(env);
  metrics.addLatency("render_warmup", health.warmupMs);
  log.info(`backend healthy in ${health.warmupMs}ms (supabase=${health.supabase})`);
  const { slugs, ids: genreIds } = await resolveGenres(env, cfg.genres);
  cfg.genreIds = genreIds;
  const pool = await countSongPool(env, genreIds);
  log.info(`song pool for [${slugs.join(", ")}]: ~${pool} songs (need ${cfg.rounds}/game)`);
  if (pool < cfg.rounds * 2) {
    throw new LoadError(`song pool too small (${pool}) for ${cfg.rounds} rounds — pick more genres via --genres`);
  }
  const liveGames = await warnIfLiveGames(env);

  const pacers = {
    create: new Pacer(cfg.createRate, "create"),
    join: new Pacer(cfg.joinRate, "join"),
    mgrRest: new Pacer(cfg.mgrRate, "mgrRest"),
  };

  const drivers = Array.from(
    { length: cfg.games },
    (_, i) =>
      new GameDriver({
        index: i + 1,
        cfg,
        env,
        pacers,
        metrics,
        log,
        registry,
        seed: cfg.seed + (i + 1) * 7919,
      }),
  );

  // SIGINT: end every created game before exiting, so nothing lingers.
  let interrupted = false;
  process.on("SIGINT", async () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    log.warn("SIGINT — ending created games then exiting");
    for (const d of drivers) await d.end().catch(() => {});
    writeStatus();
    process.exit(130);
  });

  // ---- SETUP (all games created+joined+subscribed before any play starts,
  // so the play phase is a true N-concurrent-games window) ----
  nextPhase("setup");
  await Promise.all(
    drivers.map(async (d) => {
      try {
        await d.setup();
        status.gamesCreated += 1;
        status.teamsJoined += d.roster.length;
      } catch (err) {
        d.failReason = `setup: ${err.message}`;
        d.error(`setup failed: ${err.message}`);
      }
    }),
  );
  const playable = drivers.filter((d) => !d.failReason);
  log.info(`setup complete: ${playable.length}/${drivers.length} games ready`);

  // Expectation sweeper (miss accounting).
  const sweeper = setInterval(() => {
    for (const d of drivers) d.sweepExpectations();
  }, 1000);

  // ---- PLAY ----
  nextPhase("play");
  await Promise.all(
    playable.map(async (d, i) => {
      await sleep(i * 150 + Math.floor(d.rng() * 2000)); // slight round-loop stagger
      try {
        await d.play(forcedFlows, () => {
          status.roundsDone += 1;
        });
      } catch (err) {
        d.failReason = `play (round ${d.roundsDone + 1}): ${err.message}`;
        d.error(`play failed: ${err.message}`);
      }
    }),
  );

  // Let in-flight Realtime events land, then close the books on misses.
  nextPhase("flush");
  await sleep(11000);
  clearInterval(sweeper);
  for (const d of drivers) d.sweepExpectations(true);

  // ---- VERIFY + TEARDOWN ----
  nextPhase("verify");
  for (const d of drivers) {
    if (d.code) await d.verifyFinalScores().catch((err) => d.error(`verify failed: ${err.message}`));
  }
  nextPhase("teardown");
  for (const d of drivers) await d.end();
  await Promise.all(drivers.map((d) => d.closeDevices()));

  // ---- REPORT ----
  nextPhase("report");
  const games = drivers.map((d) => d.snapshot());
  const flowHistogram = {};
  for (const g of games) {
    for (const [k, v] of Object.entries(g.flowHistogram)) flowHistogram[k] = (flowHistogram[k] || 0) + v;
  }
  const totalActions = metrics.counters.get("actions") || 0;
  const verdict = metrics.summarize({ games, totalActions });
  const notes = [
    `All traffic left one machine/IP: REST setup was paced under the backend's per-IP limits (create ${cfg.createRate}/min, join ${cfg.joinRate}/min) — real parties on distinct phones/IPs never share those buckets, so setup pacing here is a harness artifact, not a product limit. 429s seen: ${metrics.counters.get("rest:429") || 0}.`,
    `Realtime devices attempted: ${devicesTotal}. Subscribe failures usually mean the Supabase plan's concurrent-connection quota, not an app bug.`,
    `Latencies include this machine's RTT to Supabase (Frankfurt) / Render; treat thresholds as advisory and read the distributions.`,
    liveGames > 0 ? `Preflight saw ${liveGames} live game(s) on the target — results may include a real party's traffic.` : `Preflight saw no live games on the target.`,
    `Hot-path RPC 429s are impossible by design (PostgREST direct, no backend limiter); only REST setup shares the one-IP buckets.`,
  ];
  const config = { ...cfg, genreIds: undefined };
  phases.push({ name: phaseStart.name, ms: Date.now() - phaseStart.t });

  const reportMd = renderReportMd({ label: cfg.label, config, phases, verdict, metrics, games, flowHistogram, notes });
  fs.writeFileSync(path.join(runDir, "report.md"), reportMd);
  fs.writeFileSync(
    path.join(runDir, "report.json"),
    JSON.stringify(
      {
        label: cfg.label,
        config,
        phases,
        verdict,
        latencies: metrics.latencyTable(),
        realtime: metrics.rtTable(),
        counters: Object.fromEntries(metrics.counters),
        violations: metrics.violations,
        errors: metrics.errors,
        anomalies: metrics.anomalies,
        games,
        flowHistogram,
        notes,
      },
      null,
      2,
    ),
  );

  status.done = true;
  status.verdict = verdict.overall;
  clearInterval(statusTimer);
  clearInterval(progressTimer);
  writeStatus();

  log.info(`report: ${path.join(runDir, "report.md")}`);
  log.info(`LOADTEST COMPLETE verdict=${verdict.overall} label=${cfg.label}`);
  return verdict.overall === "FAIL" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// cleanup: end any leftover games from a previous (crashed/killed) run.

async function cleanup(values) {
  if (!values.dir) throw new LoadError("cleanup needs --dir <run results dir>");
  const file = path.join(values.dir, "games.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const env = resolveEnv(values.target);
  let ended = 0;
  for (const g of data.games) {
    if (g.ended) continue;
    const res = await fetchJson(`${env.apiUrl}/games/${g.code}/end`, {
      method: "POST",
      headers: { "X-Manager-Token": g.manager_token },
    });
    log.info(`end ${g.code}: HTTP ${res.status}${res.status === 404 || res.status === 410 ? " (already gone)" : ""}`);
    if ([200, 404, 410].includes(res.status)) {
      g.ended = true;
      ended += 1;
    }
    await sleep(700); // stay under the manager-REST limit
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  log.info(`cleanup done: ${ended} game(s) resolved`);
  return 0;
}

// ---------------------------------------------------------------------------

async function main() {
  const { command, values } = parseCli();
  if (command === "run") return runLoadTest(values);
  if (command === "smoke") {
    // Tiny end-to-end validation: 1 game, 3 teams, every flow exactly once,
    // fast pace, kick + bonus exercised. Safe to run any time (self-cleaning).
    return runLoadTest(
      {
        ...values,
        label: values.label || "smoke",
        games: "1",
        teams: "3",
        rounds: String(SMOKE_FLOW_SEQUENCE.length),
        pace: "fast",
        kick: true,
        seed: values.seed || "7",
      },
      { forcedFlows: SMOKE_FLOW_SEQUENCE },
    );
  }
  if (command === "cleanup") return cleanup(values);
  throw new LoadError(`unknown command: ${command} (expected run | smoke | cleanup)`);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error(err.stack || String(err));
    process.exit(2);
  });
