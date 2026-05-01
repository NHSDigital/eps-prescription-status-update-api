#!/bin/bash
set -e

SRC_STACK="psu"
TRGT_STACK="${CDK_CONFIG_stackName:-psu-api-tstephen-nhs}-stateful"

SECRET_SUFFIXES=(
    'SqsSaltSecret'
    'PSU-Notify-KID'
    'PSU-Notify-PrivateKey'
    'PSU-Notify-Application-ID'
    'PSU-Notify-API-Key'
)

PARAMETER_SUFFIXES=(
    'PSUNotifyEnabledSiteODSCodes'
    'PSUNotifyEnabledSupplierApplicationIDs'
    'PSUNotifyBlockedSiteODSCodes'
    'PSUNotifyRoutingPlanID'
    'PSUNotifyApiBaseUrl'
    'EnableNotificationsExternal'
    'EnableNotificationsInternal'
    'TEST_PRESCRIPTIONS_1'
    'TEST_PRESCRIPTIONS_2'
    'TEST_PRESCRIPTIONS_3'
    'TEST_PRESCRIPTIONS_4'
)

for SUFFIX in "${SECRET_SUFFIXES[@]}"; do
    SRC_SECRET_NAME="$SRC_STACK-$SUFFIX"
    TRGT_SECRET_NAME="$TRGT_STACK-$SUFFIX"
    echo "Migrating secret: $SRC_SECRET_NAME to $TRGT_SECRET_NAME"
    if ! SECRET=$(aws secretsmanager get-secret-value --secret-id "$SRC_SECRET_NAME" --query 'SecretString' --output text 2>&1); then
        echo "ERROR: Failed to read secret $SRC_SECRET_NAME: $SECRET" >&2
        continue
    fi
    aws secretsmanager put-secret-value --secret-id "$TRGT_SECRET_NAME" --secret-string "$SECRET"
done

for SUFFIX in "${PARAMETER_SUFFIXES[@]}"; do
    SRC_PARAM_NAME="$SRC_STACK-$SUFFIX"
    TRGT_PARAM_NAME="$TRGT_STACK-$SUFFIX"
    echo "Migrating parameter: $SRC_PARAM_NAME to $TRGT_PARAM_NAME"
    PARAM_VALUE=$(aws ssm get-parameter --name "$SRC_PARAM_NAME" --query 'Parameter.Value' --output text)
    aws ssm put-parameter --name "$TRGT_PARAM_NAME" --value "$PARAM_VALUE" --type String --overwrite
done
