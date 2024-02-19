# EPS Prescription Status Update API

![Build](https://github.com/NHSDigital/eps-prescription-status-update-api/workflows/release/badge.svg?branch=main)

This is the AWS layer that provides an API for EPS Prescription Status Update.

- `packages/specification/` This [Open API Specification](https://swagger.io/docs/specification/about/) describes the endpoints, methods and messages.
- `scripts/` Utilities helpful to developers of this specification.
- `.devcontainer` Contains a dockerfile and vscode devcontainer definition.
- `.github` Contains github workflows that are used for building and deploying from pull requests and releases.
- `.vscode` Contains vscode workspace file.

Consumers of the API will find developer documentation on the [NHS Digital Developer Hub](https://digital.nhs.uk/developer/api-catalogue).

## Contributing

Contributions to this project are welcome from anyone, providing that they conform to the [guidelines for contribution](https://github.com/NHSDigital//eps-prescription-status-update-api/blob/main/CONTRIBUTING.md) and the [community code of conduct](https://github.com/NHSDigital//eps-prescription-status-update-api/blob/main/CODE_OF_CONDUCT.md).

### Licensing

This code is dual licensed under the MIT license and the OGL (Open Government License). Any new work added to this repository must conform to the conditions of these licenses. In particular this means that this project may not depend on GPL-licensed or AGPL-licensed libraries, as these would violate the terms of those libraries' licenses.

The contents of this repository are protected by Crown Copyright (C).

### CI Setup

The GitHub Actions require a secret to exist on the repo called "SONAR_TOKEN".
This can be obtained from [SonarCloud](https://sonarcloud.io/)
as described [here](https://docs.sonarsource.com/sonarqube/latest/user-guide/user-account/generating-and-using-tokens/).
You will need the "Execute Analysis" permission for the project (NHSDigital_eps-prescription-tracking-service) in order for the token to work.

### Pre-commit hooks

Some pre-commit hooks are installed as part of the install above, to run basic lint checks and ensure you can't accidentally commit invalid changes.
The pre-commit hook uses python package pre-commit and is configured in the file .pre-commit-config.yaml.
A combination of these checks are also run in CI.

### Make commands

There are `make` commands that are run as part of the CI pipeline and help alias some functionality during development.

#### Install targets

- `install-node` Installs node dependencies
- `install-python` Installs python dependencies
- `install-hooks` Installs git pre commit hooks
- `install` Runs all install targets

#### Build targets

- `build-specification` Builds the specification component

#### Clean and deep-clean targets

- `clean` Clears up any files that have been generated by building or testing locally.
- `deep-clean` Runs clean target and also removes any node_modules and python libraries installed locally.

#### Linting targets

- `lint` Runs lint for all code

#### Publish targets
- `publish` Outputs the specification as a **single file** into the `build/` directory. This is used when uploading to Apigee, which requires the spec as a single file.

#### Check licenses

- `check-licenses` Checks licenses for all packages used - calls check-licenses-node, check-licenses-python
- `check-licenses-node` Checks licenses for all node code
- `check-licenses-python` Checks licenses for all python code
