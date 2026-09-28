# ScopeDB

Internal proof of concept for Grafana OSS 13.1.0 on Linux amd64.

Configure the ScopeDB workspace Endpoint, API key, and timeout. Save & test runs SELECT 1 AS ok. The key is stored in Grafana secureJsonData and used only by the backend.

Use a Table panel and enter raw ScopeQL. The backend calls the official goscopedb SDK directly. $__timeFilter(event_time) expands to UTC [from, to). NULL values are preserved; complex values and unsafe integers are displayed as strings. Use LIMIT (maximum 10,000 rows / 16 MiB per HTTP response).

Only trusted administrators should use this unsigned PoC in an isolated OSS instance. Queries are not restricted to read-only statements. Time series, dashboard variables, alerts, plugin signing and Grafana Cloud are outside this version.

Allow unsigned loading for scopedb-scopedb-datasource only, and restart Grafana after installation or plugin updates. The source README includes Docker Compose, provisioning, example dashboard, build and verification commands.
