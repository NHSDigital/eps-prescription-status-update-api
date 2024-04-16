#!/usr/bin/env bash

echo "Version number: $VERSION_NUMBER"
echo "Proxygen path: $PROXYGEN_PATH"
echo "Specification path: $SPEC_PATH"
echo "Stack name: $STACK_NAME" # instance
echo "Target environment: $TARGET_ENVIRONMENT"

aws_environment=$(echo "$TARGET_ENVIRONMENT" | cut -d'-' -f1)
echo "AWS environment: $aws_environment"

if [ "$TARGET_ENVIRONMENT" != "dev-pr" ]; then
  environment=$TARGET_ENVIRONMENT
  jq --arg version "$VERSION_NUMBER" '.info.version = $version' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
else
  environment=internal-dev
  jq --arg version "$VERSION_NUMBER" '.info.version = $version' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"
fi
echo "Proxy environment: $environment"

# Find and replace the x-nhsd-apim.target.url value
jq --arg stack_name "$STACK_NAME" --arg aws_env "$aws_environment" '.["x-nhsd-apim"].target.url = "https://\($stack_name).\($aws_env).eps.national.nhs.uk"' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPrivateKey'].Value" --output text)
# proxygen_public_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPublicKey'].Value" --output text)

proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)
# proxygen_public_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_public_key_arn}" --query SecretString --output text)

# client_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientKeySecret'].Value" --output text)
# client_public_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientCertSecret'].Value" --output text)

# client_private_key=$(aws secretsmanager get-secret-value --secret-id "${client_private_key_arn}" --query SecretString --output text)
# client_public_key=$(aws secretsmanager get-secret-value --secret-id "${client_public_key_arn}" --query SecretString --output text)

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

"$PROXYGEN_PATH" instance deploy --no-confirm "$environment" "$STACK_NAME" "$SPEC_PATH"
