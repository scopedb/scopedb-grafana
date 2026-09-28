SHELL := /bin/bash
ENV_FILE ?= .local/env
COMPOSE = docker compose --env-file $(ENV_FILE)
export GOCACHE ?= $(CURDIR)/.cache/go-build

.PHONY: build test dev dev-examples smoke smoke-fixture package e2e e2e-examples stop
build:
	npm ci --no-audit --no-fund
	npm run typecheck
	npm run build
	go run github.com/magefile/mage -v build:linux
test:
	npm run typecheck
	npm test
	go test -race ./pkg/...
dev:
	$(COMPOSE) up -d
dev-examples:
	$(COMPOSE) -f docker-compose.yaml -f docker-compose.examples.yaml up -d
smoke:
	python3 scripts/smoke.py
smoke-fixture:
	python3 scripts/smoke_fixture.py
package:
	python3 scripts/package.py
e2e:
	GRAFANA_URL=$${GRAFANA_URL:-http://127.0.0.1:13000} npm run e2e -- --reporter=list
e2e-examples:
	SCOPEDB_EXAMPLES=1 $(MAKE) e2e
stop:
	$(COMPOSE) down
