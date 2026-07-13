#!/usr/bin/env python3
"""Generate the "Sound Clash - Vitals" Grafana dashboard JSON.

This is the source of truth for observability/dashboards/sound-clash-vitals.json.
Editing the JSON by hand is fine for one-offs, but prefer editing this generator
and re-running it so the layout stays consistent:

    python observability/dashboards/generate_vitals_dashboard.py

Every query below was validated against the LIVE Grafana Cloud stack
(prudentcurrant2518.grafana.net) on 2026-07-12 using the read-only Grafana MCP,
against real Faro telemetry from https://www.soundclash.org. See
observability/README.md for the validation notes and datasource UIDs.

Stdlib only - no dependencies.
"""

from __future__ import annotations

import json
import pathlib

LOKI = {"type": "loki", "uid": "grafanacloud-logs"}
TEMPO = {"type": "tempo", "uid": "grafanacloud-traces"}

# Faro's Loki lines are logfmt (NOT json). The message/event/measurement body is
# a top-level field; every context.* key the app attaches is prefixed context_,
# and every faro event_data.* key is prefixed event_data_. Only kind /
# detected_level / service_name are stream labels; the rest need `| logfmt`.
SVC = '{service_name="sound-clash-web"}'
LOG = '{service_name="sound-clash-web", kind="log"}'
EVENT = '{service_name="sound-clash-web", kind="event"}'
MEAS = '{service_name="sound-clash-web", kind="measurement"}'
EXC = '{service_name="sound-clash-web", kind="exception"}'

_panel_id = 0


def next_id() -> int:
    global _panel_id
    _panel_id += 1
    return _panel_id


def loki_target(expr, ref="A", legend=None, instant=False):
    t = {
        "refId": ref,
        "datasource": LOKI,
        "expr": expr,
        "queryType": "instant" if instant else "range",
        "editorMode": "code",
    }
    if legend is not None:
        t["legendFormat"] = legend
    return t


def tempo_target(query, ref="A", legend=None):
    # A TraceQL query containing a metrics pipe (| quantile_over_time / | rate)
    # makes the Tempo datasource return a time series.
    t = {
        "refId": ref,
        "datasource": TEMPO,
        "queryType": "traceql",
        "query": query,
        "filters": [],
    }
    if legend is not None:
        t["legendFormat"] = legend
    return t


