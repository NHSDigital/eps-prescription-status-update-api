#!/usr/bin/env bash
set -e

function check_required_vars() {
    REQUIRED_VARS=$1

    for var in $REQUIRED_VARS; do
        # Check if the variable is defined and not empty
        if [ -z "${!var}" ]; then
            echo "Error: $var is not defined or is empty."
            exit 1
        else
            echo "$var: '${!var}'"
        fi
    done
}

function get_exports() {
    artifact_bucket=$(aws cloudformation list-exports --output json | jq -r '.Exports[] | select(.Name == "account-resources:ArtifactsBucket") | .Value' | grep -o '[^:]*$')

    cloud_formation_execution_role=$(aws cloudformation list-exports --output json | jq -r '.Exports[] | select(.Name == "ci-resources:CloudFormationExecutionRole") | .Value' )

    TRUSTSTORE_BUCKET_ARN=$(aws cloudformation describe-stacks --stack-name account-resources --query "Stacks[0].Outputs[?OutputKey=='TrustStoreBucket'].OutputValue" --output text)
    TRUSTSTORE_BUCKET_NAME=$(echo "${TRUSTSTORE_BUCKET_ARN}" | cut -d ":" -f 6)
    LATEST_TRUSTSTORE_VERSION=$(aws s3api list-object-versions --bucket "${TRUSTSTORE_BUCKET_NAME}" --prefix "${TRUSTSTORE_FILE}" --query 'Versions[?IsLatest].[VersionId]' --output text)
}

function deploy_sandbox_stack() {
    echo "About to sandbox stack"
    local stack_name=$1
    check_required_vars "GITHUB_WORKSPACE \
        stack_name \
        artifact_bucket \
        ARTIFACT_BUCKET_PREFIX \
        cloud_formation_execution_role \
        VERSION_NUMBER \
        ENABLE_MUTUAL_TLS \
        COMMIT_ID \
        LOG_LEVEL \
        LOG_RETENTION_DAYS"
    sam deploy \
		--template-file "${GITHUB_WORKSPACE}/.aws-sam/build/template.yaml" \
		--stack-name "${stack_name}" \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--region eu-west-2 \
		--s3-bucket "${artifact_bucket}" \
		--s3-prefix "${ARTIFACT_BUCKET_PREFIX}" \
		--config-file "${GITHUB_WORKSPACE}/.aws-sam/build/samconfig_package_and_deploy.toml" \
		--no-fail-on-empty-changeset \
		--role-arn "${cloud_formation_execution_role}" \
		--no-confirm-changeset \
		--force-upload \
		--tags \
				version="${VERSION_NUMBER}" \
		--parameter-overrides \
				EnableMutualTLS="${ENABLE_MUTUAL_TLS}" \
				EnableSplunk=true \
				VersionNumber="${VERSION_NUMBER}" \
				CommitId="${COMMIT_ID}" \
				LogLevel="${LOG_LEVEL}" \
				LogRetentionInDays="${LOG_RETENTION_DAYS}"
}

function deploy_main_stack() {
    echo "About to main stack"
    local stack_name=$1
    local deployment_colour=$2
    check_required_vars "GITHUB_WORKSPACE \
        stack_name \
        artifact_bucket \
        ARTIFACT_BUCKET_PREFIX \
        cloud_formation_execution_role \
        VERSION_NUMBER \
        deployment_colour \
        ENABLE_MUTUAL_TLS \
        DYNAMODB_AUTOSCALE \
        COMMIT_ID \
        LOG_LEVEL \
        LOG_RETENTION_DAYS \
        TARGET_ENVIRONMENT \
        DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE \
        ENABLE_ALERTS"
    sam deploy \
		--template-file "${GITHUB_WORKSPACE}/.aws-sam/build.main/template.yaml" \
		--stack-name "${stack_name}" \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--region eu-west-2 \
		--s3-bucket "${artifact_bucket}" \
		--s3-prefix "${ARTIFACT_BUCKET_PREFIX}" \
		--config-file "${GITHUB_WORKSPACE}/.aws-sam/build.main/samconfig_package_and_deploy.toml" \
		--no-fail-on-empty-changeset \
		--role-arn "${cloud_formation_execution_role}" \
		--no-confirm-changeset \
		--force-upload \
		--tags \
				version="${VERSION_NUMBER}" \
				deployment_colour="${deployment_colour}" \
		--parameter-overrides \
				EnableMutualTLS="${ENABLE_MUTUAL_TLS}" \
				EnableSplunk=true \
				EnableDynamoDBAutoScaling="${DYNAMODB_AUTOSCALE}" \
				VersionNumber="${VERSION_NUMBER}" \
				CommitId="${COMMIT_ID}" \
				LogLevel="${LOG_LEVEL}" \
				LogRetentionInDays="${LOG_RETENTION_DAYS}" \
				Environment="${TARGET_ENVIRONMENT}" \
				DeployCheckPrescriptionStatusUpdate="${DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE}" \
				EnableAlerts="${ENABLE_ALERTS}" \
                PrescriptionStatusUpdatesTableName="${PrescriptionStatusUpdatesTableName}"
}

