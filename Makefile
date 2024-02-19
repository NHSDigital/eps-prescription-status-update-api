SHELL=/bin/bash -euo pipefail

install: install-node install-python install-hooks

#Installs dependencies using poetry.
install-python:
	poetry install

#Installs dependencies using npm.
install-node:
	npm install --legacy-peer-deps

install-hooks: install-python
	poetry run pre-commit install --install-hooks --overwrite

build-specification:
	$(MAKE) --directory=packages/specification build

#Run the npm linting script (specified in package.json). Used to check the syntax and formatting of files.
lint:
	npm run lint
	find . -name '*.py' -not -path '**/.venv/*' | xargs poetry run flake8
	shellcheck scripts/*.sh

#Removes build/ + dist/ directories
clean:
	rm -rf build
	rm -rf dist

deep-clean: clean
	rm -rf venv
	find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +
	poetry env remove --all

#Creates the fully expanded OAS spec in json
publish: clean
	mkdir -p build
	npm run resolve 2> /dev/null

check-licenses: check-licenses-node check-licenses-python

check-licenses-node:
	npm run check-licenses

check-licenses-python:
	scripts/check_python_licenses.sh