def gridpos(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def row(title, y):
    return {
        "id": next_id(),
        "type": "row",
        "title": title,
        "collapsed": False,
        "gridPos": gridpos(0, y, 24, 1),
        "panels": [],
    }


def timeseries(title, targets, gp, ds, unit="short", desc="", draw="line",
               stack=False, fill=0, thresholds=None, legend_table=False,
               min0=True):
    custom = {
        "drawStyle": draw,
        "fillOpacity": fill if draw == "line" else (70 if draw == "bars" else fill),
        "lineWidth": 2 if draw == "line" else 1,
        "showPoints": "never" if draw == "line" else "auto",
        "spanNulls": True,
        "stacking": {"mode": "normal" if stack else "none", "group": "A"},
        "axisPlacement": "auto",
    }
    fc = {
        "defaults": {
            "unit": unit,
            "custom": custom,
            "color": {"mode": "palette-classic"},
        },
        "overrides": [],
    }
    if min0:
        fc["defaults"]["min"] = 0
    if thresholds:
        fc["defaults"]["thresholds"] = {"mode": "absolute", "steps": thresholds}
        fc["defaults"]["custom"]["thresholdsStyle"] = {"mode": "line"}
    return {
        "id": next_id(),
        "type": "timeseries",
        "title": title,
        "description": desc,
        "datasource": ds,
        "gridPos": gp,
        "fieldConfig": fc,
        "options": {
            "legend": {
                "displayMode": "table" if legend_table else "list",
                "placement": "bottom",
                "calcs": ["lastNotNull", "max"] if legend_table else [],
            },
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "targets": targets,
    }


def stat(title, targets, gp, ds, unit="short", desc="", thresholds=None,
         novalue=None, color_mode="value", graph=False):
    fc = {
        "defaults": {
            "unit": unit,
            "color": {"mode": "thresholds" if thresholds else "fixed",
                      "fixedColor": "text"},
        },
        "overrides": [],
    }
    if thresholds:
        fc["defaults"]["thresholds"] = {"mode": "absolute", "steps": thresholds}
    if novalue is not None:
        fc["defaults"]["noValue"] = novalue
    return {
        "id": next_id(),
        "type": "stat",
        "title": title,
        "description": desc,
        "datasource": ds,
        "gridPos": gp,
        "fieldConfig": fc,
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "auto",
            "colorMode": color_mode,
            "graphMode": "area" if graph else "none",
            "textMode": "auto",
            "justifyMode": "auto",
        },
        "targets": targets,
    }


def logs(title, targets, gp, ds, desc=""):
    return {
        "id": next_id(),
        "type": "logs",
        "title": title,
        "description": desc,
        "datasource": ds,
        "gridPos": gp,
        "options": {
            "showTime": True,
            "showLabels": False,
            "wrapLogMessage": True,
            "prettifyLogMessage": False,
            "enableLogDetails": True,
            "dedupStrategy": "none",
            "sortOrder": "Descending",
        },
        "targets": targets,
    }


def thr(*steps):
    # steps: list of (value_or_None, color)
    return [{"value": v, "color": c} for v, c in steps]


panels = []
y = 0

# ---------------------------------------------------------------- Overview row
panels.append(row("Overview", y)); y += 1
panels.append(stat(
    "Buzz e2e p95",
    [tempo_target('{ name = "game.buzz.e2e" } | quantile_over_time(duration, .95)', legend="p95")],
    gridpos(0, y, 5, 4), TEMPO, unit="s", color_mode="background",
    desc="Click-to-confirmed buzz round-trip (includes Realtime fan-out). The <200ms budget is the buzz_in RPC itself; e2e is naturally larger.",
    thresholds=thr((None, "green"), (0.6, "yellow"), (1.2, "red"))))
panels.append(stat(
    "Fan-out p95",
    [loki_target(
        'quantile_over_time(0.95, ' + EVENT + ' |= "realtime_fanout" | logfmt | unwrap event_data_fanout_ms [$__range])',
        legend="p95", instant=True)],
    gridpos(5, y, 5, 4), LOKI, unit="ms", color_mode="background",
    desc="Postgres commit -> client receipt over Supabase Realtime (all event types).",
    thresholds=thr((None, "green"), (500, "yellow"), (1000, "red"))))
panels.append(stat(
    "Stale-lock repairs (range)",
    [loki_target(
        'sum(count_over_time(' + LOG + ' |= "stale_buzz_lock_resynced" [$__range]))',
        legend="repairs", instant=True)],
    gridpos(10, y, 5, 4), LOKI, unit="short", color_mode="background", novalue="0",
    desc="#254 watch signal: dropped Realtime lock events that the client detected and self-healed. A handful across many games is normal; a cluster in ONE game is an incident.",
    thresholds=thr((None, "green"), (3, "yellow"), (10, "red"))))
panels.append(stat(
    "Active sessions (range)",
    [loki_target('count(sum by (session_id) (count_over_time(' + SVC + ' | logfmt [$__range])))',
                 legend="sessions", instant=True)],
    gridpos(15, y, 4, 4), LOKI, unit="short", novalue="0",
    desc="Distinct Faro session_ids seen in the selected range (players + hosts + displays)."))
panels.append(stat(
    "Exceptions (range)",
    [loki_target('sum(count_over_time(' + EXC + ' [$__range]))', ref="A", legend="exceptions", instant=True),
     loki_target('sum(count_over_time(' + SVC + ' | logfmt | level="error" [$__range]))', ref="B", legend="errors", instant=True)],
    gridpos(19, y, 5, 4), LOKI, unit="short", color_mode="background", novalue="0",
    desc="Faro exceptions (kind=exception) plus error-level logs.",
    thresholds=thr((None, "green"), (1, "yellow"), (5, "red"))))
y += 4

# ------------------------------------------------- Buzzer & scoring (Tempo)
panels.append(row("Buzzer & scoring latency (Tempo traces)", y)); y += 1
panels.append(timeseries(
    "Buzz e2e latency (game.buzz.e2e)",
    [tempo_target('{ name = "game.buzz.e2e" } | quantile_over_time(duration, .5, .95, .99)', legend="{{p}}")],
    gridpos(0, y, 12, 8), TEMPO, unit="s",
    desc="End-to-end buzz: button press -> lock confirmed back over Realtime. Segmented into p50/p95/p99.",
    thresholds=thr((None, "transparent"), (0.2, "orange"))))
panels.append(timeseries(
    "Score e2e latency (game.score.e2e)",
    [tempo_target('{ name = "game.score.e2e" } | quantile_over_time(duration, .5, .95)', legend="{{p}}")],
    gridpos(12, y, 12, 8), TEMPO, unit="s",
    desc="Manager verdict click -> score change confirmed over Realtime. NOTE: no prod scoring traffic in the 2026-07-12 validation window; panel populates once real games score. Query is identical in shape to the validated buzz e2e panel."))
y += 8
panels.append(timeseries(
    "DB RPC latency by function (db.rpc p95)",
    [tempo_target('{ name = "db.rpc" } | quantile_over_time(duration, .95) by (span.rpc.name)')],
    gridpos(0, y, 12, 8), TEMPO, unit="s",
    desc="Browser-direct PostgREST RPC latency (buzz_in, select_next_song, peek_next_song, award_attempt, release_buzz_lock, extend_game).",
    legend_table=True))
panels.append(timeseries(
    "Buzz throughput by outcome (game.buzz.e2e rate)",
    [tempo_target('{ name = "game.buzz.e2e" } | rate() by (span.outcome)')],
    gridpos(12, y, 12, 8), TEMPO, unit="reqps",
    desc="Buzzes per second split by outcome: won / lost_race / error.",
    draw="bars", stack=True, legend_table=True))
y += 8

# ------------------------------------------------------ Song start (Tempo)
panels.append(row("Song start (Tempo traces)", y)); y += 1
panels.append(timeseries(
    "Song-start latency by preloaded (game.song_start)",
    [tempo_target('{ name = "game.song_start" } | quantile_over_time(duration, .5, .95) by (span.preloaded)')],
    gridpos(0, y, 12, 8), TEMPO, unit="s",
    desc="Next-song click -> audio playing, grouped by whether the next YouTube video was prebuffered (span.preloaded true/false). This quantifies the prebuffer win.",
    legend_table=True))
panels.append(timeseries(
    "Song-start stage breakdown (p95)",
    [tempo_target('{ name =~ "game.song_start.click_to_rpc|game.song_start.rpc_to_load|game.song_start.load_to_playing" } | quantile_over_time(duration, .95) by (name)')],
    gridpos(12, y, 12, 8), TEMPO, unit="s",
    desc="Where song-start time goes: click_to_rpc (optimistic UI) vs rpc_to_load (select_next_song) vs load_to_playing (YouTube).",
    legend_table=True))
y += 8

# ------------------------------------------------------ Realtime health (Loki)
panels.append(row("Realtime health & #254 dropped-event repairs (Loki)", y)); y += 1
panels.append(timeseries(
    "Realtime fan-out lag by event type",
    [loki_target(
        'quantile_over_time(0.95, ' + EVENT + ' |= "realtime_fanout" | logfmt | unwrap event_data_fanout_ms [$__interval]) by (event_data_event_type)',
        ref="A", legend="p95 {{event_data_event_type}}"),
     loki_target(
        'quantile_over_time(0.50, ' + EVENT + ' |= "realtime_fanout" | logfmt | unwrap event_data_fanout_ms [$__interval])',
        ref="B", legend="p50 (all)")],
    gridpos(0, y, 12, 8), LOKI, unit="ms",
    desc="Commit->receipt latency of active_games / game_teams / game_rounds row changes fanned out over Realtime.",
    legend_table=True))
panels.append(timeseries(
    "#254 - stale buzz-lock repairs by game_code",
    [loki_target(
        'sum by (context_game_code) (count_over_time(' + LOG + ' |= "stale_buzz_lock_resynced" | logfmt [$__interval]))',
        legend="{{context_game_code}}")],
    gridpos(12, y, 12, 8), LOKI, unit="short",
    desc="Each bar = a dropped Realtime lock event that a client self-healed. >=3 in a 30m window for ONE game_code is the incident threshold that pages email + files a GitHub issue.",
    draw="bars", stack=True, legend_table=True))
y += 8
panels.append(timeseries(
    "Realtime disconnects by game_code",
    [loki_target(
        'sum by (context_game_code) (count_over_time(' + LOG + ' |= "realtime_disconnect" | logfmt [$__interval]))',
        legend="{{context_game_code}}")],
    gridpos(0, y, 12, 8), LOKI, unit="short",
    desc="Realtime channel drops (CHANNEL_ERROR / TIMED_OUT). Correlate spikes with the stale-lock repairs panel.",
    draw="bars", stack=True, legend_table=True))
panels.append(logs(
    "Recent stale buzz-lock repairs",
    [loki_target(
        LOG + ' |= "stale_buzz_lock_resynced" | logfmt | line_format "game={{.context_game_code}} stale={{.context_stale_team}} fresh={{.context_fresh_team}} session={{.session_id}} page={{.page_id}}"')],
    gridpos(12, y, 12, 8), LOKI,
    desc="Raw #254 repair events with the stale/fresh team pair and the session that healed it."))
y += 8

# ------------------------------------------------------ Web Vitals (Loki)
panels.append(row("Web Vitals (Loki, p75 - Core Web Vitals reporting standard)", y)); y += 1
wv_trend = [
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "lcp=" | logfmt | unwrap lcp [$__interval])', ref="A", legend="LCP p75"),
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "inp=" | logfmt | unwrap inp [$__interval])', ref="B", legend="INP p75"),
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "fcp=" | logfmt | unwrap fcp [$__interval])', ref="C", legend="FCP p75"),
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "ttfb=" | logfmt | unwrap ttfb [$__interval])', ref="D", legend="TTFB p75"),
]
panels.append(timeseries(
    "Core Web Vitals p75 trend (LCP / INP / FCP / TTFB)",
    wv_trend, gridpos(0, y, 12, 8), LOKI, unit="ms",
    desc="Faro's built-in web-vitals, p75 per metric (the Google reporting percentile).",
    legend_table=True))
