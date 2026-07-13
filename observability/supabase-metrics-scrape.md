# Supabase metrics scrape — LIVE (setup + alerts)

The I-Vitals request for a **Realtime connections + message-quota** alert led
here: those signals aren't in Faro (the browser can't see a connection it was
*refused*), so the authoritative source is **Supabase's own Prometheus metrics
endpoint**.

**Status: ✅ scraped as of 2026-07-13.** A hosted Grafana Cloud "Metrics
Endpoint" job (`supabase-soundclash`) ingests it into `grafanacloud-prom`
(`count(up)=1`). Setup below for reference/rebuild; the confirmed metrics and the
buildable alert are in §3–§4. **Caveat that survived the scrape:** the exact
"≥150/200 concurrent connections" and "2M msg/month quota" numbers are still
**not** exported — see §3.

> _History: before 2026-07-12 `grafanacloud-prom` held only
> `grafanacloud_feo11y_app_info` (Faro-derived); no Supabase series. The scrape
> job below fixed that._

## What to configure (secrets stay with you)

### 1. Supabase privileged metrics endpoint

Supabase exposes a Prometheus endpoint per project:

```
https://jvfddxuaqcsrguibkymp.supabase.co/customer/v1/privileged/metrics
```

Auth is **HTTP Basic**:
- username: `service_role`
- password: the project's **service-role key** (the same `sb_secret_…` /
  service-role JWT you already hold; do **not** put it in this repo).

Quick sanity check from your machine (do not paste the key into anything shared):

```bash
curl -sS --user "service_role:$SUPABASE_SERVICE_ROLE_KEY" \
  https://jvfddxuaqcsrguibkymp.supabase.co/customer/v1/privileged/metrics | head -50
# then see which realtime/connection series exist:
curl -sS --user "service_role:$SUPABASE_SERVICE_ROLE_KEY" \
  https://jvfddxuaqcsrguibkymp.supabase.co/customer/v1/privileged/metrics \
  | grep -iE 'realtime|client|connection|max_connections|pg_stat_activity' | grep -v '^#' | sort | head -40
```

### 2. Grafana Cloud "Metrics Endpoint" scrape job

In Grafana Cloud: **Connections → Add new connection → "Metrics Endpoint"**
(hosted scraper; no agent to run). Configure:

| Field | Value |
|---|---|
| Job / integration name | `supabase-soundclash` |
| Scrape URL | `https://jvfddxuaqcsrguibkymp.supabase.co/customer/v1/privileged/metrics` |
| Authentication | Basic auth |
| Username | `service_role` |
| Password | *(service-role key — entered into Grafana Cloud's secret field, stays with you)* |
| Scrape interval | `60s` |
| Metrics prefix / labels | add label `project=soundclash` for tidiness |

Grafana Cloud stores the credential in the integration config; it never touches
this repo or the dashboard/alert JSON.

> Alternative if you prefer running your own collector: a Grafana Alloy /
> `prometheus.scrape` job with the same URL + `basic_auth` block, remote-writing
> to `grafanacloud-prom`. The hosted "Metrics Endpoint" integration is simpler
> and needs nothing self-hosted.

### 3. What the endpoint actually exposes (CONFIRMED 2026-07-13)

Scrape is **live** (hosted "Metrics Endpoint" job `supabase-soundclash`, 60s);
all series land in `grafanacloud-prom` labelled `scrape_job="supabase-soundclash"`.
Verified against the live scrape (`count(up)=1`):

**Key finding — the endpoint does NOT export a raw "Realtime concurrent
WebSocket connections" gauge or a monthly-message-quota counter.** Those two
numbers (the ~200 connection cap + the 2M msg/month quota) live only in the
Supabase dashboard:
<https://supabase.com/dashboard/project/jvfddxuaqcsrguibkymp/reports/realtime>.

What IS exported (the useful signals):

| Metric | Meaning | Now (idle) |
|---|---|---|
| `realtime_postgres_changes_total_subscriptions` | Realtime postgres_changes subscription load — best available Realtime-load proxy | `0` |
| `realtime_postgres_changes_client_subscriptions` | per-client subscription count | `0` |
| `connection_stats_connection_count{username=…}` | Postgres backends by role (sum for total) | ~4 |
| `max_connections_connection_count` | Postgres `max_connections` — **only 60** | `60` |
| `pgbouncer_used_clients` / `pgbouncer_config_max_client_connections` | pooler client saturation | `1 / 200` |

Plus the full node_exporter/pgbouncer/Postgres set (CPU/mem/disk) — the
integration installs its own dashboards for those (View Dashboards on the
connection).

### 4. Alert rule (buildable + validated)

The strong, precise signal is **DB connection saturation** — `max_connections`
is only **60**, so a busy party can approach it and break *everything*. Add this
to the `sound-clash-vitals` group (query validated live: it read `8.3` at idle):

```yaml
      - uid: sc_db_connection_saturation
        title: "Sound Clash - Postgres connections saturating (>80% of 60)"
        condition: C
        for: 5m
        noDataState: OK
        execErrState: Error
        labels: { team: sound-clash, severity: page, issue: db-connections }
        annotations:
          summary: "Postgres connections at {{ humanize $values.B.Value }}% of max_connections (60)."
          description: "Sustained >80% DB connection usage. The ceiling is only 60; new queries start being refused near it and gameplay breaks."
        data:
          - refId: A
            relativeTimeRange: { from: 300, to: 0 }
            datasourceUid: grafanacloud-prom
            model:
              refId: A
              datasource: { type: prometheus, uid: grafanacloud-prom }
              # Aggregate BOTH sides — sum(x)/max_connections... returns empty
              # (no shared labels to match on); sum both -> label-free match.
              expr: '100 * sum(connection_stats_connection_count) / sum(max_connections_connection_count)'
              instant: true
          - refId: B
            datasourceUid: __expr__
            model: { refId: B, type: reduce, expression: A, reducer: last, datasource: { type: __expr__, uid: __expr__ } }
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: B
              datasource: { type: __expr__, uid: __expr__ }
              conditions: [ { evaluator: { type: gt, params: [80] } } ]
```

Route it to the same `email-benartzi` contact point (`team: sound-clash`).

**Realtime-load proxy alert (optional, needs calibration).** There's no true
connection gauge, but `realtime_postgres_changes_total_subscriptions` climbs with
crowd size. It reads `0` idle, so pick the threshold *during a real game*: run a
big session, read the peak in Grafana Explore, and alert at ~1.5×. Same rule
shape, `expr: 'realtime_postgres_changes_total_subscriptions'`, threshold
`gt <peak×1.5>`.

To add a gauge to the Vitals dashboard, drop a Prometheus stat/gauge panel into
`generate_vitals_dashboard.py` pointed at
`100 * sum(connection_stats_connection_count) / sum(max_connections_connection_count)`
(unit percent, thresholds 60/80).
