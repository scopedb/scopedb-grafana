ENV_FILE ?= .local/env
COMPOSE = docker compose --env-file $(ENV_FILE)
export GOCACHE ?= $(CURDIR)/.cache/go-build

.PHONY: build test lint dev stop package
build:
	npm ci --no-audit --no-fund
	npm run typecheck
	npm run build
	go run github.com/magefile/mage -v build:linux
test:
	npm test
	go test -race ./pkg/...
lint:
	npm run lint
	test -z "$$(gofmt -l pkg)"
dev:
	$(COMPOSE) up -d
stop:
	$(COMPOSE) down
package:
	python3 scripts/package.py
