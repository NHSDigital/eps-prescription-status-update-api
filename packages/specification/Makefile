SHELL=/bin/bash -euo pipefail

.PHONY: install build release clean

install:
	npm ci

clean:
	rm -rf dist/

build:
	mkdir -p dist
	npm run lint
	npm run resolve
	cat dist/eps-prescription-status-update-api.resolved.json | poetry run python ../../scripts/set_version.py > dist/eps-prescription-status-update-api.json
	ls -la dist
