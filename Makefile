.PHONY: build db-test test serve ui-build

build: ui-build
	go build -o bin/sheetbase .

test: ui-build
	cd ui && npm test
	go test ./...

db-test:
	./scripts/test-postgres.sh

serve: ui-build
	go run . serve

ui-build:
	cd ui && npm run build
