# FIXME: Delete this file


# CDK Migration TODO — Stateless Stack

This file tracks the migration of stateless components from SAM templates to CDK.
Stateful resources (DynamoDB tables, SSM parameters, Secrets Manager secrets, SQS queues) remain in SAM.

## Lambda Functions (`SAMtemplates/functions/main.yaml`)

Each Lambda includes the function itself, a nested `lambda_resources.yaml` stack (IAM role, log group, Splunk subscription filter), and associated IAM policies.

- [x] **UpdatePrescriptionStatus** — Core function that writes prescription status updates to DynamoDB and sends SQS messages for notifications. Has extensive IAM policies for DynamoDB, SQS, Secrets Manager, and SSM parameters. *(uses `TypescriptLambdaFunction` construct)*
- [x] **ConvertRequestToFhirFormat (CPSU)** — Converts custom format requests to FHIR format. No additional IAM policies beyond basic Lambda execution. *(uses `TypescriptLambdaFunction` construct)*
- [x] **GetStatusUpdates** — Reads prescription status updates from DynamoDB. Needs DynamoDB read and KMS policies. *(uses `TypescriptLambdaFunction` construct)*
- [x] **Status** — Returns `_status` health check info (version, commit ID). Needs Secrets Manager access. *(uses `TypescriptLambdaFunction` construct)*
- [x] **CapabilityStatement** — Returns FHIR CapabilityStatement. No additional IAM policies. *(uses `TypescriptLambdaFunction` construct)*
- [x] **CheckPrescriptionStatusUpdates** — Conditionally deployed (`DeployCheckPrescriptionStatusUpdate`). Reads from DynamoDB. Needs DynamoDB read and KMS policies. *(conditional `TypescriptLambdaFunction` construct)*
- [x] **NotifyProcessor** — Processes NHS Notify messages from SQS on a 1-minute schedule (EventBridge Scheduler). Needs SQS, DynamoDB, Secrets Manager, SSM, and KMS policies. Has a dedicated scheduler IAM role. *(uses `TypescriptLambdaFunction` + `CfnSchedule`)*
- [x] **PostDatedNotifyLambda** — Processes post-dated notifications on a 15-minute schedule (EventBridge Scheduler). Needs SQS and DynamoDB policies. Has a dedicated scheduler IAM role. *(uses `TypescriptLambdaFunction` + `CfnSchedule`)*
- [x] **NHSNotifyUpdateCallback** — Handles NHS Notify delivery status callbacks. Needs DynamoDB and Secrets Manager policies. *(uses `TypescriptLambdaFunction` construct)*
- [x] **PsuRestoreValidation** — Conditionally deployed (`EnableBackup`). Validates DynamoDB backup restores. Has a custom IAM policy for `backup:PutRestoreValidationResult` and an EventBridge rule for restore job state changes. *(conditional `TypescriptLambdaFunction` + `Rule`)*

### Per-Lambda shared resources (`lambda_resources.yaml`)
Each Lambda above has a nested stack that creates:
- [x] IAM execution role with CloudWatch Logs permissions *(handled by `TypescriptLambdaFunction` construct)*
- [x] CloudWatch Log Group (with configurable retention, optional KMS encryption) *(handled by `TypescriptLambdaFunction` construct)*
- [x] Splunk subscription filter (conditional on `EnableSplunk`) *(handled by `TypescriptLambdaFunction` construct — always enabled)*
- [x] Execute Lambda managed policy (exported for cross-stack references) *(handled by `TypescriptLambdaFunction` construct)*

## State Machines (`SAMtemplates/state_machines/main.yaml`)

Each state machine includes the state machine itself and a nested `state_machine_resources.yaml` stack (IAM role, log group, Splunk subscription filter).

- [x] **UpdatePrescriptionStatusStateMachine** — EXPRESS type. Invokes FHIR Validator (cross-stack import from `fhir-validator` stack) and UpdatePrescriptionStatus Lambda. Uses ASL definition file `UpdatePrescriptionStatusStateMachine.asl.json`. *(uses `ExpressStateMachine` construct + CDK step function definition)*
- [x] **Format1UpdatePrescriptionsStatusStateMachine** — EXPRESS type. Invokes ConvertRequestToFhirFormat and UpdatePrescriptionStatus Lambdas. Uses ASL definition file `Format1UpdatePrescriptionsStatusStateMachine.asl.json`. *(uses `ExpressStateMachine` construct + CDK step function definition)*

### Per-state-machine shared resources (`state_machine_resources.yaml`)
Each state machine has a nested stack that creates:
- [x] IAM execution role with state machine and Lambda invoke permissions *(handled by `ExpressStateMachine` construct)*
- [x] CloudWatch Log Group (with configurable retention, optional KMS encryption) *(handled by `ExpressStateMachine` construct)*
- [x] Splunk subscription filter (conditional on `EnableSplunk`) *(handled by `ExpressStateMachine` construct — always enabled)*
- [x] Execute state machine managed policy (exported for cross-stack references) *(handled by `ExpressStateMachine` construct)*

## API Gateway (`SAMtemplates/apis/main.yaml`)

