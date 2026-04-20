/* eslint-disable max-len */
import {Stack} from "aws-cdk-lib"
import {safeAddNagSuppression, safeAddNagSuppressionGroup} from "@nhsdigital/eps-cdk-constructs"

export const nagSuppressions = (stack: Stack) => {
  // State machine log policies require wildcard for log streams and log delivery actions
  safeAddNagSuppressionGroup(
    stack,
    [
      "/PsuApiStatelessStack/StateMachines/UpdatePrescriptionStatusStateMachine/StateMachinePutLogsManagedPolicy/Resource",
      "/PsuApiStatelessStack/StateMachines/Format1UpdatePrescriptionsStatusStateMachine/StateMachinePutLogsManagedPolicy/Resource"
    ],
    [
      {
        id: "AwsSolutions-IAM5",
        reason: "Wildcard on log-stream is required to write to any log stream under the log group. Wildcard on Resource::* is required for log delivery management actions (DescribeLogGroups, ListLogDeliveries, etc.) which do not support resource-level permissions."
      }
    ]
  )

  // API Gateway does not use request validation — validation is handled by service logic
  safeAddNagSuppression(
    stack,
    "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Resource",
    [
      {
        id: "AwsSolutions-APIG2",
        reason: "Request validation is handled by the backend service logic and FHIR validation state machine, not at the API Gateway level."
      }
    ]
  )

  // API Gateway CloudWatch role uses AWS managed policy
  safeAddNagSuppression(
    stack,
    "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/CloudWatchRole/Resource",
    [
      {
        id: "AwsSolutions-IAM4",
        reason: "AWS managed policy AmazonAPIGatewayPushToCloudWatchLogs is the standard approach for API Gateway logging and is maintained by AWS.",
        appliesTo: ["Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"]
      }
    ]
  )

  // API Gateway stage is not associated with WAFv2 — WAF is managed externally via Apigee
  safeAddNagSuppression(
    stack,
    "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/DeploymentStage.prod/Resource",
    [
      {
        id: "AwsSolutions-APIG3",
        reason: "WAF is managed externally via the Apigee proxy layer, not at the API Gateway level."
      }
    ]
  )

  // API methods do not use authorization — mTLS and Apigee handle auth externally
  safeAddNagSuppressionGroup(
    stack,
    [
      "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Default/POST/Resource",
      "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Default/format-1/POST/Resource",
      "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Default/notification-delivery-status-callback/POST/Resource",
      "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Default/_status/GET/Resource",
      "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Default/metadata/GET/Resource",
      "/PsuApiStatelessStack/Apis/RestApiGateway/ApiGateway/Default/checkprescriptionstatusupdates/GET/Resource"
    ],
    [
      {
        id: "AwsSolutions-APIG4",
        reason: "Authorization is handled externally via mutual TLS and the Apigee API gateway proxy. API Gateway methods do not require an additional authorizer."
      },
      {
        id: "AwsSolutions-COG4",
        reason: "This API does not use Cognito for authentication. Auth is handled via mutual TLS and the Apigee API gateway proxy."
      }
    ]
  )

}

export const nagSuppressionsSandbox = (stack: Stack) => {
  // Sandbox HTTP API methods do not use API Gateway authorizers — auth is external via mTLS/Apigee
  safeAddNagSuppressionGroup(
    stack,
    [
      "/PsuApiSandboxStack/HttpApiGateway/POST--/Resource",
      "/PsuApiSandboxStack/HttpApiGateway/GET--_status/Resource",
      "/PsuApiSandboxStack/HttpApiGateway/GET--metadata/Resource"
    ],
    [
      {
        id: "AwsSolutions-APIG4",
        reason: "Authorization is handled externally via mutual TLS and the Apigee API gateway proxy. API Gateway methods do not require an additional authorizer."
      }
    ]
  )
}
