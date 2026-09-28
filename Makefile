.PHONY: deps check build test test-go lint package
build: deps
	npm run build
	go run github.com/magefile/mage -v build:linux build:linuxARM64
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
