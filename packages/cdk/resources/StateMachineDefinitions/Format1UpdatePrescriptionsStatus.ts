import {IFunction} from "aws-cdk-lib/aws-lambda"
import {LambdaInvoke} from "aws-cdk-lib/aws-stepfunctions-tasks"
import {Construct} from "constructs"
import {
  Chain,
  Choice,
  Condition,
  IChainable,
  Pass,
  TaskInput
} from "aws-cdk-lib/aws-stepfunctions"

export interface Format1UpdatePrescriptionsStatusDefinitionProps {
  readonly convertRequestToFhirFormatFunction: IFunction
  readonly updatePrescriptionStatusFunction: IFunction
}

export class Format1UpdatePrescriptionsStatusDefinition extends Construct {
  public readonly definition: IChainable

  public constructor(
    scope: Construct, id: string, props: Format1UpdatePrescriptionsStatusDefinitionProps
  ) {
    super(scope, id)

    const catchAllError = new Pass(this, "CatchAllError", {
      outputs: {
        Payload: {
          statusCode: 500,
          headers: {
            "Content-Type": "application/fhir+json",
            "Cache-Control": "no-cache"
          },
          body: JSON.stringify({
            resourceType: "OperationOutcome",
            issue: [{severity: "error", code: "processing", diagnostics: "System error"}]
          })
        }
      }
    })

    const callConvertRequestToFhirFormat = new LambdaInvoke(
      this, "Call Convert Request To Fhir Format", {
        lambdaFunction: props.convertRequestToFhirFormatFunction,
        assign: {
          convertStatusCode: "{% $states.result.Payload.statusCode %}",
          convertHeaders: "{% $states.result.Payload.headers %}",
          convertBody: "{% $parse($states.result.Payload.body) %}"
        }
      }
    )
    callConvertRequestToFhirFormat.addCatch(catchAllError)

    const failedConvertRequestToFhir = new Pass(this, "Failed Convert Request to FHIR", {
      outputs: {
        Payload: {
          statusCode: "{% $convertStatusCode %}",
          headers: "{% $convertHeaders %}",
          body: "{% $string($convertBody) %}"
        }
      }
    })

    const callUpdatePrescriptionStatus = new LambdaInvoke(
      this, "Call Update Prescription Status", {
        lambdaFunction: props.updatePrescriptionStatusFunction,
        payload: TaskInput.fromObject({
          body: "{% $string($convertBody) %}",
          headers: "{% $convertHeaders %}"
        }),
        assign: {
          updateStatusCode: "{% $states.result.Payload.statusCode %}",
          updatePayload: "{% $states.result.Payload %}"
        }
      }
    )
    callUpdatePrescriptionStatus.addCatch(catchAllError)

    const translate409To202 = new Pass(this, "Translate 409 to 202", {
      outputs: {
        Payload: {
          statusCode: 202,
          headers: {
            "Content-Type": "application/fhir+json",
            "Cache-Control": "no-cache"
          },
          body: JSON.stringify({
            resourceType: "OperationOutcome",
            issue: [{
              severity: "information",
              code: "informational",
              diagnostics:
                "Duplicate update detected. The message was valid but did not result in an update."
            }]
          })
        }
      }
    })

    const endState = new Pass(this, "End State")

    const checkConvertResult = new Choice(this, "Convert Request to FHIR result")
    const convertNotOk = Condition.jsonata("{% $convertStatusCode != 200 %}")

    const checkUpdateResult = new Choice(this, "Check Update Prescription Status Result")
    const updateIs409 = Condition.jsonata("{% $updateStatusCode = 409 %}")

    this.definition = Chain
      .start(callConvertRequestToFhirFormat)
      .next(
        checkConvertResult
          .when(convertNotOk, failedConvertRequestToFhir)
          .otherwise(
            callUpdatePrescriptionStatus
              .next(
                checkUpdateResult
                  .when(updateIs409, translate409To202)
                  .otherwise(endState)
              )
          )
      )
  }
}
