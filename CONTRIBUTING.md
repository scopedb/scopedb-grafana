# Development

Use Node.js 24 (`nvm use`), npm, the Go version in `go.mod`, and Docker Compose v2.
Run commands from this repository, which contains both halves of the Grafana plugin.

## First run

```sh
make build
make up
```

Open <http://localhost:3000>, sign in with Grafana's initial `admin` / `admin`
account, and set a local password when prompted. Add a ScopeDB data source with
your endpoint and API key, then **Save & test**. The container must be able to reach
the endpoint; on Docker Desktop, use `host.docker.internal` instead of `localhost`
for a ScopeDB server running on your host.

Grafana listens on the loopback interface. Its configuration and encrypted data
source credentials live in a Docker volume, outside the repository. `make down`
stops Grafana without deleting this data. Do not put API keys in source files.

To use another port or test the other supported Grafana minor version:

```sh
GRAFANA_PORT=3300 GRAFANA_VERSION=13.2.2 make up
```

## Edit and verify

```sh
make dev                 # Watch frontend changes; refresh the browser to load them
make build-backend       # After Go changes
docker compose restart grafana
make check test          # Lint, types, frontend tests, Go vet/race tests, CI syntax
```

The watch command occupies its terminal. Run the other commands in another
terminal. For a narrower feedback loop, use `npm test`, `npm run typecheck`, or
`go test ./pkg/...`. Run `make deps` after dependency changes. `make help` lists
the main commands. The default `make` command still installs dependencies and
builds the complete Linux plugin.

If Grafana still shows an older bundle after refreshing, use a hard refresh to
bypass the browser's plugin asset cache.

Before a release archive, stop the watcher and run `make build package` to replace
the development bundle with a production build. `scripts/package.py` validates
the manifest version and both Linux binaries, then creates the ZIP and checksums
in `dist/`. Packaging does not publish or deploy the plugin.

## Project map

| Path                                   | Responsibility                                                        |
| -------------------------------------- | --------------------------------------------------------------------- |
| `src/module.ts`, `src/plugin.json`     | Grafana registration and plugin metadata                              |
| `src/datasource.ts`, `src/types.ts`    | Grafana adapter and persisted query/settings contracts                |
| `src/configuration/`                   | Connection and secure API key settings                                |
| `src/catalog/`                         | Catalog types, navigation, loading/retry state, and browser UI        |
| `src/query/`                           | Query editor, ScopeQL language, templates, and variable interpolation |
| `pkg/plugin/`                          | Go query execution, catalog resources, macros, and result frames      |
| `tests/`                               | Frontend behavior tests, run with Node's built-in test runner         |
| `scripts/`, `Makefile`, `compose.yaml` | Packaging, development commands, and local Grafana                    |

Keep request recovery and query construction independent of React so tests can
exercise failure, retry, and stale responses without a Grafana server. The
catalog controller accepts the data source's catalog interface; the data source
owns Grafana transport. Keep credentials and ScopeDB requests in the Go backend.
Preserve saved query JSON when reorganizing frontend code.

## UI checks

In Explore, verify the first query and its recovery paths:

- Browse a table, choose a timestamp, and run table and time series queries.
- Clear the time column; only a table query should be available, without a time filter.
- Reload the catalog; valid database, schema, table, and time-column choices should remain selected.
- Inspect an empty database/schema and a table without a timestamp column.
- Interrupt endpoint access, retry the failed catalog step, and continue editing ScopeQL.
- Switch data sources; the previous table's metadata and generated-query actions must disappear.
- Use multiple query rows; a query error should appear only on its matching row.

The Node tests use synthetic catalog data. They do not establish compatibility
with a live ScopeDB deployment; validate that separately when changing backend
requests, ScopeQL syntax, or result conversion.