- [x] **ACM Certificate** (`GenerateCertificate`) — DNS-validated certificate for the custom domain. *(handled by `RestApiGateway` construct)*
- [x] **REST API** (`RestApiGateway`) — Regional REST API with optional execute-api endpoint disabling (when mTLS is enabled). *(handled by `RestApiGateway` construct)*
- [x] **Custom Domain** (`RestApiDomain`) — Regional domain with TLS 1.2, optional mTLS truststore from S3. *(handled by `RestApiGateway` construct)*
- [x] **Route 53 Record** (`RestApiRecordSet`) — Alias A record pointing to the API Gateway domain. *(handled by `RestApiGateway` construct)*
- [x] **API Deployment and Stage** (`RestApiGatewayDeploymentV2h`, `RestApiGatewayStage`) — Deployment with X-Ray tracing and structured access logging. *(handled by `RestApiGateway` construct via `deploy: true`)*
- [x] **Domain Mapping** (`RestApiDomainMapping`) — Base path mapping to the `prod` stage. *(handled by `RestApiGateway` construct)*

### API Endpoints
- [x] **POST /** — `UpdatePrescriptionStatusMethod` — Step Functions integration (StartSyncExecution) to UpdatePrescriptionStatus state machine. *(root resource method in `Apis` construct)*
- [x] **POST /format-1** — `Format1UpdatePrescriptionStatusMethod` — Step Functions integration to Format1 state machine. *(uses `StateMachineEndpoint` construct)*
- [x] **POST /notification-delivery-status-callback** — `NotificationDeliveryStatusCallbackMethod` — Lambda proxy integration to NHSNotifyUpdateCallback. *(uses `LambdaEndpoint` construct)*
- [x] **GET /_status** — `StatusLambdaMethod` — Lambda proxy integration to Status function. *(uses `LambdaEndpoint` construct)*
- [x] **GET /metadata** — `CapabilityStatementMethod` — Lambda proxy integration to CapabilityStatement function. *(uses `LambdaEndpoint` construct)*
- [x] **GET /checkprescriptionstatusupdates** — `CheckPrescriptionStatusUpdatesMethod` — Conditional. Lambda proxy integration. *(conditional `LambdaEndpoint` in `Apis` construct)*
- [x] **POST /get-status-updates** — `GetStatusUpdatesMethod` — Conditional. Lambda integration (non-proxy) with request/response templates. *(conditional non-proxy `LambdaIntegration` in `Apis` construct)*

### API shared resources (`api_resources.yaml`)
- [x] API Gateway IAM role with policies to invoke Lambdas and state machines *(handled by `RestApiGateway` construct)*
- [x] API Gateway access log group (with configurable retention, optional KMS encryption) *(handled by `RestApiGateway` construct)*
- [x] Splunk subscription filter (conditional on `EnableSplunk`) *(handled by `RestApiGateway` construct — always enabled)*
- [x] CSOC log forwarding (conditional on `ForwardCsocLogs`) *(handled by `RestApiGateway` construct)*

## CloudWatch Alarms (`SAMtemplates/alarms/main.yaml`)

### Log Metric Filters
- [ ] `GetStatusUpdatesErrorsLogsMetricFilter` — Filters ERROR level logs from GetStatusUpdates
- [ ] `PrescriptionStatusUpdateErrorsLogsMetricFilter` — Filters 500 status responses from UpdatePrescriptionStatus
- [ ] `PrescriptionStatusUpdateForcedErrorsLogsMetricFilter` — Filters forced INT test errors
- [ ] `CPSUFhirConverterErrorLogsMetricFilter` — Filters 500 status responses from CPSU converter
- [ ] `NotifyProcessorTimeoutsMetricFilter` — Filters timeout messages from NotifyProcessor

### Alarms
- [ ] `GetStatusUpdatesErrorsAlarm` — Alerts on GetStatusUpdates errors
- [ ] `GetStatusUpdatesUnhandledErrorsAlarm` — Alerts on GetStatusUpdates unhandled Lambda errors
- [ ] `PrescriptionStatusUpdateErrorsAlarm` — Alerts on true 500 errors (excludes forced INT test errors via math expression)
- [ ] `PrescriptionStatusUpdateUnhandledErrorsAlarm` — Alerts on unhandled Lambda errors
- [ ] `DynamoDBSystemErrorsAlarm` — Alerts on DynamoDB system errors
- [ ] `DynamoDBWriteConsumptionAlarm` — Alerts when DynamoDB write usage nears provisioned capacity threshold
- [ ] `CPSUFhirConverterErrorsAlarm` — Alerts on CPSU FHIR converter errors
- [ ] `NotifyProcessorTimeoutsAlarm` — Alerts on NotifyProcessor timeouts
- [ ] `NHSNotifyPrescriptionsDeadLetterQueueMessagesAlarm` — Alerts on DLQ messages

## Cross-cutting concerns

- [ ] **Splunk log forwarding** — Conditionally enabled per log group via subscription filters. Requires `SplunkDeliveryStreamArn` and `SplunkSubscriptionFilterRole` from `lambda-resources` stack.
- [ ] **CSOC log forwarding** — Conditional forwarding of API Gateway access logs to CSOC destination.
- [ ] **KMS encryption** — CloudWatch log groups optionally encrypted with `account-resources:CloudwatchLogsKmsKeyArn`.
- [ ] **Cross-stack imports** — Many resources import values from `account-resources`, `lambda-resources`, `eps-route53-resources`, and `fhir-validator` stacks. These will become `Fn.importValue()` calls in CDK.
- [ ] **Conditional deployments** — `CheckPrescriptionStatusUpdates` and `GetStatusUpdates` endpoints are conditionally deployed. `PsuRestoreValidation` depends on `EnableBackup`. These will need CDK conditions or conditional construct instantiation.
