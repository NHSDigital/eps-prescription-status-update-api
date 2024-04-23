#!/usr/bin/env bash

echo "Proxygen path: $PROXYGEN_PATH"
echo "Specification path: $SPEC_PATH"
echo "Specification version: $VERSION_NUMBER"
echo "Stack name: $STACK_NAME"
echo "Target environment: $TARGET_ENVIRONMENT"

# Extract the AWS environment name from the target environment
aws_environment=$(echo "$TARGET_ENVIRONMENT" | cut -d'-' -f1)
echo "AWS environment: $aws_environment"

# Determine the proxy environment based on the target environment
case "$TARGET_ENVIRONMENT" in
    dev-pr|dev)
        environment=internal-dev
        ;;
    qa)
        environment=internal-qa
        ;;
    *)
        environment=$TARGET_ENVIRONMENT
        ;;
esac
echo "Proxy environment: $environment"

# Determine the proxy instance based on the provided $STACK_NAME
case "$STACK_NAME" in
    psu-pr-*)
        if [[ $STACK_NAME == psu-pr-* ]]; then
            # Extracting the PR ID from $STACK_NAME
            pr_id=$(echo "$STACK_NAME" | cut -d'-' -f3)
            # Check if it's a sandbox environment
            if [[ $STACK_NAME == *sandbox ]]; then
                instance=prescription-status-update-pr-$pr_id-sandbox
            else
                instance=prescription-status-update-pr-$pr_id
            fi
        fi
        ;;
    psu*)
        if [[ $STACK_NAME == *-sandbox ]]; then
            instance=prescription-status-update-sandbox
        else
            instance=prescription-status-update
        fi
        ;;
    *)
        instance=$STACK_NAME
        ;;
esac
echo "Proxy instance: $instance"

# Find and replace the specification version number 
jq --arg version "$VERSION_NUMBER" '.info.version = $version' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

# Find and replace the x-nhsd-apim.target.url value
jq --arg stack_name "$STACK_NAME" --arg aws_env "$aws_environment" '.["x-nhsd-apim"].target.url = "https://\($stack_name).\($aws_env).eps.national.nhs.uk"' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

# Find and replace the servers object
jq --arg env "$environment" --arg inst "$instance" '.servers = [ { "url": "https://\($env).api.service.nhs.uk/\($inst)" } ]' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

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
"$PROXYGEN_PATH" secret put --mtls-cert ~/.proxygen/tmp/client_cert.pem --mtls-key ~/.proxygen/tmp/client_private_key.pem "$environment" psu-mtls-1

# Deploy the API instance using Proxygen CLI
"$PROXYGEN_PATH" instance deploy --no-confirm "$environment" "$instance" "$SPEC_PATH"
