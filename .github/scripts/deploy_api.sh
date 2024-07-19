#!/usr/bin/env bash
set -eu pipefail

echo "API type: ${API_TYPE}"
echo "Proxygen path: ${PROXYGEN_PATH}"
echo "Specification path: ${SPEC_PATH}"
echo "Specification version: ${VERSION_NUMBER}"
echo "Stack name: ${STACK_NAME}"
echo "AWS environment: ${AWS_ENVIRONMENT}"
echo "Apigee environment: ${APIGEE_ENVIRONMENT}"
echo "Proxygen private key name: ${PROXYGEN_PRIVATE_KEY_NAME}"
echo "Proxygen KID: ${PROXYGEN_KID}"
echo "Deploy Check Prescription Status Update: ${DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE}"
echo "Dry run: ${DRY_RUN}"

is_pull_request=false
instance_suffix=""
if [[ ${STACK_NAME} == psu-pr-* ]]; then
    is_pull_request=true
    # Extracting the PR ID from $STACK_NAME
    pr_id=$(echo "${STACK_NAME}" | cut -d'-' -f3)
    instance_suffix=-"pr-${pr_id}"
fi

# Determine the proxy instance based on the provided $STACK_NAME
if [[ "${API_TYPE}" == "standard" ]]; then
    instance="prescription-status-update${instance_suffix}"
    apigee_api=prescription-status-update-api
else
    instance="custom-prescription-status-update${instance_suffix}"
    apigee_api=custom-prescription-status-update-api
fi

echo "Is pull request: ${is_pull_request}"
echo "Proxy instance: ${instance}"
echo "Apigee api: ${apigee_api}"

echo


echo "Fixing the spec"
# Find and replace the title
title=$(jq -r '.info.title' "${SPEC_PATH}")
if [[ "${is_pull_request}" == "true" ]]; then
    jq --arg title "[PR-${pr_id}] $title" '.info.title = $title' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
fi

# Find and replace the specification version number 
jq --arg version "${VERSION_NUMBER}" '.info.version = $version' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"

# Find and replace the x-nhsd-apim.target.url value
jq --arg stack_name "${STACK_NAME}" --arg aws_env "${AWS_ENVIRONMENT}" '.["x-nhsd-apim"].target.url = "https://\($stack_name).\($aws_env).eps.national.nhs.uk"' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"

# Find and replace the servers object
if [[ "${APIGEE_ENVIRONMENT}" == "prod" ]]; then
    jq --arg inst "${instance}" '.servers = [ { "url": "https://api.service.nhs.uk/\($inst)" } ]' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
else
    jq --arg env "${APIGEE_ENVIRONMENT}" --arg inst "${instance}" '.servers = [ { "url": "https://\($env).api.service.nhs.uk/\($inst)" } ]' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
fi

# Find and replace securitySchemes
if [[ "${APIGEE_ENVIRONMENT}" == "prod" ]]; then
    if [[ "${API_TYPE}" == "standard" ]]; then
        jq '.components.securitySchemes."app-level3" = {"$ref": "https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/app-level3"}' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
    else
        jq '.components.securitySchemes."app-level0" = {"$ref": "https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/app-level0"}' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
    fi
else
    if [[ "${API_TYPE}" == "standard" ]]; then
        jq '.components.securitySchemes."app-level3" = {"$ref": "https://proxygen.ptl.api.platform.nhs.uk/components/securitySchemes/app-level3"}' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
    else
        jq '.components.securitySchemes."app-level0" = {"$ref": "https://proxygen.ptl.api.platform.nhs.uk/components/securitySchemes/app-level0"}' "${SPEC_PATH}" > temp.json && mv temp.json "${SPEC_PATH}"
    fi
fi

# Remove target attributes if the environment is sandbox
if [[ "${APIGEE_ENVIRONMENT}" == *"sandbox"* ]]; then
    echo "Removing target attributes for sandbox environment"
    jq 'del(."x-nhsd-apim"."target-attributes")' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
fi

# Remove checkprescriptionstatusupdates if its not needed
if [[ "${DEPLOY_CHECK_PRESCRIPTION_STATUS_UPDATE}" == "false" ]]; then
    if [[ "${API_TYPE}" == "standard" ]]; then
        echo "Removing checkprescriptionstatusupdates endpoint"
        jq 'del(.paths."/checkprescriptionstatusupdates")' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
    fi
fi


echo

echo "Retrieving proxygen credentials"

