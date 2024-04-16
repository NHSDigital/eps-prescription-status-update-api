#!/usr/bin/env bash

echo "Version number: $VERSION_NUMBER"
echo "Proxygen path: $PROXYGEN_PATH"
echo "Specification path: $SPEC_PATH"
echo "Stack name: $STACK_NAME" # instance
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

# Find and replace the specification version number 
jq --arg version "$VERSION_NUMBER" '.info.version = $version' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

# Find and replace the x-nhsd-apim.target.url value
jq --arg stack_name "$STACK_NAME" --arg aws_env "$aws_environment" '.["x-nhsd-apim"].target.url = "https://\($stack_name).\($aws_env).eps.national.nhs.uk"' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPrivateKey'].Value" --output text)
proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)

# client_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientKeySecret'].Value" --output text)
# client_cert_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientCertSecret'].Value" --output text)

# client_private_key=$(aws secretsmanager get-secret-value --secret-id "${client_private_key_arn}" --query SecretString --output text)
# client_cert=$(aws secretsmanager get-secret-value --secret-id "${client_cert_arn}" --query SecretString --output text)

# Create the .proxygen/tmp directory if it doesn't exist
mkdir -p ~/.proxygen/tmp
# Save the proxygen private key to a temporary file
echo "$proxygen_private_key" > ~/.proxygen/tmp/proxygen_private_key.pem

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
# "$PROXYGEN_PATH" secret put --mtls-cert "$client_cert" --mtls-key "$client_private_key" "$environment" psu-mtls-2

# Deploy the API instance using Proxygen CLI
"$PROXYGEN_PATH" instance deploy --no-confirm "$environment" "$STACK_NAME" "$SPEC_PATH"
