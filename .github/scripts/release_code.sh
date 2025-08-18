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

cd ../../.aws-sam/build || exit

REPO=eps-prescription-status-update-api
CFN_DRIFT_DETECTION_GROUP="psu"
if [[ "$STACK_NAME" =~ -pr-[0-9]+$ ]]; then
  CFN_DRIFT_DETECTION_GROUP="psu-pull-request"
fi

sam deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
    --region eu-west-2 \
    --s3-bucket "$artifact_bucket" \
    --s3-prefix "$ARTIFACT_BUCKET_PREFIX" \
    --config-file samconfig_package_and_deploy.toml \
    --no-fail-on-empty-changeset \
    --role-arn "$cloud_formation_execution_role" \
    --no-confirm-changeset \
    --force-upload \
    --tags "version=$VERSION_NUMBER stack=$STACK_NAME repo=$REPO cfnDriftDetectionGroup=$CFN_DRIFT_DETECTION_GROUP" \
    --parameter-overrides \
            TruststoreVersion="$LATEST_TRUSTSTORE_VERSION" \
            EnableMutualTLS="$ENABLE_MUTUAL_TLS" \
            EnableSplunk=true \
            EnableDynamoDBAutoScaling="$DYNAMODB_AUTOSCALE" \
            VersionNumber="$VERSION_NUMBER" \
            CommitId="$COMMIT_ID" \
            LogLevel="$LOG_LEVEL" \
            LogRetentionInDays="$LOG_RETENTION_DAYS" \
            Environment="$TARGET_ENVIRONMENT" \
            DeployCheckPrescriptionStatusUpdate="$DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE" \
            EnableAlerts="$ENABLE_ALERTS" \
            StateMachineLogLevel="$STATE_MACHINE_LOG_LEVEL" \
            EnableNotificationsInternal="$ENABLE_NOTIFICATIONS_INTERNAL" \
            EnableNotificationsExternal="$ENABLE_NOTIFICATIONS_EXTERNAL"
