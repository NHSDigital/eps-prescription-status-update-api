#!/usr/bin/env bash

echo "Proxygen path: $PROXYGEN_PATH"
echo "Specification path: $SPEC_PATH"
echo "Specification version: $VERSION_NUMBER"
echo "Stack name: $STACK_NAME"
echo "AWS environment: $AWS_ENVIRONMENT"
echo "Apigee environment: $APIGEE_ENVIRONMENT"

# Determine the proxy instance based on the provided $STACK_NAME
if [[ $STACK_NAME == psu-pr-* ]]; then
    # Extracting the PR ID from $STACK_NAME
    pr_id=$(echo "$STACK_NAME" | cut -d'-' -f3)
    instance=prescription-status-update-pr-$pr_id
else
    instance=prescription-status-update
fi
echo "Proxy instance: $instance"

# Find and replace the specification version number 
jq --arg version "$VERSION_NUMBER" '.info.version = $version' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

# Find and replace the x-nhsd-apim.target.url value
jq --arg stack_name "$STACK_NAME" --arg aws_env "$AWS_ENVIRONMENT" '.["x-nhsd-apim"].target.url = "https://\($stack_name).\($aws_env).eps.national.nhs.uk"' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

# Find and replace the servers object
if [[ $APIGEE_ENVIRONMENT == prod ]]; then
    jq --arg inst "$instance" '.servers = [ { "url": "https://api.service.nhs.uk/\($inst)" } ]' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
else
    jq --arg env "$APIGEE_ENVIRONMENT" --arg inst "$instance" '.servers = [ { "url": "https://\($env).api.service.nhs.uk/\($inst)" } ]' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
fi

# Find and replace securitySchemes
if [[ $APIGEE_ENVIRONMENT == prod ]]; then
    jq '.components.securitySchemes."app-level3" = {"$ref": "https://proxygen.prod.api.platform.nhs.uk/components/securitySchemes/app-level3"}' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
else
    jq '.components.securitySchemes."app-level3" = {"$ref": "https://proxygen.ptl.api.platform.nhs.uk/components/securitySchemes/app-level3"}' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
fi
# Retrieve the proxygen private key and client private key and cert from AWS Secrets Manager
proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPrivateKey'].Value" --output text)
client_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientKeySecret'].Value" --output text)
client_cert_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientCertSecret'].Value" --output text)

proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)
client_private_key=$(aws secretsmanager get-secret-value --secret-id "${client_private_key_arn}" --query SecretString --output text)
client_cert=$(aws secretsmanager get-secret-value --secret-id "${client_cert_arn}" --query SecretString --output text)

# Create the .proxygen/tmp directory if it doesn't exist
mkdir -p ~/.proxygen/tmp

# Save the proxygen private key, client private key, and client cert to temporary files
echo "$proxygen_private_key" > ~/.proxygen/tmp/proxygen_private_key.pem
echo "$client_private_key" > ~/.proxygen/tmp/client_private_key.pem
echo "$client_cert" > ~/.proxygen/tmp/client_cert.pem

# Create credentials.yaml file
cat <<EOF > ~/.proxygen/credentials.yaml
client_id: prescription-status-update-api-client
key_id: eps-cli-key-1
private_key_path: tmp/proxygen_private_key.pem
base_url: https://identity.prod.api.platform.nhs.uk/realms/api-producers
client_secret: https://nhsdigital.github.io/identity-service-jwks/jwks/paas/prescription-status-update-api.json
EOF

# Create settings.yaml file
cat <<EOF > ~/.proxygen/settings.yaml
api: prescription-status-update-api
endpoint_url: https://proxygen.prod.api.platform.nhs.uk
spec_output_format: json
EOF


# Store the API key secret using Proxygen CLI
"$PROXYGEN_PATH" secret put --mtls-cert ~/.proxygen/tmp/client_cert.pem --mtls-key ~/.proxygen/tmp/client_private_key.pem "$APIGEE_ENVIRONMENT" psu-mtls-1

# Deploy the API instance using Proxygen CLI
"$PROXYGEN_PATH" instance deploy --no-confirm "$APIGEE_ENVIRONMENT" "$instance" "$SPEC_PATH"