# Retrieve the proxygen private key and client private key and cert from AWS Secrets Manager
proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:${PROXYGEN_PRIVATE_KEY_NAME}'].Value" --output text)
client_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientKeySecret'].Value" --output text)
client_cert_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientCertSecret'].Value" --output text)

proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)
client_private_key=$(aws secretsmanager get-secret-value --secret-id "${client_private_key_arn}" --query SecretString --output text)
client_cert=$(aws secretsmanager get-secret-value --secret-id "${client_cert_arn}" --query SecretString --output text)

# Create the .proxygen/tmp directory if it doesn't exist
mkdir -p ~/.proxygen/tmp

# Save the proxygen private key, client private key, and client cert to temporary files
echo "${proxygen_private_key}" > ~/.proxygen/tmp/proxygen_private_key.pem
echo "${client_private_key}" > ~/.proxygen/tmp/client_private_key.pem
echo "${client_cert}" > ~/.proxygen/tmp/client_cert.pem

cat <<EOF > ~/.proxygen/credentials.yaml
client_id: ${apigee_api}-client
key_id: ${PROXYGEN_KID}
private_key_path: tmp/proxygen_private_key.pem
base_url: https://identity.prod.api.platform.nhs.uk/realms/api-producers
client_secret: https://nhsdigital.github.io/identity-service-jwks/jwks/paas/${apigee_api}.json
EOF

# Create settings.yaml file
cat <<EOF > ~/.proxygen/settings.yaml
api: ${apigee_api}
endpoint_url: https://proxygen.prod.api.platform.nhs.uk
spec_output_format: json
EOF

if [[ "${is_pull_request}" == "false" ]]; then
    echo
    echo "Store the secret used for mutual TLS to AWS using Proxygen CLI"
    if [[ "${DRY_RUN}" == "false" ]]; then
        "${PROXYGEN_PATH}" secret put --mtls-cert ~/.proxygen/tmp/client_cert.pem --mtls-key ~/.proxygen/tmp/client_private_key.pem "${APIGEE_ENVIRONMENT}" psu-mtls-1
    else
        echo "Would run this command"
        echo "${PROXYGEN_PATH} secret put --mtls-cert ~/.proxygen/tmp/client_cert.pem --mtls-key ~/.proxygen/tmp/client_private_key.pem ${APIGEE_ENVIRONMENT} psu-mtls-1"
    fi
fi

echo
echo "Deploy the API instance using Proxygen CLI"
if [[ "${DRY_RUN}" == "false" ]]; then

    jq -n --argfile spec "${SPEC_PATH}" \
        --arg apiName "${apigee_api}" \
        --arg environment "internal-dev" \
        --arg instance "${instance}" \
        '{apiName: $apiName, environment: $environment, specDefinition: $spec, instance: $instance}' > output.json


    aws lambda invoke --function-name "arn:aws:lambda:eu-west-2:591291862413:function:lambda-resources-pr-294-ProxygenDeploy" --cli-binary-format raw-in-base64-out --payload file://output.json out.txt
    cat out.txt

#    "${PROXYGEN_PATH}" instance deploy --no-confirm "${APIGEE_ENVIRONMENT}" "${instance}" "${SPEC_PATH}"
else
    echo "Would run this command"
    echo "${PROXYGEN_PATH} instance deploy --no-confirm ${APIGEE_ENVIRONMENT} ${instance} ${SPEC_PATH}"
fi

if [[ "${APIGEE_ENVIRONMENT}" == "int" ]]; then
    echo
    echo "Deploy the API spec if in the int environment"
    if [[ "${DRY_RUN}" == "false" ]]; then
        "${PROXYGEN_PATH}" spec publish --no-confirm "${SPEC_PATH}"
    else
        echo "Would run this command"
        echo "${PROXYGEN_PATH} spec publish --no-confirm ${SPEC_PATH}"
    fi
fi

if [[ "${APIGEE_ENVIRONMENT}" == "internal-dev" && "${is_pull_request}" == "false" ]]; then
    echo
    echo "Deploy the API spec to uat if in the internal-dev environment"
    if [[ "${DRY_RUN}" == "false" ]]; then
        "${PROXYGEN_PATH}" spec publish --uat --no-confirm "${SPEC_PATH}"
    else
        echo "Would run this command"
        echo "${PROXYGEN_PATH} spec publish --uat --no-confirm ${SPEC_PATH}"
    fi
fi
