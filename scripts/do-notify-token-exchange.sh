#!/bin/bash

export AWS_PROFILE="${AWS_PROFILE:-eps-qa}"
export STACK="${STACK:-secrets}" # old = `secrets`, new = `psu`

export NOTIFY_API_BASE_URL="https://int.api.service.nhs.uk"

if [ "$STACK" = "psu" ]; then
  NOTIFY_API_KEY="$(aws secretsmanager get-secret-value --secret-id "psu-PSU-Notify-API-Key" --query SecretString --output text)"
else
  NOTIFY_API_KEY="$(aws secretsmanager get-secret-value --secret-id "secrets-PSU-Notify-Application-Name" --query SecretString --output text)"
fi
export NOTIFY_API_KEY
NOTIFY_PRIVATE_KEY="$(aws secretsmanager get-secret-value --secret-id "psu-PSU-Notify-PrivateKey" --query SecretString --output text)"
export NOTIFY_PRIVATE_KEY
NOTIFY_KID="$(aws secretsmanager get-secret-value --secret-id "psu-PSU-Notify-KID" --query SecretString --output text)"
export NOTIFY_KID

echo "Seeking token exchange with Notify for profile '$AWS_PROFILE' with '$STACK' secrets"
npm run cli:test-token
