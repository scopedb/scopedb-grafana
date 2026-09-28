# ScopeDB

Connect Grafana to any ScopeDB workspace using the official Go SDK. Supports raw ScopeQL, table and labeled time-series results, Dashboard variables, adaptive time buckets, and catalog-assisted query editing.

Configure an Endpoint reachable from the Grafana server and an API key, then Save & test. Credentials stay in Grafana secureJsonData and are used only by the backend. Import the included Getting started dashboard or add a panel, click Browse tables, select a table, and insert a query template. Ctrl/Cmd+Enter executes the query.

Use $__timeFilter(event_time) for the selected UTC range and $__timeGroup(event_time) for adaptive buckets. Query variables support __text / __value. Variables are quoted automatically: service = ${service}, or contains([${service}], service::any) for multiple values. Leave Custom all value blank. Numeric values use ${limit:number}; a single identifier uses ${table:identifier}.

Time series requires one timestamp column, numeric values, and optional string/boolean dimensions. Aggregate duplicate timestamps per dimension set. Limits: 10,000 rows, 500 series groups, and 16 MiB per HTTP response. Default timeout is 30 seconds and concurrency is 4 requests per data source instance. Query inspector shows expanded ScopeQL and execution diagnostics.

Version 0.2.0 is tested with Grafana OSS 13.1.0 on Linux amd64. The package is unsigned: allow scopedb-scopedb-datasource explicitly and restart Grafana after installation or upgrades. Existing 0.1.0 queries remain compatible. ScopeDB permissions follow the configured API key; this connector does not enforce read-only ScopeQL. Alerting, logs-specific mode, ad hoc filters and Grafana Cloud installation are not included.
