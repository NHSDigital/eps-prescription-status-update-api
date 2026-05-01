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

    const catchAllError = this.createCatchAllError()
    const callConvertRequestToFhirFormat = this.createCallConvertRequestToFhirFormat(
      props.convertRequestToFhirFormatFunction,
      catchAllError
    )
    const callUpdatePrescriptionStatus = this.createCallUpdatePrescriptionStatus(
      props.updatePrescriptionStatusFunction,
      catchAllError
    )

    this.definition = Chain
      .start(callConvertRequestToFhirFormat)
      .next(
        new Choice(this, "Convert Request to FHIR result")
          .when(
            Condition.jsonata("{% $convertStatusCode != 200 %}"),
            this.createFailedConvertRequestToFhir()
          )
          .otherwise(
            callUpdatePrescriptionStatus
              .next(
                new Choice(this, "Check Update Prescription Status Result")
                  .when(
                    Condition.jsonata("{% $updateStatusCode = 409 %}"),
                    this.createTranslate409To202()
                  )
                  .otherwise(new Pass(this, "End State"))
              )
          )
      )
  }

  private createCatchAllError(): Pass {
    return new Pass(this, "CatchAllError", {
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
  }

  private createCallConvertRequestToFhirFormat(
    convertRequestToFhirFormatFunction: IFunction,
    catchAllError: Pass
  ): LambdaInvoke {
    const callConvertRequestToFhirFormat = new LambdaInvoke(
      this,
      "Call Convert Request To Fhir Format",
      {
        lambdaFunction: convertRequestToFhirFormatFunction,
        assign: {
          convertStatusCode: "{% $states.result.Payload.statusCode %}",
          convertHeaders: "{% $states.result.Payload.headers %}",
          convertBody: "{% $parse($states.result.Payload.body) %}"
        }
      }
    )
    callConvertRequestToFhirFormat.addCatch(catchAllError)
    return callConvertRequestToFhirFormat
  }

  private createFailedConvertRequestToFhir(): Pass {
    return new Pass(this, "Failed Convert Request to FHIR", {
      outputs: {
        Payload: {
          statusCode: "{% $convertStatusCode %}",
          headers: "{% $convertHeaders %}",
          body: "{% $string($convertBody) %}"
        }
      }
    })
  }

  private createCallUpdatePrescriptionStatus(
    updatePrescriptionStatusFunction: IFunction,
    catchAllError: Pass
  ): LambdaInvoke {
    const callUpdatePrescriptionStatus = new LambdaInvoke(
      this,
      "Call Update Prescription Status",
      {
        lambdaFunction: updatePrescriptionStatusFunction,
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
    return callUpdatePrescriptionStatus
  }

  private createTranslate409To202(): Pass {
    return new Pass(this, "Translate 409 to 202", {
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
  }
}