wv_now = [
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "lcp=" | logfmt | unwrap lcp [$__range])', ref="A", legend="LCP", instant=True),
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "inp=" | logfmt | unwrap inp [$__range])', ref="B", legend="INP", instant=True),
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "fcp=" | logfmt | unwrap fcp [$__range])', ref="C", legend="FCP", instant=True),
    loki_target('quantile_over_time(0.75, ' + MEAS + ' |= "ttfb=" | logfmt | unwrap ttfb [$__range])', ref="D", legend="TTFB", instant=True),
]
wv_stat = stat(
    "Web Vitals now (p75, range)", wv_now, gridpos(12, y, 12, 8), LOKI, unit="ms",
    desc="Current p75 per Core Web Vital. Colour thresholds follow Google's good/needs-improvement cutoffs.",
    color_mode="background", novalue="-")
wv_stat["fieldConfig"]["overrides"] = [
    {"matcher": {"id": "byFrameRefID", "options": "A"},
     "properties": [{"id": "thresholds", "value": {"mode": "absolute", "steps": thr((None, "green"), (2500, "yellow"), (4000, "red"))}}]},
    {"matcher": {"id": "byFrameRefID", "options": "B"},
     "properties": [{"id": "thresholds", "value": {"mode": "absolute", "steps": thr((None, "green"), (200, "yellow"), (500, "red"))}}]},
    {"matcher": {"id": "byFrameRefID", "options": "C"},
     "properties": [{"id": "thresholds", "value": {"mode": "absolute", "steps": thr((None, "green"), (1800, "yellow"), (3000, "red"))}}]},
    {"matcher": {"id": "byFrameRefID", "options": "D"},
     "properties": [{"id": "thresholds", "value": {"mode": "absolute", "steps": thr((None, "green"), (800, "yellow"), (1800, "red"))}}]},
]
panels.append(wv_stat)
y += 8

