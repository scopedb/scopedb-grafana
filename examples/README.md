# Optional dashboards

The default connector is independent of these datasets. `docker-compose.examples.yaml` loads these resources in addition to the generic connection and starter dashboard:

- `provisioning/datasources/datasources.yml`: historical fixture, UID `scopedb-poc`, using `POC_SCOPEDB_ENDPOINT` / `POC_SCOPEDB_API_KEY`.
- `provisioning/datasources/bluesky.yml`: Bluesky, UID `scopedb-bluesky`, using `BLUESKY_ENDPOINT` / `BLUESKY_API_KEY`.
- `provisioning/dashboards/`: the corresponding dashboards.

Append the required settings from `env.example` to your local env file, then run `make dev-examples`. Both datasets are optional; copy individual provisioning files if you only need one. No example table is created automatically. The original three-row fixture's creation/insertion scripts remain in the root `fixtures/` directory; do not insert those rows repeatedly.

Run `make smoke-fixture` for the historical fixture or `python3 scripts/validate_bluesky.py` for Bluesky. `SCOPEDB_EXAMPLES=1 make e2e` includes the optional browser tests. These tests require their respective real tables and fail if data or credentials are missing.
