#!/usr/bin/env bash

echo "Proxygen path: $PROXYGEN_PATH"
echo "Specification path: $SPEC_PATH"
echo "Stack name: $STACK_NAME" # instance
echo "Target environment: $TARGET_ENVIRONMENT"

if [ "$TARGET_ENVIRONMENT" != "dev-pr" ]; then
  environment=$TARGET_ENVIRONMENT
else
  environment=internal-dev
fi

echo "Environment name: $environment"

# Find and replace the x-nhsd-apim.target.url value
jq --arg stack_name "$STACK_NAME" '.["x-nhsd-apim"].target.url = "https://\($stack_name).dev.eps.national.nhs.uk"' "$SPEC_PATH" > temp.json && mv temp.json "$SPEC_PATH"

proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPrivateKey'].Value" --output text)
# proxygen_public_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPublicKey'].Value" --output text)

proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)
# proxygen_public_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_public_key_arn}" --query SecretString --output text)

# client_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientKeySecret'].Value" --output text)
# client_public_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientCertSecret'].Value" --output text)

# client_private_key=$(aws secretsmanager get-secret-value --secret-id "${client_private_key_arn}" --query SecretString --output text)
# client_public_key=$(aws secretsmanager get-secret-value --secret-id "${client_public_key_arn}" --query SecretString --output text)

# Save private keys to temporary files
echo "$proxygen_private_key" > /tmp/proxygen_private_key.pem
# echo "$client_private_key" > /tmp/client_private_key.pem

# Create ~/.proxygen directory if it doesn't exist
mkdir -p ~/.proxygen

# Create credentials.yaml file
cat <<EOF > ~/.proxygen/credentials.yaml
client_id: prescription-status-update-api-client
key_id: eps-cli-key-1
private_key_path: /tmp/proxygen_private_key.pem
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
