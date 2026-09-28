# ScopeDB Grafana data source

Query ScopeDB with ScopeQL from Grafana. Supports tables, labeled time series,
dashboard variables, time macros, and catalog browsing. Queries run through the Go
backend; API keys are stored in Grafana's `secureJsonData`.

Targets **Grafana OSS 13.1.0 / Linux amd64**. Unsigned; alerting, a dedicated logs
mode, ad hoc filters, and Grafana Cloud installation are not supported.

## Install

1. Build with `make build && make package` (Node.js 24, npm 11, Go 1.26.5, Python 3).
2. Extract `dist/scopedb-scopedb-datasource-0.1.0.zip` into Grafana's plugins directory. Keep `gpx_scope_db_linux_amd64` executable.
3. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=scopedb-scopedb-datasource` and restart Grafana.
4. Add a **ScopeDB** data source, enter the workspace endpoint and API key, then **Save & test**.

The endpoint must be reachable from Grafana. Save & test runs `SELECT 1 AS ok`.
All data source users share the key's permissions; the plugin does not enforce
read-only access. To upgrade, replace the plugin directory and restart Grafana.

## Query

Click **Browse tables**, select a table, and insert a query template, or enter
ScopeQL directly. **Ctrl/Cmd+Enter** runs the query. The included **Getting started**
dashboard checks the connection without application tables.

```sql
FROM events
WHERE $__timeFilter(event_time)
SELECT $__timeGroup(event_time) AS time, service
GROUP BY time, service AGGREGATE count() AS events
ORDER BY time
LIMIT 10000
```

Choose **Time series** for one timestamp column, numeric values, and optional
string/boolean labels; aggregate duplicate timestamps per label set. **Table** is
the default. See the [query reference](https://github.com/scopedb/scopedb-grafana/blob/main/docs/queries.md)
for formats, macros, and variables.

Limits: 10,000 rows, 16 MiB per query HTTP response, and 500 series groups. Timeout
is 30 seconds (configurable 1–300); concurrency is 4 requests per data source
(configurable 1–32). Timeouts include queue time. Cancellation attempts to stop the
server-side query; submission is not retried. Query inspector shows expanded
ScopeQL, query ID, elapsed time, row count, and bucket interval.

## Develop

Docker Compose v2 is required to run local Grafana:

```sh
mkdir -p .local
cp .env.example .local/env
chmod 600 .local/env
make build
make dev
```

Open [localhost:13000](http://127.0.0.1:13000) with `admin / admin`. Configure ScopeDB
in Grafana or set `SCOPEDB_ENDPOINT` and `SCOPEDB_API_KEY` in `.local/env`.
`GRAFANA_PORT` changes the port; `GRAFANA_PASSWORD` sets the initial password only.
`make stop` retains the data volume.

`make test` runs Node variable tests and Go behavior tests with the race detector;
no workspace credentials are required. `make lint` checks ESLint and Go formatting.
Before release, check Save & test, table/time-series queries, variables, and the
catalog browser against a development workspace in Grafana.