# ------------------------------------------------------ Traffic & errors (Loki)
panels.append(row("Traffic & errors (Loki)", y)); y += 1
panels.append(timeseries(
    "Signal volume by kind",
    [loki_target('sum by (kind) (count_over_time(' + SVC + ' [$__interval]))', legend="{{kind}}")],
    gridpos(0, y, 8, 8), LOKI, unit="short",
    desc="Telemetry throughput split by Faro signal kind (event / log / measurement / exception). A proxy for live activity.",
    draw="bars", stack=True, legend_table=True))
panels.append(timeseries(
    "Warnings by type",
    [loki_target('sum by (message) (count_over_time(' + LOG + ' | logfmt | level="warn" [$__interval]))', legend="{{message}}")],
    gridpos(8, y, 8, 8), LOKI, unit="short",
    desc="warn-level logs by message: realtime_disconnect, stale_buzz_lock_resynced, yt_player_error, yt_preload_error, preload_peek_failed.",
    draw="bars", stack=True, legend_table=True))
panels.append(timeseries(
    "Exceptions & errors",
    [loki_target('sum(count_over_time(' + EXC + ' [$__interval]))', ref="A", legend="exceptions"),
     loki_target('sum(count_over_time(' + SVC + ' | logfmt | level="error" [$__interval]))', ref="B", legend="error logs")],
    gridpos(16, y, 8, 8), LOKI, unit="short",
    desc="Faro exceptions and error-level logs over time.",
    draw="bars", stack=True))
