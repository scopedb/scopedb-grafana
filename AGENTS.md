# ScopeDB Grafana data source

Read `.config/AGENTS/instructions.md`. Grafana owns `.config/`; extend build
configuration from the repository root. Use English. Preserve the plugin ID,
saved query models, and secure credential handling.

`src/` contains the frontend; `pkg/plugin/` contains the backend. The provisioned
Getting started dashboard links to `src/dashboards/getting-started.json`.
Run `make build test lint package`. Tests must cover observable behavior and run
without workspace credentials.
