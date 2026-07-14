// Metrics collection + verdicts + report rendering.
//
// Three Realtime "families" are measured end-to-end (t0 = the moment the
// triggering RPC is fired, t1 = the postgres_changes event arriving at each
// subscribed simulated device — i.e. what a real player would perceive):
//   lock_set     buzz pressed -> everyone sees the buzz lock
//   round_insert next round   -> everyone sees the new round
//   score_update award        -> everyone sees the score change

import { summarizeLatencies } from "./util.mjs";

// Advisory thresholds: [PASS-max, WARN-max] in ms (beyond WARN-max = FAIL).
// The real deliverable is the distribution table; these encode "would a
// player at a party notice".
const LATENCY_THRESHOLDS = {
  "rpc:buzz_in": [350, 700],
  "rpc:award_attempt": [500, 1000],
  "rpc:select_next_song": [700, 1500],
};
const RT_THRESHOLDS = {
  lock_set: [1200, 2500],
  round_insert: [1500, 3000],
  score_update: [1500, 3000],
};
const RT_MISS_RATE = [0.005, 0.02]; // PASS <= 0.5%, WARN <= 2%

export class Metrics {
  constructor() {
    this.latencies = new Map(); // name -> number[]
    this.rt = new Map(); // family -> { dts: number[], misses: number, expected: number }
    this.errors = []; // { where, message, fatal }
    this.anomalies = []; // soft oddities worth reading, not verdict-driving
    this.violations = []; // invariant breaches -> hard FAIL
    this.counters = new Map(); // name -> number
  }

  addLatency(name, ms) {
    if (!this.latencies.has(name)) this.latencies.set(name, []);
    this.latencies.get(name).push(ms);
  }

  rtFamily(family) {
    if (!this.rt.has(family)) this.rt.set(family, { dts: [], misses: 0, expected: 0 });
    return this.rt.get(family);
  }
  addRtDelivery(family, ms) {
    const f = this.rtFamily(family);
    f.dts.push(ms);
    f.expected += 1;
  }
  addRtMiss(family) {
    const f = this.rtFamily(family);
    f.misses += 1;
    f.expected += 1;
  }

  bump(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + by);
  }

  addError(where, message) {
    this.errors.push({ where, message });
  }
  addAnomaly(message) {
    this.anomalies.push(message);
  }
  addViolation(where, message) {
    this.violations.push({ where, message });
  }

  // ---- verdicts ---------------------------------------------------------

  summarize({ games, totalActions }) {
    const checks = [];
    const grade = (name, value, [passMax, warnMax], unit = "ms") => {
      if (value === null || value === undefined) return;
      const level = value <= passMax ? "PASS" : value <= warnMax ? "WARN" : "FAIL";
      checks.push({ name, level, value: `${unit === "ms" ? Math.round(value) : value}${unit}` });
    };

    checks.push({
      name: "invariants (race winners, scores, round counts)",
      level: this.violations.length === 0 ? "PASS" : "FAIL",
      value: `${this.violations.length} violations`,
    });

    const failedGames = games.filter((g) => !g.completed).length;
    checks.push({
      name: "all games completed all rounds and ended",
      level: failedGames === 0 ? "PASS" : "FAIL",
      value: `${games.length - failedGames}/${games.length} games`,
    });

    for (const [name, th] of Object.entries(LATENCY_THRESHOLDS)) {
      const s = summarizeLatencies(this.latencies.get(name) || []);
      if (s) grade(`${name} p95`, s.p95, th);
    }
    for (const [family, th] of Object.entries(RT_THRESHOLDS)) {
      const f = this.rt.get(family);
      if (f && f.dts.length) grade(`realtime ${family} p95`, summarizeLatencies(f.dts).p95, th);
    }

    let rtExpected = 0;
    let rtMisses = 0;
    for (const f of this.rt.values()) {
      rtExpected += f.expected;
      rtMisses += f.misses;
    }
    if (rtExpected > 0) {
      const rate = rtMisses / rtExpected;
      const level = rate <= RT_MISS_RATE[0] ? "PASS" : rate <= RT_MISS_RATE[1] ? "WARN" : "FAIL";
      checks.push({
        name: "realtime delivery misses (event not seen within 10s)",
        level,
        value: `${rtMisses}/${rtExpected} (${(rate * 100).toFixed(2)}%)`,
      });
    }

    const subFailed = this.counters.get("subscribe:failed") || 0;
    const subOk = this.counters.get("subscribe:ok") || 0;
    checks.push({
      name: "realtime subscriptions established",
      // Failures here are a CAPACITY finding (plan quota), not a code bug.
      level: subFailed === 0 ? "PASS" : "WARN",
      value: `${subOk} ok / ${subFailed} failed`,
    });

    const unexpectedErrors = this.errors.length;
    const errRate = totalActions > 0 ? unexpectedErrors / totalActions : 0;
    checks.push({
      name: "unexpected errors",
      level: unexpectedErrors === 0 ? "PASS" : errRate <= 0.005 ? "WARN" : "FAIL",
      value: `${unexpectedErrors} (${(errRate * 100).toFixed(2)}% of ${totalActions} actions)`,
    });

    const overall = checks.some((c) => c.level === "FAIL")
      ? "FAIL"
      : checks.some((c) => c.level === "WARN")
        ? "WARN"
        : "PASS";
    return { overall, checks };
  }

  latencyTable() {
    const rows = [];
    for (const [name, vals] of [...this.latencies.entries()].sort()) {
      const s = summarizeLatencies(vals);
      if (s) rows.push({ name, ...s });
    }
    return rows;
  }

  rtTable() {
    const rows = [];
    for (const [family, f] of this.rt.entries()) {
      const s = summarizeLatencies(f.dts) || { count: 0, p50: null, p95: null, p99: null, max: null };
      rows.push({
        family,
        deliveries: f.dts.length,
        misses: f.misses,
        missRate: f.expected ? `${((f.misses / f.expected) * 100).toFixed(2)}%` : "n/a",
        ...s,
      });
    }
    return rows;
  }
}

