import {LambdaIntegration, PassthroughBehavior, StepFunctionsIntegration} from "aws-cdk-lib/aws-apigateway"
import {IManagedPolicy} from "aws-cdk-lib/aws-iam"
import {HttpMethod} from "aws-cdk-lib/aws-lambda"
import {Construct} from "constructs"
import {
  ExpressStateMachine,
  LambdaEndpoint,
  RestApiGateway,
  StateMachineEndpoint,
  TypescriptLambdaFunction
} from "@nhsdigital/eps-cdk-constructs"

export interface ApisProps {
  readonly stackName: string
  readonly logRetentionInDays: number
  readonly mutualTlsTrustStoreKey: string | undefined
  readonly forwardCsocLogs: boolean
  readonly csocApiGatewayDestination: string
  readonly deployCheckPrescriptionStatusUpdate: boolean
  readonly exposeGetStatusUpdates: boolean
  functions: {[key: string]: TypescriptLambdaFunction}
  stateMachines: {[key: string]: ExpressStateMachine}
}

export class Apis extends Construct {
  public constructor(scope: Construct, id: string, props: ApisProps) {
    super(scope, id)

    // Collect execution policies for all resources that need API Gateway access
    const executionPolicies: Array<IManagedPolicy> = [
      props.stateMachines.updatePrescriptionStatus.executionPolicy,
      props.stateMachines.format1UpdatePrescriptionsStatus.executionPolicy,
      props.functions.status.executionPolicy,
      props.functions.capabilityStatement.executionPolicy,
      props.functions.nhsNotifyUpdateCallback.executionPolicy
    ]

    if (props.exposeGetStatusUpdates) {
      executionPolicies.push(props.functions.getStatusUpdates.executionPolicy)
    }

    if (props.deployCheckPrescriptionStatusUpdate) {
      executionPolicies.push(props.functions.checkPrescriptionStatusUpdates.executionPolicy)
    }

    const apiGateway = new RestApiGateway(this, "RestApiGateway", {
      stackName: props.stackName,
      logRetentionInDays: props.logRetentionInDays,
      mutualTlsTrustStoreKey: props.mutualTlsTrustStoreKey,
      forwardCsocLogs: props.forwardCsocLogs,
      csocApiGatewayDestination: props.csocApiGatewayDestination,
      executionPolicies
    })

    const rootResource = apiGateway.api.root

    // POST / — UpdatePrescriptionStatus state machine integration (root resource)
    rootResource.addMethod(
      HttpMethod.POST,
      StepFunctionsIntegration.startExecution(
        props.stateMachines.updatePrescriptionStatus.stateMachine,
        {
          credentialsRole: apiGateway.role,
          passthroughBehavior: PassthroughBehavior.WHEN_NO_MATCH
        }
      ),
      {
        methodResponses: [
          {statusCode: "200"},
          {statusCode: "400"},
          {statusCode: "500"}
        ]
      }
    )

    // POST /format-1 — Format1 state machine integration
    new StateMachineEndpoint(this, "Format1UpdatePrescriptionStatusEndpoint", {
      parentResource: rootResource,
      resourceName: "format-1",
      method: HttpMethod.POST,
      restApiGatewayRole: apiGateway.role,
      stateMachine: props.stateMachines.format1UpdatePrescriptionsStatus
    })

    // POST /notification-delivery-status-callback — Lambda proxy integration
    new LambdaEndpoint(this, "NotificationDeliveryStatusCallbackEndpoint", {
      parentResource: rootResource,
      resourceName: "notification-delivery-status-callback",
      method: HttpMethod.POST,
      restApiGatewayRole: apiGateway.role,
      lambdaFunction: props.functions.nhsNotifyUpdateCallback
    })

    // GET /_status — Lambda proxy integration
    new LambdaEndpoint(this, "StatusEndpoint", {
      parentResource: rootResource,
      resourceName: "_status",
      method: HttpMethod.GET,
      restApiGatewayRole: apiGateway.role,
      lambdaFunction: props.functions.status
    })

    // GET /metadata — Lambda proxy integration
    new LambdaEndpoint(this, "CapabilityStatementEndpoint", {
      parentResource: rootResource,
      resourceName: "metadata",
      method: HttpMethod.GET,
      restApiGatewayRole: apiGateway.role,
      lambdaFunction: props.functions.capabilityStatement
    })

    // GET /checkprescriptionstatusupdates — conditional Lambda proxy integration
    if (props.deployCheckPrescriptionStatusUpdate) {
      new LambdaEndpoint(this, "CheckPrescriptionStatusUpdatesEndpoint", {
        parentResource: rootResource,
        resourceName: "checkprescriptionstatusupdates",
        method: HttpMethod.GET,
        restApiGatewayRole: apiGateway.role,
        lambdaFunction: props.functions.checkPrescriptionStatusUpdates
      })
    }

    // POST /get-status-updates — conditional Lambda integration (non-proxy)
    if (props.exposeGetStatusUpdates) {
      const getStatusUpdatesResource = rootResource.addResource("get-status-updates")
      getStatusUpdatesResource.addMethod(
        HttpMethod.POST,
        new LambdaIntegration(props.functions.getStatusUpdates.function, {
          credentialsRole: apiGateway.role,
          proxy: false,
          requestTemplates: {
            "application/json": "$input.json('$')"
          },
          integrationResponses: [
            {
              statusCode: "200",
              responseTemplates: {
                "application/json": "$input.body"
              }
            }
          ]
        }),
        {
          methodResponses: [
            {statusCode: "200"}
          ]
        }
      )
    }
  }
}
