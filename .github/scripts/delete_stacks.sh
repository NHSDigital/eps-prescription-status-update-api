#!/usr/bin/env bash

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