y += 8
panels.append(logs(
    "Recent warnings & errors",
    [loki_target(SVC + ' | logfmt | level=~"warn|error"')],
    gridpos(0, y, 24, 8), LOKI,
    desc="Tail of warn/error logs across the app."))
y += 8

dashboard = {
    "uid": "sound-clash-vitals",
    "title": "Sound Clash - Vitals",
    "description": "I-Vitals (T1.7): buzz/score/song-start latency (Tempo), Realtime fan-out & #254 dropped-event repairs, Web Vitals, sessions and exceptions from Faro telemetry (service_name=sound-clash-web).",
    "tags": ["sound-clash", "vitals", "faro", "i-vitals"],
    "timezone": "utc",
    "schemaVersion": 39,
    "version": 1,
    "editable": True,
    "graphTooltip": 1,
    "refresh": "1m",
    "time": {"from": "now-6h", "to": "now"},
    "timepicker": {"refresh_intervals": ["30s", "1m", "5m", "15m", "1h"]},
    "annotations": {"list": [{
        "builtIn": 1, "datasource": {"type": "grafana", "uid": "-- Grafana --"},
        "enable": True, "hide": True, "name": "Annotations & Alerts", "type": "dashboard",
    }]},
    "templating": {"list": []},
    "panels": panels,
}

out = pathlib.Path(__file__).with_name("sound-clash-vitals.json")
out.write_text(json.dumps(dashboard, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"wrote {out} ({len(panels)} panels, {out.stat().st_size} bytes)")
