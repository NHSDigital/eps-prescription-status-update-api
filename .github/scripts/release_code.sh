#!/usr/bin/env bash

echo "$COMMIT_ID"

artifact_bucket=$(aws cloudformation list-exports --output json | jq -r '.Exports[] | select(.Name == "account-resources:ArtifactsBucket") | .Value' | grep -o '[^:]*$')
export artifact_bucket

cloud_formation_execution_role=$(aws cloudformation list-exports --output json | jq -r '.Exports[] | select(.Name == "ci-resources:CloudFormationExecutionRole") | .Value' )
export cloud_formation_execution_role

TRUSTSTORE_BUCKET_ARN=$(aws cloudformation describe-stacks --stack-name account-resources --query "Stacks[0].Outputs[?OutputKey=='TrustStoreBucket'].OutputValue" --output text)
TRUSTSTORE_BUCKET_NAME=$(echo "${TRUSTSTORE_BUCKET_ARN}" | cut -d ":" -f 6)
LATEST_TRUSTSTORE_VERSION=$(aws s3api list-object-versions --bucket "${TRUSTSTORE_BUCKET_NAME}" --prefix "${TRUSTSTORE_FILE}" --query 'Versions[?IsLatest].[VersionId]' --output text)
export LATEST_TRUSTSTORE_VERSION

# get current deployed colour
a
#ws cloudformation  describe-stacks --stack-name "${stack_name}"

# deploy blue stack
original_stack_name=${stack_name}
stack_name="${original_stack_name}-blue"
export stack_name
export deployment_colour="blue"
export RestApiGateway="n/a"
export RestApiGatewayStage="n/a"
cd ../../.aws-sam/build.main || exit
make sam-deploy-package

# get blue stack exports
RestApiGateway=$(aws cloudformation list-exports --output json | jq -r '.Exports[] | select(.Name == "${stack_name}:RestApi:Gateway") | .Value' | grep -o '[^:]*$')
export RestApiGateway
RestApiGatewayStage=$(aws cloudformation list-exports --output json | jq -r '.Exports[] | select(.Name == "${stack_name}:RestApi:Gateway:Stage") | .Value' | grep -o '[^:]*$')
export RestApiGatewayStage

# deploy api-domain stack
stack_name="${original_stack_name}"
export stack_name
cd ../build.api_domain || exit
make sam-deploy-package

# deploy green stack
stack_name="${original_stack_name}-green"
export stack_name
export deployment_colour="green"
export RestApiGateway="n/a"
export RestApiGatewayStage="n/a"
cd ../../.aws-sam/build.main || exit
make sam-deploy-package
