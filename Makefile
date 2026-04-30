SHELL = /bin/bash
.SHELLFLAGS = -o pipefail -c
export CDK_APP_NAME=PsuApiApp
export CDK_CONFIG_stackMode=stateless
export CDK_CONFIG_stackName=${stack_name}
export CDK_CONFIG_samStackName=${stack_name}
export CDK_CONFIG_versionNumber=undefined
export CDK_CONFIG_commitId=undefined
export CDK_CONFIG_isPullRequest=true
export CDK_CONFIG_environment=dev
export CDK_CONFIG_logRetentionInDays=30
export CDK_CONFIG_logLevel=DEBUG
export CDK_CONFIG_trustStoreFile=psu-truststore.pem
export CDK_CONFIG_trustStoreVersion=none
export CDK_CONFIG_enableMutualTls=false
export CDK_CONFIG_enableSplunk=false
export CDK_CONFIG_forwardCsocLogs=false
export CDK_CONFIG_deployCheckPrescriptionStatusUpdate=true
export CDK_CONFIG_exposeGetStatusUpdates=false
export CDK_CONFIG_enablePostDatedNotifications=false
export CDK_CONFIG_requireApplicationName=false
export CDK_CONFIG_enableBackup=false

guard-%:
	@ if [ "${${*}}" = "" ]; then \
		echo "Environment variable $* not set"; \
		exit 1; \
	fi

.PHONY: install build test publish release clean lint compile

install: install-node install-python install-hooks

install-python:
	poetry install

install-node:
	npm ci --ignore-scripts

install-hooks: install-python
	poetry run pre-commit install --install-hooks --overwrite

sam-build: sam-validate compile
	sam build --template-file SAMtemplates/main_template.yaml --region eu-west-2

sam-build-sandbox: sam-validate-sandbox compile
	sam build --template-file SAMtemplates/sandbox_template.yaml --region eu-west-2

sam-run-local: sam-build
	sam local start-api

