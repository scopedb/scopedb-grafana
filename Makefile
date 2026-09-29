.PHONY: deps check build build-frontend build-backend dev up down help test test-go lint package
build: deps
	$(MAKE) build-frontend build-backend
build-frontend:
	npm run build
build-backend:
	go run github.com/magefile/mage -v build:linux build:linuxARM64
dev:
	npm run dev
up:
	@test -f dist/plugin.json -a -f dist/module.js -a -x dist/gpx_scope_db_linux_amd64 -a -x dist/gpx_scope_db_linux_arm64 || { echo 'Run make build before make up.'; exit 1; }
	docker compose up -d --wait
down:
	docker compose down
help:
	@echo 'make build           Install dependencies and build the complete Linux plugin'
	@echo 'make up / down       Start / stop local Grafana (keeps saved data)'
	@echo 'make dev             Watch frontend sources; refresh Grafana after edits'
	@echo 'make build-backend   Rebuild Go binaries; restart Grafana afterward'
	@echo 'make check test      Run static checks and frontend / Go race tests'
	@echo 'make package         Archive the production build in dist/'
deps:
	npm ci --no-audit --no-fund
check: lint
	npm run typecheck
	npm test
	go vet ./pkg/...
	go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
test: test-go
	npm test
test-go:
	go test -race ./pkg/...
lint:
	npm run lint
	test -z "$$(gofmt -l pkg)"
package:
	python3 scripts/package.py
