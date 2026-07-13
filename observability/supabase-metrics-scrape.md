# Supabase metrics scrape — design (BLOCKED on maintainer config)

The second time-critical alert requested for I-Vitals is **Realtime concurrent
connections ≥150 of the ~200 free-tier cap + message-quota burn**. This alert
**cannot be built yet**, and here is why plus exactly what to configure.

## Why it's blocked

Realtime connection counts and message-quota counters are **not** in Faro
telemetry (Faro only reports what the *browser* sees, and per the standing note
those signals only exist while clients are already healthy — a connection you
were refused never emits a `realtime_fanout`). The authoritative source is
**Supabase's own Prometheus metrics endpoint**, and it is **not currently
scraped** into this Grafana Cloud stack.

Verified 2026-07-12 with the read-only Grafana MCP:

```
list_prometheus_metric_names(grafanacloud-prom, regex=".*(supabase|realtime|postgres|pgbouncer).*")  ->  []
list_prometheus_metric_names(grafanacloud-prom, regex="up|grafanacloud.*")  ->  ["grafanacloud_feo11y_app_info"]
```

`grafanacloud-prom` holds only the Faro-derived frontend-observability metric.
Nothing from Supabase is being ingested. So the connection/quota alert has **no
data to evaluate against** and must not be created until the scrape below is
live.

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

### 3. Confirm the metric names, THEN add the alert

After the first scrape, discover the real series (names vary by Supabase
version, so confirm rather than trust this doc):

```
# via the read-only MCP once data lands:
list_prometheus_metric_names(grafanacloud-prom, regex="realtime|client|connection")
list_prometheus_metric_names(grafanacloud-prom, regex="pg_stat|max_connections")
```

Supabase's endpoint bundles node_exporter + postgres_exporter + service metrics.
Likely candidates for the two signals (verify names against your scrape):

- **Realtime concurrent connections** — a Realtime service gauge such as
  `realtime_connected_clients` / `realtime_channel_subscribers`, **or**, if
  Realtime concurrency isn't exported on the free tier, the DB-side proxy
  `sum(pg_stat_activity_count{...})` for the realtime role. Confirm which exists.
- **Message quota** — Supabase does not export a monthly-quota counter directly;
  approximate burn with the Realtime message-rate series if present
  (`rate(realtime_messages_total[1h])`) and alert on sustained high rate. The
  hard 2M-messages/month cap is best watched in the Supabase dashboard.

### 4. Alert rule to add once the metric name is confirmed

Add this to `alerting-provisioning.yaml` (fix `<METRIC>` to the confirmed name)
in the same `sound-clash-vitals` group. `~200` is the free-tier cap; page at
`150` (75%).

```yaml
      - uid: sc_realtime_connections_cap
        title: "Sound Clash - Realtime connections near free-tier cap (>=150/200)"
        condition: C
        for: 5m
        noDataState: OK
        execErrState: Error
        labels: { team: sound-clash, severity: page, issue: realtime-cap }
        annotations:
          summary: "Realtime connections at {{ humanize $values.B.Value }} of the ~200 free-tier cap."
          description: "Sustained >=150 concurrent Realtime connections. Approaching the free-tier ceiling; new joins will start being refused near 200."
        data:
          - refId: A
            relativeTimeRange: { from: 300, to: 0 }
            datasourceUid: grafanacloud-prom
            model:
              refId: A
              datasource: { type: prometheus, uid: grafanacloud-prom }
              expr: 'max_over_time(<METRIC>[5m])'   # e.g. realtime_connected_clients
              instant: true
          - refId: B
            datasourceUid: __expr__
            model: { refId: B, type: reduce, expression: A, reducer: last,
                     datasource: { type: __expr__, uid: __expr__ } }
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: B
              datasource: { type: __expr__, uid: __expr__ }
              conditions: [ { evaluator: { type: gt, params: [150] } } ]
```

Route it to the same `email-benartzi` contact point (it already carries
`team: sound-clash`, which the notification policy in
`observability/README.md` matches).

Once the scrape is live, the Vitals dashboard can also gain a "Realtime
connections vs 200 cap" gauge — add a Prometheus panel to
`generate_vitals_dashboard.py` pointed at `<METRIC>` with `max: 200` and
thresholds at 150/190.
