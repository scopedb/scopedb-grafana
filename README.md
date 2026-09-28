# ScopeDB for Grafana

ScopeQL queries, tables, time series, and dashboard variables for Grafana.

## Install

Requires Grafana OSS 13.1–13.2 on Linux amd64 or arm64, a ScopeDB endpoint, and an API key.

1. Download the plugin ZIP from [Releases](https://github.com/scopedb/scopedb-grafana/releases).
   Unreleased builds: unpack the `scopedb-grafana-unsigned-linux` artifact from a successful [CI run](https://github.com/scopedb/scopedb-grafana/actions/workflows/ci.yml).
2. Extract the plugin ZIP into Grafana's plugins directory, preserving executable permissions.
   It should contain `scopedb-scopedb-datasource/plugin.json`.
3. Set `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=scopedb-scopedb-datasource` and restart Grafana after installation or upgrades.
4. Add a **ScopeDB** data source, fill in **Endpoint** and **API key**, then **Save & test**.

Grafana stores the key securely and runs queries on the server, which must reach the
endpoint. Data source users share the key's permissions; the plugin does not enforce
read-only access.

## Query

1. Open **Explore**, select the data source, then **Browse tables** to choose a database, schema, and table.
2. Choose a **Time column** if available and a Grafana time range containing your data.
3. Click **Run table query** or **Run time series query** to generate and execute ScopeQL.

**Time series** needs a timestamp column; **Table** works without one.
You can also edit ScopeQL directly and press **Ctrl/Cmd+Enter** to run.

## Limits

- 10,000 rows, 16 MiB per query HTTP response, and 500 series groups.
- **Advanced** settings: 30s timeout (1–300s, including queue time), 4 concurrent queries (1–32).
- Cancellation attempts to stop the server query; submission is not retried.
- Unsigned plugin. Grafana Cloud, alerting, a dedicated logs mode, and ad hoc filters are unsupported.
