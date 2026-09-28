# ScopeDB Grafana data source

Query ScopeDB with ScopeQL from Grafana: tables, labeled time series, dashboard
variables, time macros, and catalog browsing. API keys stay in Grafana's secure
storage; queries run through the Go backend.

## Install

Requires Grafana OSS 13.1.0 on Linux amd64. The plugin is unsigned; Grafana Cloud,
alerting, a dedicated logs mode, and ad hoc filters are unsupported.

1. With Node.js 24, npm 11, Go 1.26.5, and Python 3 installed, run `make build package`.
2. Extract `dist/scopedb-scopedb-datasource-0.1.0.zip` into Grafana's plugins directory, preserving executable permissions.
3. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=scopedb-scopedb-datasource` and restart Grafana (also after upgrades).
4. Add a **ScopeDB** data source, enter the workspace endpoint and API key, then **Save & test**.

The endpoint must be reachable from Grafana. All data source users share the key's
permissions; the plugin does not enforce read-only access.

## Query

Use **Browse tables** to insert a query, or enter ScopeQL and press **Ctrl/Cmd+Enter**:

```sql
FROM events WHERE $__timeFilter(event_time)
SELECT $__timeGroup(event_time) AS time, service
GROUP BY time, service AGGREGATE count() AS events
ORDER BY time LIMIT 10000
```

Choose **Time series** for one timestamp, numeric values, and optional string/boolean
labels. Aggregate to one row per timestamp and label set. **Table** is the default.
`$__timeFilter(column)` uses an inclusive start and exclusive end; `$__timeFrom()` and
`$__timeTo()` return UTC bounds. `$__timeGroup(column[, '5m'])` buckets timestamps;
`$__interval` and `$__interval_ms` expose the automatic bucket width (minimum 1s).

Variables expand outside quotes and comments: `${name}` quotes strings,
`${name:number}` validates numbers, and `${name:identifier}` quotes one identifier.
Use `contains([${service}], service::any)` for multi-select. Query variables use the
first column or `__text` / `__value`; leave **Custom all value** blank for **Include All**.

Limits: 10,000 rows, 16 MiB per query HTTP response, 500 series groups. Timeout is
30s (configurable 1–300s), including queue time; concurrency is 4 (configurable 1–32).
Cancellation attempts to stop the server query; submission is not retried.
Query inspector shows expanded ScopeQL, query ID, timing, rows, and bucket interval.

## Develop

`make build test lint package` builds the plugin, runs Node and Go behavior tests
(with the race detector), checks types/style, and creates the ZIP. Tests need no
workspace credentials. `npm run dev` watches frontend changes. Validate queries and
catalog browsing in Grafana against a development workspace before releasing.