sam-sync: guard-AWS_DEFAULT_PROFILE guard-stack_name compile
	sam sync \
		--stack-name $$stack_name \
		--watch \
		--template-file SAMtemplates/main_template.yaml \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--parameter-overrides \
			  TruststoreVersion=$${TRUSTSTORE_VERSION:-none} \
			  EnableMutualTLS=$${ENABLE_MUTUAL_TLS:-false} \
			  EnableSplunk=false \
			  EnableDynamoDBAutoScaling=$${DYNAMODB_AUTOSCALE:-true} \
			  VersionNumber=$${VERSION_NUMBER:-dev} \
			  CommitId=$${COMMIT_ID:-local} \
			  LogLevel=$${LOG_LEVEL:-INFO} \
			  LogRetentionInDays=$${LOG_RETENTION_DAYS:-30} \
			  DeployCheckPrescriptionStatusUpdate=true \
			  EnableAlerts=false \
			  Environment=$$AWS_ENVIRONMENT \
			  StateMachineLogLevel=$${STATE_MACHINE_LOG_LEVEL:-ALL} \
			  RequireApplicationName=$${REQUIRE_APPLICATION_NAME:-false} \
			  ForwardCsocLogs=$${FORWARD_CSOC_LOGS:-false} \
			  TestPresciptionsParamValue1=$${TEST_PRESCRIPTIONS_1:-PLACEHOLDER} \
			  TestPresciptionsParamValue2=$${TEST_PRESCRIPTIONS_2:-PLACEHOLDER} \
			  TestPresciptionsParamValue3=$${TEST_PRESCRIPTIONS_3:-PLACEHOLDER} \
			  TestPresciptionsParamValue4=$${TEST_PRESCRIPTIONS_4:-PLACEHOLDER} \
			  "EnabledSystemsValue=$${ENABLED_SYSTEMS:-Internal Test System}" \
			  "EnabledSiteODSCodesValue=$${ENABLED_SITE_ODS_CODES:-A83008,FA565}" \
			  BlockedSiteODSCodesValue=$${BLOCKED_SITE_ODS_CODES:-XXXXX} \
			  EnabledSupplierApplicationIDsValue=$${ENABLED_SUPPLIER_APPLICATION_IDS:-XXXXX} \
			  NotifyRoutingPlanIDValue=$${NOTIFY_ROUTING_PLAN_ID:-e57fe5cc-0567-4854-abe2-b7dd9014a50c} \
			  NotifyAPIBaseURLValue=$${NOTIFY_API_BASE_URL:-https://int.api.service.nhs.uk} \
			  EnableNotificationsInternal=$${ENABLE_NOTIFICATIONS_INTERNAL:-true} \
			  EnableNotificationsExternal=$${ENABLE_NOTIFICATIONS_EXTERNAL:-false} \
			  EnableBackup=$${ENABLE_BACKUP:-False}

sam-deploy: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam deploy \
		--stack-name $$stack_name \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--parameter-overrides \
			  TruststoreVersion=$${TRUSTSTORE_VERSION:-none} \
			  EnableMutualTLS=$${ENABLE_MUTUAL_TLS:-false} \
			  EnableSplunk=false \
			  EnableDynamoDBAutoScaling=$${DYNAMODB_AUTOSCALE:-true} \
			  VersionNumber=$${VERSION_NUMBER:-dev} \
			  CommitId=$${COMMIT_ID:-local} \
			  LogLevel=$${LOG_LEVEL:-INFO} \
			  LogRetentionInDays=$${LOG_RETENTION_DAYS:-30} \
			  DeployCheckPrescriptionStatusUpdate=true \
			  EnableAlerts=false \
			  Environment=$$AWS_ENVIRONMENT \
			  StateMachineLogLevel=$${STATE_MACHINE_LOG_LEVEL:-ALL} \
			  RequireApplicationName=$${REQUIRE_APPLICATION_NAME:-false} \
			  ForwardCsocLogs=$${FORWARD_CSOC_LOGS:-false} \
			  TestPresciptionsParamValue1=$${TEST_PRESCRIPTIONS_1:-PLACEHOLDER} \
			  TestPresciptionsParamValue2=$${TEST_PRESCRIPTIONS_2:-PLACEHOLDER} \
			  TestPresciptionsParamValue3=$${TEST_PRESCRIPTIONS_3:-PLACEHOLDER} \
			  TestPresciptionsParamValue4=$${TEST_PRESCRIPTIONS_4:-PLACEHOLDER} \
			  "EnabledSystemsValue=$${ENABLED_SYSTEMS:-Internal Test System}" \
			  "EnabledSiteODSCodesValue=$${ENABLED_SITE_ODS_CODES:-A83008,FA565}" \
			  BlockedSiteODSCodesValue=$${BLOCKED_SITE_ODS_CODES:-XXXXX} \
			  EnabledSupplierApplicationIDsValue=$${ENABLED_SUPPLIER_APPLICATION_IDS:-XXXXX} \
			  NotifyRoutingPlanIDValue=$${NOTIFY_ROUTING_PLAN_ID:-e57fe5cc-0567-4854-abe2-b7dd9014a50c} \
			  NotifyAPIBaseURLValue=$${NOTIFY_API_BASE_URL:-https://int.api.service.nhs.uk} \
			  EnableNotificationsInternal=$${ENABLE_NOTIFICATIONS_INTERNAL:-true} \
			  EnableNotificationsExternal=$${ENABLE_NOTIFICATIONS_EXTERNAL:-false} \
			  EnableBackup=$${ENABLE_BACKUP:-False}

sam-delete: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam delete --stack-name $$stack_name

sam-list-endpoints: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam list endpoints --stack-name $$stack_name

sam-list-resources: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam list resources --stack-name $$stack_name

sam-list-outputs: guard-AWS_DEFAULT_PROFILE guard-stack_name
	sam list stack-outputs --stack-name $$stack_name

sam-validate:
	sam validate --template-file SAMtemplates/main_template.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/apis/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/apis/api_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/functions/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/functions/lambda_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/tables/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/tables/dynamodb_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/state_machines/main.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/state_machines/state_machine_resources.yaml --region eu-west-2
	sam validate --template-file SAMtemplates/alarms/main.yaml --region eu-west-2

sam-validate-sandbox:
	sam validate --template-file SAMtemplates/sandbox_template.yaml --region eu-west-2

sam-deploy-package: guard-artifact_bucket guard-artifact_bucket_prefix guard-stack_name guard-template_file guard-cloud_formation_execution_role guard-LATEST_TRUSTSTORE_VERSION guard-enable_mutual_tls guard-DYNAMODB_AUTOSCALE guard-VERSION_NUMBER guard-COMMIT_ID guard-VERSION_NUMBER guard-LOG_RETENTION_DAYS guard-TARGET_ENVIRONMENT
	sam deploy \
		--template-file $$template_file \
		--stack-name $$stack_name \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--region eu-west-2 \
		--s3-bucket $$artifact_bucket \
		--s3-prefix $$artifact_bucket_prefix \
		--config-file samconfig_package_and_deploy.toml \
		--no-fail-on-empty-changeset \
		--role-arn $$cloud_formation_execution_role \
		--no-confirm-changeset \
		--force-upload \
		--tags "version=$$VERSION_NUMBER cloudFormationStack=$$stack_name" \
		--parameter-overrides \
			  TruststoreVersion=$$LATEST_TRUSTSTORE_VERSION \
			  EnableMutualTLS=$$enable_mutual_tls \
			  EnableSplunk=true \
			  EnableDynamoDBAutoScaling=$$DYNAMODB_AUTOSCALE \
			  VersionNumber=$$VERSION_NUMBER \
			  CommitId=$$COMMIT_ID \
			  LogLevel=$$LOG_LEVEL \
			  LogRetentionInDays=$$LOG_RETENTION_DAYS \
			  Environment=$$TARGET_ENVIRONMENT \
			  DeployCheckPrescriptionStatusUpdate=$$DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE \
			  EnableAlerts=$$ENABLE_ALERTS \
			  StateMachineLogLevel=$$STATE_MACHINE_LOG_LEVEL \
			  EnableNotificationsInternal=$$ENABLE_NOTIFICATIONS_INTERNAL \
			  EnableNotificationsExternal=$$ENABLE_NOTIFICATIONS_EXTERNAL \
			  EnableBackup=$$ENABLE_BACKUP

compile-node:
	npx tsc --build tsconfig.build.json

compile-specification:
	npm run resolve --workspace packages/specification/
	npm run resolve-cpsu --workspace packages/specification/

compile: compile-node compile-specification

lint-node: compile-node
	npm run lint --workspace packages/cdk
	npm run lint --workspace packages/updatePrescriptionStatus
	npm run lint --workspace packages/gsul
	npm run lint --workspace packages/nhsd-psu-sandbox
	npm run lint --workspace packages/statusLambda
	npm run lint --workspace packages/capabilityStatement
	npm run lint --workspace packages/cpsuLambda
	npm run lint --workspace packages/checkPrescriptionStatusUpdates
	npm run lint --workspace packages/nhsNotifyLambda
	npm run lint --workspace packages/postDatedLambda
	npm run lint --workspace packages/nhsNotifyUpdateCallback
	npm run lint --workspace packages/common/testing
	npm run lint --workspace packages/common/middyErrorHandler
	npm run lint --workspace packages/common/commonTypes
	npm run lint --workspace packages/psuRestoreValidationLambda

lint-specification: compile-specification
	npm run lint --workspace packages/specification

lint-python:
	poetry run flake8 scripts/*.py --config .flake8

lint: lint-node lint-python lint-specification

test: compile
	npm run test --workspace packages/updatePrescriptionStatus
	npm run test --workspace packages/gsul
	npm run test --workspace packages/nhsd-psu-sandbox
	npm run test --workspace packages/statusLambda
	npm run test --workspace packages/capabilityStatement
	npm run test --workspace packages/cpsuLambda
	npm run test --workspace packages/checkPrescriptionStatusUpdates
	npm run test --workspace packages/nhsNotifyLambda
	npm run test --workspace packages/postDatedLambda
	npm run test --workspace packages/nhsNotifyUpdateCallback
	npm run test --workspace packages/common/middyErrorHandler
	npm run test --workspace packages/psuRestoreValidationLambda
	npm run test --workspace packages/common/utilities

clean:
	rm -rf packages/updatePrescriptionStatus/coverage
	rm -rf packages/updatePrescriptionStatus/lib
	rm -rf packages/nhsd-psu-sandbox/coverage
	rm -rf packages/nhsd-psu-sandbox/lib
	rm -rf packages/specification/coverage
	rm -rf packages/specification/lib
	rm -rf packages/statusLambda/coverage
	rm -rf packages/statusLambda/lib
	rm -rf packages/capabilityStatement/coverage
	rm -rf packages/capabilityStatement/lib
	rm -rf packages/cpsuLambda/coverage
	rm -rf packages/cpsuLambda/lib
	rm -rf packages/nhsNotifyLambda/coverage
	rm -rf packages/nhsNotifyLambda/lib
	rm -rf packages/postDatedLambda/coverage
	rm -rf packages/postDatedLambda/lib
	rm -rf packages/nhsNotifyUpdateCallback/coverage
	rm -rf packages/nhsNotifyUpdateCallback/lib
	rm -rf packages/checkPrescriptionStatusUpdates/lib
	rm -rf packages/common/testing/lib
	rm -rf packages/common/middyErrorHandler/lib
	rm -rf packages/common/commonTypes/lib
	rm -rf packages/cdk/lib
	rm -rf .aws-sam
	rm -rf cdk.out

deep-clean: clean
	rm -rf venv
	find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +
	poetry env remove --all

cdk-deploy: cdk-stateful-deploy cdk-stateless-deploy
	@true

cdk-synth: cdk-stateful-synth cdk-stateless-synth
	@true

cdk-stateful-deploy:
	CDK_APP_NAME=PsuApiApp \
	CDK_CONFIG_stackMode=stateful \
	CDK_CONFIG_stackName=psu-cdk-stateful \
	CDK_CONFIG_logRetentionInDays=30 \
	CDK_CONFIG_environment=dev \
	CDK_CONFIG_enableDynamoDBAutoScaling=false \
	CDK_CONFIG_enableBackup=false \
	REQUIRE_APPROVAL="$${REQUIRE_APPROVAL:-any-change}" \
	npm run cdk-deploy --workspace packages/cdk

cdk-stateless-deploy:
	CDK_APP_NAME=PsuApiApp \
	CDK_CONFIG_stackMode=stateless \
	CDK_CONFIG_stackName=psu-cdk \
	CDK_CONFIG_samStackName=psu \
	CDK_CONFIG_logRetentionInDays=30 \
	CDK_CONFIG_logLevel=DEBUG \
	CDK_CONFIG_environment=dev \
	CDK_CONFIG_forwardCsocLogs=false \
	CDK_CONFIG_deployCheckPrescriptionStatusUpdate=true \
	CDK_CONFIG_exposeGetStatusUpdates=false \
	CDK_CONFIG_enablePostDatedNotifications=false \
	CDK_CONFIG_requireApplicationName=false \
	CDK_CONFIG_enableBackup=false \
	REQUIRE_APPROVAL="$${REQUIRE_APPROVAL:-any-change}" \
	npm run cdk-deploy --workspace packages/cdk

cdk-stateless-synth:
	CDK_APP_NAME=PsuApiApp \
	CDK_CONFIG_stackMode=stateless \
	CDK_CONFIG_stackName=psu-cdk \
	CDK_CONFIG_samStackName=psu \
	CDK_CONFIG_logRetentionInDays=30 \
	CDK_CONFIG_logLevel=DEBUG \
	CDK_CONFIG_environment=dev \
	CDK_CONFIG_forwardCsocLogs=false \
	CDK_CONFIG_deployCheckPrescriptionStatusUpdate=true \
	CDK_CONFIG_exposeGetStatusUpdates=false \
	CDK_CONFIG_enablePostDatedNotifications=false \
	CDK_CONFIG_requireApplicationName=false \
	CDK_CONFIG_enableBackup=false \
	npm run cdk-synth --workspace packages/cdk

cdk-stateful-synth:
	CDK_APP_NAME=PsuApiApp \
	CDK_CONFIG_stackMode=stateful \
	CDK_CONFIG_stackName=psu-cdk-stateful \
	CDK_CONFIG_logRetentionInDays=30 \
	CDK_CONFIG_environment=dev \
	CDK_CONFIG_enableDynamoDBAutoScaling=false \
	CDK_CONFIG_enableBackup=false \
	npm run cdk-synth --workspace packages/cdk

cdk-sandbox-synth:
	CDK_APP_NAME=PsuApiSandboxApp \
	CDK_CONFIG_stackName=psu-sandbox \
	CDK_CONFIG_logRetentionInDays=30 \
	CDK_CONFIG_logLevel=DEBUG \
	CDK_CONFIG_environment=dev \
	CDK_CONFIG_trustStoreFile=psu-sandbox-truststore.pem \
	CDK_CONFIG_trustStoreVersion=none \
	CDK_CONFIG_enableMutualTls=false \
	CDK_CONFIG_enableSplunk=false \
	CDK_CONFIG_enableBackup=false \
	npm run cdk-synth --workspace packages/cdk

cdk-diff:
	npm run cdk-diff --workspace packages/cdk

cdk-watch:
	REQUIRE_APPROVAL="$${REQUIRE_APPROVAL:-any-change}" && \
	npm run cdk-watch --workspace packages/cdk

%:
	@$(MAKE) -f /usr/local/share/eps/Mk/common.mk $@
