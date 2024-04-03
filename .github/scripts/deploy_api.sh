#!/usr/bin/env bash

proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPrivateKey'].Value" --output text)
# proxygen_public_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPublicKey'].Value" --output text)

proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)
# proxygen_public_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_public_key_arn}" --query SecretString --output text)


client_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientKeySecret'].Value" --output text)
# client_public_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:PsuClientCertSecret'].Value" --output text)

client_private_key=$(aws secretsmanager get-secret-value --secret-id "${client_private_key_arn}" --query SecretString --output text)
# client_public_key=$(aws secretsmanager get-secret-value --secret-id "${client_public_key_arn}" --query SecretString --output text)

# Save private keys to temporary files
echo "$proxygen_private_key" > /tmp/proxygen_private_key.pem
echo "$client_private_key" > /tmp/client_private_key.pem

environment=internal-dev
instance=prescription-status-update
path_to_spec=packages/specification/dist/eps-prescription-status-update-api.resolved.json

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

# Run proxygen using the specified path
/home/runner/work/eps-prescription-status-update-api/eps-prescription-status-update-api/.venv/bin/proxygen instance deploy --no-confirm "$environment" "$instance" "$path_to_spec"