function deploy_api_domain_stack() {
    echo "About to api domain stack"
    local stack_name=$1
    local deployment_colour=$2
    check_required_vars "GITHUB_WORKSPACE \
        stack_name \
        artifact_bucket \
        ARTIFACT_BUCKET_PREFIX \
        cloud_formation_execution_role \
        VERSION_NUMBER \
        deployment_colour \
        LATEST_TRUSTSTORE_VERSION \
        ENABLE_MUTUAL_TLS \
        COMMIT_ID \
        LOG_LEVEL \
        LOG_RETENTION_DAYS \
        RestApiGateway \
        RestApiGatewayStage"
    sam deploy \
		--template-file "${GITHUB_WORKSPACE}/.aws-sam/build.api_domain/template.yaml" \
		--stack-name "${stack_name}" \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--region eu-west-2 \
		--s3-bucket "${artifact_bucket}" \
		--s3-prefix "${ARTIFACT_BUCKET_PREFIX}" \
		--config-file "${GITHUB_WORKSPACE}/.aws-sam/build.api_domain/samconfig_package_and_deploy.toml" \
		--no-fail-on-empty-changeset \
		--role-arn "${cloud_formation_execution_role}" \
		--no-confirm-changeset \
		--force-upload \
		--tags \
				version="${VERSION_NUMBER}" \
				deployment_colour="${deployment_colour}" \
		--parameter-overrides \
				TruststoreVersion="${LATEST_TRUSTSTORE_VERSION}" \
				EnableMutualTLS="${ENABLE_MUTUAL_TLS}" \
				LogLevel="${LOG_LEVEL}" \
				LogRetentionInDays="${LOG_RETENTION_DAYS}" \
   				RestApiGateway="${RestApiGateway}" \
				RestApiGatewayStage="${RestApiGatewayStage}" \
                GSUL_ARN="${GSUL_ARN}"
}

function deploy_table_stack() {
    echo "About to table stack"
    local stack_name=$1
    check_required_vars "GITHUB_WORKSPACE \
        stack_name \
        artifact_bucket \
        ARTIFACT_BUCKET_PREFIX \
        cloud_formation_execution_role \
        VERSION_NUMBER \
        DYNAMODB_AUTOSCALE \
        COMMIT_ID"
    sam deploy \
		--template-file "${GITHUB_WORKSPACE}/.aws-sam/build.tables/template.yaml" \
		--stack-name "${stack_name}" \
		--capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
		--region eu-west-2 \
		--s3-bucket "${artifact_bucket}" \
		--s3-prefix "${ARTIFACT_BUCKET_PREFIX}" \
		--config-file "${GITHUB_WORKSPACE}/.aws-sam/build.tables/samconfig_package_and_deploy.toml" \
		--no-fail-on-empty-changeset \
		--role-arn "${cloud_formation_execution_role}" \
		--no-confirm-changeset \
		--force-upload \
		--tags \
				version="${VERSION_NUMBER}" \
		--parameter-overrides \
				EnableMutualTLS="${ENABLE_MUTUAL_TLS}" \
				EnableSplunk=true \
				EnableDynamoDBAutoScaling="${DYNAMODB_AUTOSCALE}" \
				VersionNumber="${VERSION_NUMBER}" 
}

get_exports

if [ "$DEPLOY_SANDBOX" == "true" ]; then
    deploy_sandbox_stack "${stack_name}"
    exit 0
fi

# get current deployed colour
current_coluor=$(aws cloudformation  describe-stacks --stack-name "${stack_name}" --query "Stacks[].Tags[?Key=='deployment_colour'].Value" --output text)

deploy_table_stack "${stack_name}-tables"

PrescriptionStatusUpdatesTableName=$(aws cloudformation list-exports --query "Exports[?Name=='${stack_name}-tables:tables:PrescriptionStatusUpdatesTableName'].Value" --output text)

if [ "$current_coluor" == "blue" ]; then
    undeployed_colour="green"
    deployed_colour="blue"
    undeployed_stack_name="${stack_name}-green"
    deployed_stack_name="${stack_name}-blue"
else
    undeployed_colour="blue"
    deployed_colour="green"
    undeployed_stack_name="${stack_name}-blue"
    deployed_stack_name="${stack_name}-green"
fi

deploy_main_stack "${undeployed_stack_name}" "${undeployed_colour}"

# get blue stack exports
RestApiGateway=$(aws cloudformation list-exports --query "Exports[?Name=='${undeployed_stack_name}:RestApi:Gateway'].Value" --output text)
RestApiGatewayStage=$(aws cloudformation list-exports --query "Exports[?Name=='${undeployed_stack_name}:RestApi:Gateway:Stage'].Value" --output text)
GSUL_ARN=$(aws cloudformation list-exports --query "Exports[?Name=='${undeployed_stack_name}:functions:psu-GetStatusUpdates:FunctionArn'].Value" --output text)
deploy_api_domain_stack "${stack_name}" "${undeployed_colour}"

deploy_main_stack "${deployed_stack_name}" "${deployed_colour}"
