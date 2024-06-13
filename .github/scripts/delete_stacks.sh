#!/usr/bin/env bash

# generic script for removing cloudformation stacks and proxygen deployed apis where the pull request is closed

# set the repo name to be the name of the repo this is running in
REPO_NAME=eps-prescription-status-update-api

# this should be a regex used in jq command that parses the output from aws cloudformation list-stacks and just captures stacks we are interested in
CAPTURE_REGEX="^psu-pr-(\\d+)(-sandbox)?$"

# this should be a regex that is used to get the pull request id from the cloud formation stack name
# this is used in a replace command to replace the stack name so what is left is just the pull request id
PULL_REQUEST_STACK_REGEX=psu-pr-

# this should be a regex that is used to get the pull request id from the proxygen deployed API
# this is used in a replace command to replace the proxy name so what is left is just the pull request id
PULL_REQUEST_PROXYGEN_REGEX=prescription-status-update-pr-

# this should be customised to delete cloudformation stacks and proxygen deployments if they are used
main() {
  delete_cloudformation_stacks
  create_proxygen_credentials "PSUProxygenPrivateKey" "eps-cli-key-1" "prescription-status-update-api"
  delete_apigee_deployments "internal-dev"
  delete_apigee_deployments "internal-dev-sandbox"

  PULL_REQUEST_PROXYGEN_REGEX=custom-prescription-status-update-pr-
  create_proxygen_credentials "CPSUProxygenPrivateKey" "eps-cli-key-cpsu-1" "custom-prescription-status-update-api"
  delete_apigee_deployments "internal-dev"
  delete_apigee_deployments "internal-dev-sandbox"
}

delete_cloudformation_stacks() {
  echo "checking cloudformation stacks"
  echo
  ACTIVE_STACKS=$(aws cloudformation list-stacks | jq -r --arg CAPTURE_REGEX "${CAPTURE_REGEX}" '.StackSummaries[] | select ( .StackStatus != "DELETE_COMPLETE" ) | select( .StackName | capture($CAPTURE_REGEX) ) | .StackName ')

  mapfile -t ACTIVE_STACKS_ARRAY <<< "$ACTIVE_STACKS"

  for i in "${ACTIVE_STACKS_ARRAY[@]}"
  do 
    echo "Checking if stack $i has open pull request"
    PULL_REQUEST=${i//${PULL_REQUEST_STACK_REGEX}/}
    PULL_REQUEST=${PULL_REQUEST//-sandbox/}
    echo "Checking pull request id ${PULL_REQUEST}"
    URL="https://api.github.com/repos/NHSDigital/${REPO_NAME}/pulls/${PULL_REQUEST}"
    RESPONSE=$(curl "${URL}" 2>/dev/null)
    STATE=$(echo "${RESPONSE}" | jq -r .state)
    if [ "$STATE" == "closed" ]; then
      echo "** going to delete stack $i as state is ${STATE} **"
      aws cloudformation delete-stack --stack-name "${i}"
      echo "** Sleeping for 60 seconds to avoid 429 on delete stack **"
      sleep 60
    else
      echo "not going to delete stack $i as state is ${STATE}"
    fi
  done
}

create_proxygen_credentials() {
  PROXYGEN_PRIVATE_KEY_NAME=$1
  PROXYGEN_KID=$2
  APIGEE_API=$3
  echo
  echo "getting proxygen key"
  echo "PROXYGEN_PRIVATE_KEY_NAME: ${PROXYGEN_PRIVATE_KEY_NAME}"
  echo "PROXYGEN_KID: ${PROXYGEN_KID}"
  echo "APIGEE_API: ${APIGEE_API}"
  echo
  # Retrieve the proxygen private key
  proxygen_private_key_arn=$(aws cloudformation list-exports --query "Exports[?Name=='account-resources:${PROXYGEN_PRIVATE_KEY_NAME}'].Value" --output text)
  proxygen_private_key=$(aws secretsmanager get-secret-value --secret-id "${proxygen_private_key_arn}" --query SecretString --output text)

  # Create the .proxygen/tmp directory if it doesn't exist
  mkdir -p ~/.proxygen/tmp

  # Save the proxygen private key, client private key, and client cert to temporary files
  echo "$proxygen_private_key" > ~/.proxygen/tmp/proxygen_private_key.pem

  # Create the .proxygen/tmp directory if it doesn't exist
  mkdir -p ~/.proxygen/tmp
  # Create credentials.yaml file
  cat <<EOF > ~/.proxygen/credentials.yaml
  client_id: ${APIGEE_API}-client
  key_id: ${PROXYGEN_KID}
  private_key_path: tmp/proxygen_private_key.pem
  base_url: https://identity.prod.api.platform.nhs.uk/realms/api-producers
  client_secret: https://nhsdigital.github.io/identity-service-jwks/jwks/paas/${APIGEE_API}.json
EOF

  # Create settings.yaml file
  cat <<EOF > ~/.proxygen/settings.yaml
  api: ${APIGEE_API}
  endpoint_url: https://proxygen.prod.api.platform.nhs.uk
  spec_output_format: json
EOF
}

delete_apigee_deployments() {
  APIGEE_ENVIRONMENT=$1
  echo
  echo "checking apigee deployments on ${APIGEE_ENVIRONMENT}"
  echo
  ACTIVE_APIGEE=$(poetry run proxygen instance list --env "${APIGEE_ENVIRONMENT}" | awk 'NR > 2 {print $3}')
  mapfile -t ACTIVE_APIGEE_ARRAY <<< "$ACTIVE_APIGEE"

  for i in "${ACTIVE_APIGEE_ARRAY[@]}"
  do
    echo "Checking if apigee deployment $i has open pull request"
    PULL_REQUEST=${i//${PULL_REQUEST_PROXYGEN_REGEX}/}
    echo "Checking pull request id ${PULL_REQUEST}"
    URL="https://api.github.com/repos/NHSDigital/${REPO_NAME}/pulls/${PULL_REQUEST}"
    RESPONSE=$(curl "${URL}" 2>/dev/null)
    STATE=$(echo "${RESPONSE}" | jq -r .state)
    if [ "$STATE" == "closed" ]; then
      echo "** going to delete apigee deployment $i as state is ${STATE} **"
      poetry run proxygen instance delete --no-confirm "${APIGEE_ENVIRONMENT}" "${i}"
    else
      echo "not going to delete apigee deployment $i as state is ${STATE}"
    fi
  done
}

main
