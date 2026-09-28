.PHONY: build test lint package
build:
	npm ci --no-audit --no-fund
	npm run typecheck
	npm run build
	go run github.com/magefile/mage -v build:linux build:linuxARM64
test:
	npm test
	go test -race ./pkg/...
lint:
	npm run lint
	test -z "$$(gofmt -l pkg)"
package:
	python3 scripts/package.py
