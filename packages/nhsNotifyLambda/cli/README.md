# NHS Notify Token Exchange CLI

CLI tool for testing the NHS Notify OAuth2 token exchange flow.

## Usage

```bash
cd packages/nhsNotifyLambda
npm run cli:test-token
```

## Required Environment Variables

Set these before running the CLI:

```bash
export NHS_NOTIFY_HOST="https://int.api.service.nhs.uk"
export NHS_NOTIFY_API_KEY="your-api-key-here"
export NHS_NOTIFY_PRIVATE_KEY="-----BEGIN ...
... key contents ...
... -----"
export NHS_NOTIFY_KID="your-key-id-here"
```