// ---- report rendering ----------------------------------------------------

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

export function renderReportMd({ label, config, phases, verdict, metrics, games, flowHistogram, notes }) {
  const lines = [];
  lines.push(`# Load test report: ${label}`);
  lines.push("");
  lines.push(`Overall verdict: **${verdict.overall}**`);
  lines.push("");
  lines.push("## Config");
  lines.push("```json");
  lines.push(JSON.stringify(config, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Phases");
  lines.push(mdTable(["phase", "duration"], phases.map((p) => [p.name, `${Math.round(p.ms / 1000)}s`])));
  lines.push("");
  lines.push("## Verdict checks");
  lines.push(mdTable(["check", "level", "value"], verdict.checks.map((c) => [c.name, c.level, c.value])));
  lines.push("");
  lines.push("## RPC / REST latency (ms, from this machine)");
  lines.push(
    mdTable(
      ["operation", "count", "p50", "p95", "p99", "max"],
      metrics.latencyTable().map((r) => [r.name, r.count, r.p50, r.p95, r.p99, r.max]),
    ),
  );
  lines.push("");
  lines.push("## Realtime delivery (action fired -> event seen by a subscribed device, ms)");
  lines.push(
    mdTable(
      ["family", "deliveries", "misses", "miss rate", "p50", "p95", "p99", "max"],
      metrics.rtTable().map((r) => [r.family, r.deliveries, r.misses, r.missRate, r.p50, r.p95, r.p99, r.max]),
    ),
  );
  lines.push("");
  lines.push("## Counters");
  lines.push(
    mdTable(
      ["counter", "value"],
      [...metrics.counters.entries()].sort().map(([k, v]) => [k, v]),
    ),
  );
  lines.push("");
  lines.push("## Per-game results");
  lines.push(
    mdTable(
      ["game", "code", "teams", "rounds", "completed", "final scores verified"],
      games.map((g) => [g.index, g.code || "-", g.teams, `${g.roundsDone}/${g.roundsPlanned}`, g.completed ? "yes" : `NO (${g.failReason || "?"})`, g.scoresVerified ? "yes" : "NO"]),
    ),
  );
  lines.push("");
  lines.push("## Flow coverage");
  lines.push(mdTable(["flow", "rounds"], Object.entries(flowHistogram).map(([k, v]) => [k, v])));
  lines.push("");
  if (metrics.violations.length) {
    lines.push("## Invariant violations");
    for (const v of metrics.violations.slice(0, 50)) lines.push(`- [${v.where}] ${v.message}`);
    lines.push("");
  }
  if (metrics.errors.length) {
    lines.push("## Unexpected errors (first 50)");
    for (const e of metrics.errors.slice(0, 50)) lines.push(`- [${e.where}] ${e.message}`);
    lines.push("");
  }
  if (metrics.anomalies.length) {
    lines.push("## Anomalies (soft, first 50)");
    for (const a of metrics.anomalies.slice(0, 50)) lines.push(`- ${a}`);
    lines.push("");
  }
  lines.push("## Notes / caveats");
  for (const n of notes) lines.push(`- ${n}`);
  lines.push("");
  return lines.join("\n");
}
