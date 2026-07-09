.PHONY: build test serve ui-build

build: ui-build
	go build -o bin/sheetbase .

test: ui-build
	cd ui && npm test
	go test ./...

serve: ui-build
	go run . serve

ui-build:
	cd ui && npm run build
