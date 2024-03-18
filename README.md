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

## Development

It is recommended that you use visual studio code and a devcontainer as this will install all necessary components and correct versions of tools and languages.  
See https://code.visualstudio.com/docs/devcontainers/containers for details on how to set this up on your host machine.  
There is also a workspace file in .vscode that should be opened once you have started the devcontainer. The workspace file can also be opened outside of a devcontainer if you wish.  
The project uses [SAM](https://aws.amazon.com/serverless/sam/) to develop and deploy the APIs and associated resources.

All commits must be made using [signed commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

Once the steps at the link above have been completed. Add to your ~/.gnupg/gpg.conf as below:

```
use-agent
pinentry-mode loopback
```

and to your ~/.gnupg/gpg-agent.conf as below:

```
allow-loopback-pinentry
```

As described here:
https://stackoverflow.com/a/59170001

You will need to create the files, if they do not already exist.
This will ensure that your VSCode bash terminal prompts you for your GPG key password.

You can cache the gpg key passphrase by following instructions at https://superuser.com/questions/624343/keep-gnupg-credentials-cached-for-entire-user-session

### CI Setup

The GitHub Actions require a secret to exist on the repo called "SONAR_TOKEN".
This can be obtained from [SonarCloud](https://sonarcloud.io/)
as described [here](https://docs.sonarsource.com/sonarqube/latest/user-guide/user-account/generating-and-using-tokens/).
You will need the "Execute Analysis" permission for the project (NHSDigital_eps-prescription-status-update-api) in order for the token to work.

### Continuous deployment for testing

You can run the following command to deploy the code to AWS for testing

```
make sam-sync
```

This will take a few minutes to deploy - you will see something like this when deployment finishes

```
......
CloudFormation events from stack operations (refresh every 0.5 seconds)
---------------------------------------------------------------------------------------------------------------------------------------------------------------------
ResourceStatus                            ResourceType                              LogicalResourceId                         ResourceStatusReason
---------------------------------------------------------------------------------------------------------------------------------------------------------------------
.....
CREATE_IN_PROGRESS                        AWS::ApiGatewayV2::ApiMapping             HttpApiGatewayApiMapping                  -
CREATE_IN_PROGRESS                        AWS::ApiGatewayV2::ApiMapping             HttpApiGatewayApiMapping                  Resource creation Initiated
CREATE_COMPLETE                           AWS::ApiGatewayV2::ApiMapping             HttpApiGatewayApiMapping                  -
CREATE_COMPLETE                           AWS::CloudFormation::Stack                ab-1                                      -
---------------------------------------------------------------------------------------------------------------------------------------------------------------------


Stack creation succeeded. Sync infra completed.
```

Note - the command will keep running and should not be stopped.
You can now call this api.

```
curl -X POST https://${stack_name}.dev.eps.national.nhs.uk/
```

You can also use the AWS vscode extension to invoke the API or lambda directly

Any code changes you make are automatically uploaded to AWS while `make sam-sync` is running allowing you to quickly test any changes you make

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

#### Linting and testing

- `lint` Runs lint for all code
- `lint-node` Runs lint for node code
- `lint-cloudformation` Runs lint for cloudformation templates
- `lint-samtemplates` Runs lint for SAM templates
- `test` Runs unit tests for all code

#### Publish targets
- `publish` Outputs the specification as a **single file** into the `build/` directory. This is used when uploading to Apigee, which requires the spec as a single file.

#### Compiling

- `compile` Compiles all code
- `compile-node` Runs tsc to compile typescript code

#### Check licenses

- `check-licenses` Checks licenses for all packages used - calls check-licenses-node, check-licenses-python
- `check-licenses-node` Checks licenses for all node code
- `check-licenses-python` Checks licenses for all python code

#### CLI Login to AWS

- `aws-configure` Configures a connection to AWS
- `aws-login` Reconnects to AWS from a previously configured connection

### Github folder

This .github folder contains workflows and templates related to GitHub, along with actions and scripts pertaining to Jira.

- `pull_request_template.yml` Template for pull requests.
- `dependabot.yml` Dependabot definition file.

Actions are in the `.github/actions` folder:

- `mark_jira_released` Action to mark Jira issues as released.
- `update_confluence_jira` Action to update Confluence with Jira issues.

Scripts are in the `.github/scripts` folder:

- `call_mark_jira_released.sh` Calls a Lambda function to mark Jira issues as released.
- `create_env_release_notes.sh` Generates release notes for a specific environment using a Lambda function.
- `create_int_rc_release_notes.sh` Creates release notes for integration environment using a Lambda function.
- `delete_stacks.sh` Checks and deletes active CloudFormation stacks associated with closed pull requests.
- `get_current_dev_tag.sh` Retrieves the current development tag and sets it as an environment variable.
- `get_target_deployed_tag.sh` Retrieves the currently deployed tag and sets it as an environment variable.
- `release_code.sh` Releases code by deploying it using AWS SAM after packaging it.

Workflows are in the `.github/workflows` folder:

- `combine-dependabot-prs.yml` Workflow for combining dependabot pull requests. Runs on demand.
- `delete_old_cloudformation_stacks.yml` Workflow for deleting old cloud formation stacks. Runs daily.
- `dependabot_auto_approve_and_merge.yml` Workflow to auto merge dependabot updates.
- `pr-link.yaml` This workflow template links Pull Requests to Jira tickets and runs when a pull request is opened.
- `pull_request.yml` Called when pull request is opened or updated. Calls sam_package_code and sam_release_code to build and deploy the code. Deploys to dev AWS account. The main stack deployed adopts the naming convention psu-pr-<PULL_REQUEST_ID>, while the sandbox stack follows the pattern psu-sandbox-pr-<PULL_REQUEST_ID>
- `quality_checks.yml` Runs check-licenses, lint, test and SonarCloud scan against the repo. Called from pull_request.yml and release.yml
- `release.yml` Run when code is merged to main branch or a tag starting v is pushed. Calls sam_package_code and sam_release_code to build and deploy the code.
- `sam_package_code.yml` Packages code and uploads to a github artifact for later deployment.
- `sam_release_code.yml` Release code built by sam_package_code.yml to an environment.
