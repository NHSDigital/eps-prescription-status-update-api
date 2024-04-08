#!/usr/bin/env bash

echo "Proxygen location: $PROXYGEN_PATH"
echo "Specification location: $SPEC_PATH"
echo "Target environment: $TARGET_ENVIRONMENT"
echo "Version number: $VERSION_NUMBER"
echo "Stack name: $STACK_NAME"

proxygen_private_key="13456789"

echo "$proxygen_private_key" > /tmp/proxygen_private_key.pem

# Condition to set the environment variable based on TARGET_ENVIRONMENT
if [ "$TARGET_ENVIRONMENT" != "dev-pr" ]; then
  environment=int
else
  environment=internal-dev
fi

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
