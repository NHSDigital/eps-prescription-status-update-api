#!/bin/bash

export AWS_PROFILE="${AWS_PROFILE:-eps-qa}"
export STACK="${STACK:-secrets}" # old = `secrets`, new = `psu`

export NOTIFY_API_BASE_URL="https://int.api.service.nhs.uk"

NOTIFY_API_KEY="$(aws secretsmanager get-secret-value --secret-id "$STACK-PSU-Notify-API-Key" --query SecretString --output text)"
export NOTIFY_API_KEY
NOTIFY_PRIVATE_KEY="$(aws secretsmanager get-secret-value --secret-id "$STACK-PSU-Notify-PrivateKey" --query SecretString --output text)"
export NOTIFY_PRIVATE_KEY
if [ "$STACK" = "psu" ]; then
  NOTIFY_KID="$(aws secretsmanager get-secret-value --secret-id "psu-PSU-Notify-KID" --query SecretString --output text)"
else
  # Note secrets-...-Name was the secret used in production but actually contains the KID value
  # Note too that another secret called secrets-...-KID also exists existed temporarily but was never used in production
  NOTIFY_KID="$(aws secretsmanager get-secret-value --secret-id "secrets-PSU-Notify-Application-Name" --query SecretString --output text)"
fi
export NOTIFY_KID

echo "Seeking token exchange with Notify for profile '$AWS_PROFILE' with '$STACK' secrets"
echo "  Notify API base URL: $NOTIFY_API_BASE_URL"
echo "  Notify API key: $NOTIFY_API_KEY"
echo "  Notify KID: $NOTIFY_KID"
echo "  Notify Private Key: ...$(echo "$NOTIFY_PRIVATE_KEY" | tail -n 2 | head -n 1 | tail -c 10)"
npm run cli:test-token -w nhsNotifyLambda
