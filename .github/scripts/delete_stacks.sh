#!/usr/bin/env bash

echo "checking cloudformation stacks"
echo
ACTIVE_STACKS=$(aws cloudformation list-stacks | jq -r '.StackSummaries[] | select ( .StackStatus != "DELETE_COMPLETE" ) | select( .StackName | capture("^psu-(sandbox-)?pr-(\\d+)$") ) | .StackName ')

mapfile -t ACTIVE_STACKS_ARRAY <<< "$ACTIVE_STACKS"

for i in "${ACTIVE_STACKS_ARRAY[@]}"
do 
  echo "Checking if stack $i has open pull request"
  PULL_REQUEST=${i//psu-pr-/}
  PULL_REQUEST=${PULL_REQUEST//psu-sandbox-pr-/}
  echo "Checking pull request id ${PULL_REQUEST}"
  URL="https://api.github.com/repos/NHSDigital/eps-prescription-status-update-api/pulls/${PULL_REQUEST}"
  RESPONSE=$(curl "${URL}" 2>/dev/null)
  STATE=$(echo "${RESPONSE}" | jq -r .state)
  if [ "$STATE" == "closed" ]; then
    echo "** going to delete stack $i as state is ${STATE} **"
    aws cloudformation delete-stack --stack-name "${i}"
  else
    echo "not going to delete stack $i as state is ${STATE}"
  fi
done

echo
echo "getting proxygen key"
echo
# Retrieve the proxygen private key and client private key and cert from AWS Secrets Manager
proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:ProxgenPrivateKey'].Value" --output text)
proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)

# Create the .proxygen/tmp directory if it doesn't exist
mkdir -p ~/.proxygen/tmp

# Save the proxygen private key, client private key, and client cert to temporary files
echo "$proxygen_private_key" > ~/.proxygen/tmp/proxygen_private_key.pem

# Create the .proxygen/tmp directory if it doesn't exist
mkdir -p ~/.proxygen/tmp
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

echo
echo "checking apigee deployments"
echo
ACTIVE_APIGEE=$(poetry run proxygen instance list --env internal-dev | awk 'NR > 2 {print $3}')
mapfile -t ACTIVE_APIGEE_ARRAY <<< "$ACTIVE_APIGEE"

for i in "${ACTIVE_APIGEE_ARRAY[@]}"
do
  echo "Checking if apigee deployment $i has open pull request"
  PULL_REQUEST=${i//prescription-status-update-pr-/}
  PULL_REQUEST=${PULL_REQUEST//-sandbox/}
  echo "Checking pull request id ${PULL_REQUEST}"
    URL="https://api.github.com/repos/NHSDigital/eps-prescription-status-update-api/pulls/${PULL_REQUEST}"
  RESPONSE=$(curl "${URL}" 2>/dev/null)
  STATE=$(echo "${RESPONSE}" | jq -r .state)
  if [ "$STATE" == "closed" ]; then
    echo "** going to delete apigee deployment $i as state is ${STATE} **"
    poetry run proxygen instance delete --no-confirm "${i}"
  else
    echo "not going to delete apigee deployment $i as state is ${STATE}"
  fi
done
